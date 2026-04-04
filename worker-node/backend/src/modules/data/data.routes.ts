import type { FastifyInstance } from 'fastify';
import { DataService } from './data.service.js';
import { HistoryService } from './history.service.js';
import { RLSService } from './rls.service.js';
import { ValidationService } from './validation.service.js';
import { CommentsService } from './comments.service.js';
import { CacheService } from '../api-builder/cache.service.js';
import { CacheInvalidationService } from '../api-builder/cache-invalidation.service.js';
import { nodeAuthMiddleware } from '../../middleware/node-auth.middleware.js';
import { requireWorkerRole } from '../../middleware/worker-rbac.middleware.js';
import { getQuotaHelpers } from '../../middleware/quota-enforcement.middleware.js';
import { AppError } from '../../middleware/error-handler.js';
import { z } from 'zod';

function resolveProjectSchema(request: any): string {
  const schema = request.projectSchema;
  if (!schema) throw new AppError(400, 'Missing project schema header');
  return schema;
}

/** Get real project UUID from header (set by CP proxy), NOT from URL param (which is slug) */
function resolveProjectId(request: any): string {
  return request.projectId ?? (request.params as any).projectId;
}

export async function dataRoutes(app: FastifyInstance) {
  const dataService = new DataService(app.db);
  const historyService = new HistoryService(app.db);
  const rlsService = new RLSService(app.db);
  const cacheService = new CacheService(app.redis);
  const cacheInvalidation = new CacheInvalidationService(app.db, cacheService);
  const validationService = new ValidationService(app.db);
  const commentsService = new CommentsService(app.db);

  app.addHook('preHandler', nodeAuthMiddleware);
  app.addHook('preHandler', requireWorkerRole('viewer'));

  // GET /api/projects/:projectId/tables/:tableName/data
  app.get('/:projectId/tables/:tableName/data', async (request) => {
    const { tableName } = request.params as { tableName: string };
    const query = request.query as Record<string, string>;
    const dbSchema = resolveProjectSchema(request);
    const { maxRows } = getQuotaHelpers(request);

    const filters = query.filters ? JSON.parse(query.filters) : [];

    // Enforce max rows per query quota (shared nodes only)
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

  // GET /api/projects/:projectId/tables/:tableName/data/:id
  app.get('/:projectId/tables/:tableName/data/:id', async (request) => {
    const { tableName, id } = request.params as { tableName: string; id: string };
    const dbSchema = resolveProjectSchema(request);
    const record = await dataService.findById(dbSchema, tableName, id);
    return { record };
  });

  // POST /api/projects/:projectId/tables/:tableName/data
  app.post('/:projectId/tables/:tableName/data', async (request) => {
    const { tableName } = request.params as { tableName: string };
    const projectId = resolveProjectId(request);
    const dbSchema = resolveProjectSchema(request);
    const body = request.body as Record<string, unknown>;

    // Validate before saving
    const validationErrors = await validationService.validateRecord(projectId, dbSchema, tableName, body);
    if (validationErrors.length > 0) {
      throw new AppError(422, validationErrors.map((e) => e.message).join('; '));
    }

    const record = await dataService.create(dbSchema, tableName, body);
    // Smart cache invalidation
    cacheInvalidation.onDataChange(projectId, tableName, 'insert').catch(() => {});
    return { record };
  });

  // PUT /api/projects/:projectId/tables/:tableName/data/:id
  app.put('/:projectId/tables/:tableName/data/:id', async (request) => {
    const { tableName, id } = request.params as { tableName: string; id: string };
    const projectId = resolveProjectId(request);
    const dbSchema = resolveProjectSchema(request);
    const body = request.body as Record<string, unknown>;

    // Validate before saving
    const validationErrors = await validationService.validateRecord(projectId, dbSchema, tableName, body, id);
    if (validationErrors.length > 0) {
      throw new AppError(422, validationErrors.map((e) => e.message).join('; '));
    }

    const record = await dataService.update(dbSchema, tableName, id, body);
    // Smart cache invalidation
    cacheInvalidation.onDataChange(projectId, tableName, 'update').catch(() => {});
    return { record };
  });

  // PATCH /api/projects/:projectId/tables/:tableName/data/:id/field
  app.patch('/:projectId/tables/:tableName/data/:id/field', async (request) => {
    const { tableName, id } = request.params as { tableName: string; id: string };
    const projectId = resolveProjectId(request);
    const body = z.object({ field: z.string(), value: z.unknown() }).parse(request.body);
    const dbSchema = resolveProjectSchema(request);

    // Fetch current record and merge with the changed field for full validation
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

  // DELETE /api/projects/:projectId/tables/:tableName/data/:id
  app.delete('/:projectId/tables/:tableName/data/:id', async (request, reply) => {
    const { projectId, tableName, id } = request.params as { projectId: string; tableName: string; id: string };
    const dbSchema = resolveProjectSchema(request);
    await dataService.delete(dbSchema, tableName, id);
    cacheInvalidation.onDataChange(projectId, tableName, 'delete').catch(() => {});
    return reply.status(204).send();
  });

  // POST /api/projects/:projectId/tables/:tableName/data/bulk-update
  app.post('/:projectId/tables/:tableName/data/bulk-update', async (request) => {
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

  // POST /api/projects/:projectId/tables/:tableName/data/bulk-delete
  app.post('/:projectId/tables/:tableName/data/bulk-delete', async (request) => {
    const { projectId, tableName } = request.params as { projectId: string; tableName: string };
    const body = z.object({ ids: z.array(z.string()).min(1) }).parse(request.body);
    const dbSchema = resolveProjectSchema(request);
    const result = await dataService.bulkDelete(dbSchema, tableName, body.ids);
    cacheInvalidation.onDataChange(projectId, tableName, 'delete').catch(() => {});
    return result;
  });

  // POST /api/projects/:projectId/tables/:tableName/data/:id/restore — restore soft-deleted record
  app.post('/:projectId/tables/:tableName/data/:id/restore', async (request) => {
    const { tableName, id } = request.params as { tableName: string; id: string };
    const dbSchema = resolveProjectSchema(request);
    const record = await dataService.restore(dbSchema, tableName, id);
    return { record };
  });

  // DELETE /api/projects/:projectId/tables/:tableName/data/:id/permanent — permanently delete
  app.delete('/:projectId/tables/:tableName/data/:id/permanent', async (request, reply) => {
    const { tableName, id } = request.params as { tableName: string; id: string };
    const dbSchema = resolveProjectSchema(request);
    await dataService.permanentDelete(dbSchema, tableName, id);
    return reply.status(204).send();
  });

  // POST /api/projects/:projectId/tables/:tableName/import
  app.post('/:projectId/tables/:tableName/import', async (request) => {
    const { tableName } = request.params as { tableName: string };
    const body = z.object({
      records: z.array(z.record(z.unknown())).min(1).max(10000),
    }).parse(request.body);
    const dbSchema = resolveProjectSchema(request);
    const result = await dataService.importRecords(dbSchema, tableName, body.records);
    return result;
  });

  // GET /api/projects/:projectId/tables/:tableName/export
  app.get('/:projectId/tables/:tableName/export', async (request) => {
    const { tableName } = request.params as { tableName: string };
    const query = request.query as Record<string, string>;
    const dbSchema = resolveProjectSchema(request);
    const { maxExport, reportViolation } = getQuotaHelpers(request);
    const filters = query.filters ? JSON.parse(query.filters) : [];

    const records = await dataService.exportRecords(dbSchema, tableName, filters, maxExport || undefined);

    // Log if export was truncated
    if (maxExport > 0 && records.length >= maxExport) {
      reportViolation('quota.export_truncated', {
        table: tableName,
        limit: maxExport,
        message: `Export truncated to ${maxExport} rows. Optimize your query or contact admin.`,
      });
    }

    return { records, truncated: maxExport > 0 && records.length >= maxExport, limit: maxExport || null };
  });

  // POST /api/projects/:projectId/tables/:tableName/history/setup
  app.post('/:projectId/tables/:tableName/history/setup', async (request) => {
    const { tableName } = request.params as { tableName: string };
    const dbSchema = resolveProjectSchema(request);
    await historyService.setupHistoryTracking(dbSchema, tableName);
    return { success: true };
  });

  // GET /api/projects/:projectId/tables/:tableName/data/:id/history
  app.get('/:projectId/tables/:tableName/data/:id/history', async (request) => {
    const { tableName, id } = request.params as { tableName: string; id: string };
    const dbSchema = resolveProjectSchema(request);
    const history = await historyService.getHistory(dbSchema, tableName, id);
    return { history };
  });

  // POST /api/projects/:projectId/tables/:tableName/data/:id/rollback
  app.post('/:projectId/tables/:tableName/data/:id/rollback', async (request) => {
    const { tableName, id } = request.params as { tableName: string; id: string };
    const body = z.object({ historyId: z.string().uuid() }).parse(request.body);
    const dbSchema = resolveProjectSchema(request);
    const result = await historyService.rollback(dbSchema, tableName, id, body.historyId);
    return { record: result };
  });

  // ─── Time Travel ─────────────────────────────────────────

  // GET /api/projects/:projectId/tables/:tableName/time-travel?timestamp=<ISO>
  app.get('/:projectId/tables/:tableName/time-travel', async (request) => {
    const { tableName } = request.params as { tableName: string };
    const query = request.query as Record<string, string>;
    const dbSchema = resolveProjectSchema(request);

    const timestamp = query.timestamp;
    if (!timestamp) {
      throw new AppError(400, 'Missing required query parameter: timestamp');
    }

    const targetDate = new Date(timestamp);
    if (isNaN(targetDate.getTime())) {
      throw new AppError(400, 'Invalid timestamp format');
    }

    const historyTable = `__history_${tableName}`;

    // Check if history table exists
    const historyExists = await app.db.raw(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = ? AND table_name = ?
      ) as exists
    `, [dbSchema, historyTable]);

    if (!historyExists.rows[0]?.exists) {
      throw new AppError(404, 'History tracking is not enabled for this table. Enable it first.');
    }

    // Opportunistic cleanup: purge history older than retention period
    const retentionDays = Number(query.retention_days ?? '7');
    historyService.purgeOldHistory(dbSchema, tableName, retentionDays).catch(() => {});

    // Reconstruct state at given timestamp:
    // 1. Get all current records
    // 2. Get all history entries after the timestamp (to reverse-apply changes)
    const currentRecords = await app.db(`${dbSchema}.${tableName}`).select('*');

    const futureChanges = await app.db(`${dbSchema}.${historyTable}`)
      .where('changed_at', '>', targetDate.toISOString())
      .orderBy('changed_at', 'desc');

    // Build a map of records as they were at the target timestamp
    const recordMap = new Map<string, Record<string, unknown>>();
    for (const record of currentRecords) {
      recordMap.set(String(record.id), record);
    }

    // Track which fields changed per record for diff highlighting
    const changedFields = new Map<string, Set<string>>();

    // Reverse-apply changes (most recent first)
    for (const change of futureChanges) {
      const recordId = change.record_id;

      if (change.operation === 'INSERT') {
        // This record was inserted after our target time — remove it
        recordMap.delete(recordId);
      } else if (change.operation === 'DELETE') {
        // This record was deleted after our target time — restore it
        if (change.old_values) {
          recordMap.set(recordId, change.old_values);
        }
      } else if (change.operation === 'UPDATE') {
        // This record was updated after our target time — use old values
        if (change.old_values) {
          const current = recordMap.get(recordId);
          if (current && change.new_values) {
            // Track which fields differ
            const fields = new Set<string>();
            for (const key of Object.keys(change.new_values)) {
              if (JSON.stringify(change.old_values[key]) !== JSON.stringify(change.new_values[key])) {
                fields.add(key);
              }
            }
            if (fields.size > 0) {
              const existing = changedFields.get(recordId) ?? new Set();
              for (const f of fields) existing.add(f);
              changedFields.set(recordId, existing);
            }
          }
          recordMap.set(recordId, change.old_values);
        }
      }
    }

    const data = Array.from(recordMap.values());
    const diff: Record<string, string[]> = {};
    for (const [id, fields] of changedFields.entries()) {
      diff[id] = Array.from(fields);
    }

    return {
      data,
      timestamp: targetDate.toISOString(),
      total: data.length,
      changedFields: diff,
    };
  });

  // ─── RLS Rules ───────────────────────────────────────────

  // GET /api/projects/:projectId/rls — list rules
  app.get('/:projectId/rls', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const rules = await rlsService.listRules(projectId);
    return { rules };
  });

  // POST /api/projects/:projectId/rls — create rule
  app.post('/:projectId/rls', async (request) => {
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

  // DELETE /api/projects/:projectId/rls/:ruleId — delete rule
  app.delete('/:projectId/rls/:ruleId', async (request, reply) => {
    const { ruleId } = request.params as { ruleId: string };
    await rlsService.deleteRule(ruleId);
    return reply.status(204).send();
  });

  // ─── Validation Rules ───────────────────────────────────

  // GET /api/projects/:projectId/tables/:tableName/validations
  app.get('/:projectId/tables/:tableName/validations', async (request) => {
    const { tableName } = request.params as { tableName: string };
    const projectId = resolveProjectId(request);
    const rules = await validationService.getRules(projectId, tableName);
    return { rules };
  });

  // POST /api/projects/:projectId/tables/:tableName/validations
  app.post('/:projectId/tables/:tableName/validations', async (request) => {
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

  // DELETE /api/projects/:projectId/tables/:tableName/validations/:ruleId
  app.delete('/:projectId/tables/:tableName/validations/:ruleId', async (request, reply) => {
    const { ruleId } = request.params as { ruleId: string };
    await validationService.deleteRule(ruleId);
    return reply.status(204).send();
  });

  // ─── Record Comments ─────────────────────────────────────

  // GET /api/projects/:projectId/tables/:tableName/comments/counts — batch comment counts
  app.get('/:projectId/tables/:tableName/comments/counts', async (request) => {
    const { projectId, tableName } = request.params as { projectId: string; tableName: string };
    const counts = await commentsService.getCounts(projectId, tableName);
    return { counts };
  });

  // GET /api/projects/:projectId/tables/:tableName/data/:recordId/comments
  app.get('/:projectId/tables/:tableName/data/:recordId/comments', async (request) => {
    const { projectId, tableName, recordId } = request.params as { projectId: string; tableName: string; recordId: string };
    const comments = await commentsService.list(projectId, tableName, recordId);
    return { comments };
  });

  // POST /api/projects/:projectId/tables/:tableName/data/:recordId/comments
  app.post('/:projectId/tables/:tableName/data/:recordId/comments', async (request) => {
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

  // DELETE /api/projects/:projectId/tables/:tableName/data/:recordId/comments/:commentId
  app.delete('/:projectId/tables/:tableName/data/:recordId/comments/:commentId', async (request, reply) => {
    const { commentId } = request.params as { commentId: string };
    await commentsService.delete(commentId);
    return reply.status(204).send();
  });

  // ─── Database Seeding ───────────────────────────────────

  // POST /api/projects/:projectId/tables/:tableName/seed
  app.post('/:projectId/tables/:tableName/seed', async (request) => {
    const { tableName } = request.params as { tableName: string };
    const dbSchema = resolveProjectSchema(request);
    const body = z.object({
      count: z.number().int().min(1).max(50),
      generators: z.record(z.string()),
    }).parse(request.body);

    // Dynamic import of seeding service
    const { SeedingService } = await import('./seeding.service.js');
    const seedingService = new SeedingService();

    // Get column info for the table
    const columnsResult = await app.db.raw(`
      SELECT column_name as name, data_type as type, udt_name as udt_type
      FROM information_schema.columns
      WHERE table_schema = ? AND table_name = ?
      ORDER BY ordinal_position
    `, [dbSchema, tableName]);

    const records = seedingService.generateRecords(
      dbSchema, tableName, columnsResult.rows, body.count, body.generators
    );

    // Filter out empty records (no columns mapped)
    const validRecords = records.filter((r) => Object.keys(r).length > 0);
    if (validRecords.length === 0) {
      return { inserted: 0, total: 0, error: 'No columns mapped for seeding' };
    }

    // Insert in batches
    const batchSize = 500;
    let inserted = 0;
    for (let i = 0; i < validRecords.length; i += batchSize) {
      const batch = validRecords.slice(i, i + batchSize);
      await app.db(`${dbSchema}.${tableName}`).insert(batch);
      inserted += batch.length;
    }

    return { inserted, total: validRecords.length };
  });
}
