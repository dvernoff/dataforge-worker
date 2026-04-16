import type { FastifyInstance } from 'fastify';
import { DataService } from './data.service.js';
import { RLSService } from './rls.service.js';
import { ValidationService } from './validation.service.js';
import { CommentsService } from './comments.service.js';
import { CacheService } from '../api-builder/cache.service.js';
import { CacheInvalidationService } from '../api-builder/cache-invalidation.service.js';
import { nodeAuthMiddleware } from '../../middleware/node-auth.middleware.js';
import { requireWorkerRole } from '../../middleware/worker-rbac.middleware.js';
import { getQuotaHelpers, checkRecordsQuota, checkStorageQuota, reportQuotaViolation } from '../../middleware/quota-enforcement.middleware.js';
import { AppError } from '../../middleware/error-handler.js';
import { validateIdentifier } from '../../utils/sql-guard.js';
import { z } from 'zod';

function resolveProjectSchema(request: any): string {
  const schema = request.projectSchema;
  if (!schema) throw new AppError(400, 'Missing project schema header');
  return schema;
}

function resolveProjectId(request: any): string {
  return request.projectId ?? (request.params as any).projectId;
}

export async function dataRoutes(app: FastifyInstance) {
  const dataService = new DataService(app.db);
  const rlsService = new RLSService(app.db);
  const cacheService = new CacheService(app.redis);
  const cacheInvalidation = new CacheInvalidationService(app.db, cacheService);
  const validationService = new ValidationService(app.db);
  const commentsService = new CommentsService(app.db);

  app.addHook('preHandler', nodeAuthMiddleware);
  app.addHook('preHandler', requireWorkerRole('viewer'));
  app.addHook('preHandler', async (request) => {
    const params = request.params as Record<string, string>;
    if (params.tableName) validateIdentifier(params.tableName, 'table name');
  });

  app.get('/:projectId/tables/:tableName/data', async (request) => {
    const { tableName } = request.params as { tableName: string };
    const query = request.query as Record<string, string>;
    const dbSchema = resolveProjectSchema(request);
    const { maxRows } = getQuotaHelpers(request);

    const filters = query.filters ? JSON.parse(query.filters) : [];

    let requestedLimit = Number(query.limit ?? 50);
    let quotaClamped = false;
    if (maxRows > 0 && requestedLimit > maxRows) {
      requestedLimit = maxRows;
      quotaClamped = true;
    }

    const result = await dataService.findAll(dbSchema, tableName, {
      page: Number(query.page ?? 1),
      limit: requestedLimit,
      sort: query.sort,
      order: (query.order as 'asc' | 'desc') ?? 'desc',
      filters,
      search: query.search,
      searchColumns: query.searchColumns ? query.searchColumns.split(',') : undefined,
      include_deleted: query.include_deleted === 'true',
      only_deleted: query.only_deleted === 'true',
    });

    if (quotaClamped) {
      return { ...result, quota_limited: true, quota_max_rows: maxRows };
    }
    return result;
  });

  app.get('/:projectId/tables/:tableName/data/:id', async (request) => {
    const { tableName, id } = request.params as { tableName: string; id: string };
    const dbSchema = resolveProjectSchema(request);
    const record = await dataService.findById(dbSchema, tableName, id);
    return { record };
  });

  app.post('/:projectId/tables/:tableName/data', { preHandler: [requireWorkerRole('editor')] }, async (request, reply) => {
    const { tableName } = request.params as { tableName: string };
    const projectId = resolveProjectId(request);
    const dbSchema = resolveProjectSchema(request);
    const body = request.body as Record<string, unknown>;

    if (request.isSharedNode && request.quotas?.maxRecords > 0) {
      const blocked = await checkRecordsQuota(app.redis, app.db, projectId, dbSchema, request.quotas.maxRecords);
      if (blocked) {
        reportQuotaViolation(projectId, request.userId, 'quota.records_exceeded', { limit: request.quotas.maxRecords, table: tableName });
        return reply.status(429).send({ error: blocked, errorCode: 'QUOTA_EXCEEDED' });
      }
    }

    if (request.isSharedNode && request.quotas?.maxStorageMb > 0) {
      const blocked = await checkStorageQuota(app.redis, app.db, projectId, dbSchema, request.quotas.maxStorageMb, request.quotas.backupsSizeMb);
      if (blocked) {
        reportQuotaViolation(projectId, request.userId, 'quota.storage_exceeded', { limit: request.quotas.maxStorageMb });
        return reply.status(429).send({ error: blocked, errorCode: 'QUOTA_EXCEEDED' });
      }
    }

    const validationErrors = await validationService.validateRecord(projectId, dbSchema, tableName, body);
    if (validationErrors.length > 0) {
      throw new AppError(422, validationErrors.map((e) => e.message).join('; '));
    }

    const record = await dataService.create(dbSchema, tableName, body, projectId);
    cacheInvalidation.onDataChange(projectId, tableName, 'insert').catch(() => {});
    return { record };
  });

  app.put('/:projectId/tables/:tableName/data/:id', { preHandler: [requireWorkerRole('editor')] }, async (request) => {
    const { tableName, id } = request.params as { tableName: string; id: string };
    const projectId = resolveProjectId(request);
    const dbSchema = resolveProjectSchema(request);
    const body = request.body as Record<string, unknown>;

    const validationErrors = await validationService.validateRecord(projectId, dbSchema, tableName, body, id);
    if (validationErrors.length > 0) {
      throw new AppError(422, validationErrors.map((e) => e.message).join('; '));
    }

    const record = await dataService.update(dbSchema, tableName, id, body, projectId);
    cacheInvalidation.onDataChange(projectId, tableName, 'update').catch(() => {});
    return { record };
  });

  app.patch('/:projectId/tables/:tableName/data/:id/field', { preHandler: [requireWorkerRole('editor')] }, async (request) => {
    const { tableName, id } = request.params as { tableName: string; id: string };
    const projectId = resolveProjectId(request);
    const body = z.object({ field: z.string(), value: z.unknown() }).parse(request.body);
    const dbSchema = resolveProjectSchema(request);

    const currentRecord = await dataService.findById(dbSchema, tableName, id);
    const mergedRecord = { ...currentRecord, [body.field]: body.value };
    const validationErrors = await validationService.validateRecord(
      projectId, dbSchema, tableName, mergedRecord, id
    );
    if (validationErrors.length > 0) {
      throw new AppError(422, validationErrors.map((e) => e.message).join('; '));
    }

    const record = await dataService.updateField(dbSchema, tableName, id, body.field, body.value);
    return { record };
  });

  app.delete('/:projectId/tables/:tableName/data/:id', { preHandler: [requireWorkerRole('editor')] }, async (request, reply) => {
    const { projectId, tableName, id } = request.params as { projectId: string; tableName: string; id: string };
    const dbSchema = resolveProjectSchema(request);
    await dataService.delete(dbSchema, tableName, id, projectId);
    cacheInvalidation.onDataChange(projectId, tableName, 'delete').catch(() => {});
    return reply.status(204).send();
  });

  app.post('/:projectId/tables/:tableName/data/bulk-update', { preHandler: [requireWorkerRole('editor')] }, async (request) => {
    const { projectId, tableName } = request.params as { projectId: string; tableName: string };
    const body = z.object({
      ids: z.array(z.string()).min(1),
      field: z.string().min(1),
      value: z.unknown(),
    }).parse(request.body);
    const dbSchema = resolveProjectSchema(request);
    const result = await dataService.bulkUpdate(dbSchema, tableName, body.ids, body.field, body.value);
    cacheInvalidation.onDataChange(projectId, tableName, 'update').catch(() => {});
    return result;
  });

  app.post('/:projectId/tables/:tableName/data/bulk-delete', { preHandler: [requireWorkerRole('editor')] }, async (request) => {
    const { projectId, tableName } = request.params as { projectId: string; tableName: string };
    const body = z.object({ ids: z.array(z.string()).min(1) }).parse(request.body);
    const dbSchema = resolveProjectSchema(request);
    const result = await dataService.bulkDelete(dbSchema, tableName, body.ids);
    cacheInvalidation.onDataChange(projectId, tableName, 'delete').catch(() => {});
    return result;
  });

  app.post('/:projectId/tables/:tableName/data/:id/restore', { preHandler: [requireWorkerRole('editor')] }, async (request) => {
    const { tableName, id } = request.params as { tableName: string; id: string };
    const dbSchema = resolveProjectSchema(request);
    const record = await dataService.restore(dbSchema, tableName, id);
    return { record };
  });

  app.delete('/:projectId/tables/:tableName/data/:id/permanent', { preHandler: [requireWorkerRole('editor')] }, async (request, reply) => {
    const { tableName, id } = request.params as { tableName: string; id: string };
    const dbSchema = resolveProjectSchema(request);
    await dataService.permanentDelete(dbSchema, tableName, id);
    return reply.status(204).send();
  });

  app.post('/:projectId/tables/:tableName/import', { preHandler: [requireWorkerRole('editor')], bodyLimit: 100 * 1024 * 1024 }, async (request, reply) => {
    const { tableName } = request.params as { tableName: string };
    const projectId = resolveProjectId(request);
    const body = z.object({
      records: z.array(z.record(z.unknown())).min(1).max(50000),
    }).parse(request.body);
    const dbSchema = resolveProjectSchema(request);

    if (request.isSharedNode && request.quotas?.maxRecords > 0) {
      const blocked = await checkRecordsQuota(app.redis, app.db, projectId, dbSchema, request.quotas.maxRecords);
      if (blocked) {
        reportQuotaViolation(projectId, request.userId, 'quota.records_exceeded', { limit: request.quotas.maxRecords, table: tableName, importCount: body.records.length });
        return reply.status(429).send({ error: blocked, errorCode: 'QUOTA_EXCEEDED' });
      }
    }

    const result = await dataService.importRecords(dbSchema, tableName, body.records);
    return result;
  });

  app.get('/:projectId/tables/:tableName/export', async (request) => {
    const { tableName } = request.params as { tableName: string };
    const query = request.query as Record<string, string>;
    const dbSchema = resolveProjectSchema(request);
    const { maxExport, reportViolation } = getQuotaHelpers(request);
    const filters = query.filters ? JSON.parse(query.filters) : [];

    const records = await dataService.exportRecords(dbSchema, tableName, filters, maxExport || undefined);

    if (maxExport > 0 && records.length >= maxExport) {
      reportViolation('quota.export_truncated', {
        table: tableName,
        limit: maxExport,
        message: `Export truncated to ${maxExport} rows. Optimize your query or contact admin.`,
      });
    }

    return { records, truncated: maxExport > 0 && records.length >= maxExport, limit: maxExport || null };
  });

  app.get('/:projectId/rls', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const rules = await rlsService.listRules(projectId);
    return { rules };
  });

  app.post('/:projectId/rls', { preHandler: [requireWorkerRole('admin')] }, async (request) => {
    const { projectId } = request.params as { projectId: string };
    const body = z.object({
      table_name: z.string().min(1),
      column_name: z.string().min(1),
      operator: z.enum(['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'in', 'contains']),
      value_source: z.enum(['static', 'current_user_id', 'current_user_role', 'header', 'context']),
      value_static: z.string().nullable().optional(),
    }).parse(request.body);
    const rule = await rlsService.createRule({ project_id: projectId, ...body });
    return { rule };
  });

  app.delete('/:projectId/rls/:ruleId', { preHandler: [requireWorkerRole('admin')] }, async (request, reply) => {
    const { ruleId } = request.params as { ruleId: string };
    const projectId = resolveProjectId(request);
    await rlsService.deleteRule(ruleId, projectId);
    return reply.status(204).send();
  });

  app.get('/:projectId/tables/:tableName/validations', async (request) => {
    const { tableName } = request.params as { tableName: string };
    const projectId = resolveProjectId(request);
    const rules = await validationService.getRules(projectId, tableName);
    return { rules };
  });

  app.post('/:projectId/tables/:tableName/validations', { preHandler: [requireWorkerRole('admin')] }, async (request) => {
    const { tableName } = request.params as { tableName: string };
    const projectId = resolveProjectId(request);
    const body = z.object({
      column_name: z.string().nullable().optional(),
      rule_type: z.enum(['unique_combo', 'regex', 'range', 'enum', 'custom_expression', 'state_machine']),
      config: z.record(z.unknown()),
      error_message: z.string().min(1).max(500),
    }).parse(request.body);

    const rule = await validationService.createRule({
      project_id: projectId,
      table_name: tableName,
      ...body,
    });
    return { rule };
  });

  app.delete('/:projectId/tables/:tableName/validations/:ruleId', { preHandler: [requireWorkerRole('admin')] }, async (request, reply) => {
    const { ruleId } = request.params as { ruleId: string };
    const projectId = resolveProjectId(request);
    await validationService.deleteRule(ruleId, projectId);
    return reply.status(204).send();
  });

  app.get('/:projectId/tables/:tableName/comments/counts', async (request) => {
    const { projectId, tableName } = request.params as { projectId: string; tableName: string };
    const counts = await commentsService.getCounts(projectId, tableName);
    return { counts };
  });

  app.get('/:projectId/tables/:tableName/data/:recordId/comments', async (request) => {
    const { projectId, tableName, recordId } = request.params as { projectId: string; tableName: string; recordId: string };
    const comments = await commentsService.list(projectId, tableName, recordId);
    return { comments };
  });

  app.post('/:projectId/tables/:tableName/data/:recordId/comments', { preHandler: [requireWorkerRole('editor')] }, async (request) => {
    const { projectId, tableName, recordId } = request.params as { projectId: string; tableName: string; recordId: string };
    const userId = request.userId ?? 'unknown';
    const body = z.object({
      content: z.string().min(1).max(5000),
      user_name: z.string().min(1).max(255).optional(),
    }).parse(request.body);

    const comment = await commentsService.create({
      project_id: projectId,
      table_name: tableName,
      record_id: recordId,
      user_id: userId,
      user_name: body.user_name ?? 'User',
      content: body.content,
    });
    return { comment };
  });

  app.delete('/:projectId/tables/:tableName/data/:recordId/comments/:commentId', { preHandler: [requireWorkerRole('editor')] }, async (request, reply) => {
    const { commentId } = request.params as { commentId: string };
    const projectId = resolveProjectId(request);
    await commentsService.delete(commentId, projectId);
    return reply.status(204).send();
  });

  app.post('/:projectId/tables/:tableName/seed', { preHandler: [requireWorkerRole('editor')] }, async (request) => {
    const { tableName } = request.params as { tableName: string };
    const dbSchema = resolveProjectSchema(request);
    const body = z.object({
      count: z.number().int().min(1).max(50),
      generators: z.record(z.string()),
    }).parse(request.body);

    const { SeedingService } = await import('./seeding.service.js');
    const seedingService = new SeedingService();

    const columnsResult = await app.db.raw(`
      SELECT column_name as name, data_type as type, udt_name as udt_type
      FROM information_schema.columns
      WHERE table_schema = ? AND table_name = ?
      ORDER BY ordinal_position
    `, [dbSchema, tableName]);

    const records = seedingService.generateRecords(
      dbSchema, tableName, columnsResult.rows, body.count, body.generators
    );

    const validRecords = records.filter((r) => Object.keys(r).length > 0);
    if (validRecords.length === 0) {
      return { inserted: 0, total: 0, error: 'No columns mapped for seeding' };
    }

    const projectId = resolveProjectId(request);
    const inserted = await dataService.bulkInsertWithWebhooks(dbSchema, tableName, validRecords, projectId);

    return { inserted, total: validRecords.length };
  });
}
