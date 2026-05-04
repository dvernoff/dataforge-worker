import type { FastifyInstance } from 'fastify';
import { SchemaService } from './schema.service.js';
import { ComputedColumnService } from './computed.service.js';
import { VersioningService } from './versioning.service.js';
import { nodeAuthMiddleware } from '../../middleware/node-auth.middleware.js';
import { requireWorkerRole } from '../../middleware/worker-rbac.middleware.js';
import { z } from 'zod';
import { AppError } from '../../middleware/error-handler.js';
import { validateIdentifier } from '../../utils/sql-guard.js';
import { checkResourceQuota } from '../../middleware/quota-enforcement.middleware.js';

const columnSchema = z.object({
  name: z.string().min(1).max(63).regex(/^[a-z_][a-z0-9_]*$/),
  type: z.string(),
  nullable: z.boolean().default(true),
  default_value: z.string().optional(),
  is_unique: z.boolean().default(false),
  is_primary: z.boolean().default(false),
  check: z.string().optional(),
});

const storageParamsSchema = z.object({
  fillfactor: z.number().min(10).max(100).optional(),
  autovacuum_vacuum_scale_factor: z.number().min(0).max(1).optional(),
  autovacuum_vacuum_threshold: z.number().min(0).optional(),
  autovacuum_analyze_scale_factor: z.number().min(0).max(1).optional(),
  autovacuum_analyze_threshold: z.number().min(0).optional(),
}).optional();

const createTableSchema = z.object({
  name: z.string().min(1).max(63).regex(/^[a-z_][a-z0-9_]*$/),
  columns: z.array(columnSchema).min(1),
  add_timestamps: z.boolean().default(true),
  add_uuid_pk: z.boolean().default(true),
  add_created_at: z.boolean().optional(),
  add_updated_at: z.boolean().optional(),
  index_created_at: z.boolean().optional(),
  index_updated_at: z.boolean().optional(),
  checks: z.array(z.object({ name: z.string().optional(), expression: z.string().min(1) })).optional(),
  storage_params: storageParamsSchema,
});

const alterColumnsSchema = z.object({
  changes: z.array(z.object({
    action: z.enum(['add', 'alter', 'drop', 'rename', 'set_primary_key', 'drop_primary_key', 'drop_constraint']),
    name: z.string().optional(),
    newName: z.string().optional(),
    type: z.string().optional(),
    nullable: z.boolean().optional(),
    default_value: z.string().nullable().optional(),
    is_unique: z.boolean().optional(),
    check: z.string().optional(),
    columns: z.array(z.string()).optional(),
    constraint_name: z.string().optional(),
  })).default([]),
  storage_params: storageParamsSchema,
});

const foreignKeySchema = z.object({
  source_column: z.string(),
  target_table: z.string(),
  target_column: z.string(),
  on_delete: z.enum(['CASCADE', 'SET NULL', 'RESTRICT', 'NO ACTION']).default('RESTRICT'),
  on_update: z.enum(['CASCADE', 'SET NULL', 'RESTRICT', 'NO ACTION']).default('CASCADE'),
  constraint_name: z.string().optional(),
});

const indexDefSchema = z.object({
  columns: z.array(z.string()).min(1),
  type: z.enum(['btree', 'hash', 'gin', 'gist']).default('btree'),
  is_unique: z.boolean().default(false),
  name: z.string().optional(),
});

function resolveProjectSchema(request: any): string {
  const schema = request.projectSchema;
  if (!schema) throw new AppError(400, 'Missing project schema header');
  return schema;
}

const computedColumnSchema = z.object({
  name: z.string().min(1).max(63).regex(/^[a-z_][a-z0-9_]*$/),
  expression: z.string().min(1),
  return_type: z.string().min(1),
});

const createVersionSchema = z.object({
  description: z.string().min(1).max(500),
});

export async function schemaRoutes(app: FastifyInstance) {
  const schemaService = new SchemaService(app.db);
  const computedService = new ComputedColumnService(app.db);
  const versioningService = new VersioningService(app.db);

  app.addHook('preHandler', nodeAuthMiddleware);
  app.addHook('preHandler', requireWorkerRole('viewer'));

  app.get('/:projectId/tables', async (request) => {
    const dbSchema = resolveProjectSchema(request);
    const tables = await schemaService.listTables(dbSchema);
    return { tables };
  });

  app.get('/:projectId/tables/:tableName', async (request) => {
    const { tableName } = request.params as { tableName: string };
    validateIdentifier(tableName, 'table name');
    const dbSchema = resolveProjectSchema(request);
    const table = await schemaService.describeTable(dbSchema, tableName);
    return { table };
  });

  app.post('/:projectId/tables', { preHandler: [requireWorkerRole('admin')] }, async (request, reply) => {
    if (request.isSharedNode && request.quotas) {
      const dbSchema = resolveProjectSchema(request);
      const blocked = await checkResourceQuota(app.db, request.projectId, 'tables', request.quotas, dbSchema);
      if (blocked) return reply.status(429).send({ error: blocked, errorCode: 'QUOTA_EXCEEDED' });
    }
    const body = createTableSchema.parse(request.body);
    const dbSchema = resolveProjectSchema(request);
    const sql = await schemaService.createTable(dbSchema, body);
    return { success: true, sql };
  });

  app.post('/:projectId/tables/preview', { preHandler: [requireWorkerRole('admin')] }, async (request) => {
    const body = createTableSchema.parse(request.body);
    const dbSchema = resolveProjectSchema(request);
    const sql = schemaService.previewCreateTable(dbSchema, body);
    return { sql };
  });

  app.put('/:projectId/tables/:tableName/columns', { preHandler: [requireWorkerRole('admin')] }, async (request) => {
    const { tableName } = request.params as { tableName: string };
    validateIdentifier(tableName, 'table name');
    const body = alterColumnsSchema.parse(request.body);
    const dbSchema = resolveProjectSchema(request);
    const sqls = await schemaService.alterColumns(dbSchema, tableName, body.changes as Parameters<SchemaService['alterColumns']>[2], { storage_params: body.storage_params });
    return { success: true, sqls };
  });

  app.delete('/:projectId/tables/:tableName', { preHandler: [requireWorkerRole('admin')] }, async (request) => {
    const { tableName } = request.params as { tableName: string };
    validateIdentifier(tableName, 'table name');
    const dbSchema = resolveProjectSchema(request);
    const projectId = request.projectId;
    const deleted = await schemaService.dropTable(dbSchema, tableName, projectId);
    return { success: true, cleaned: deleted };
  });

  app.post('/:projectId/tables/:tableName/truncate', { preHandler: [requireWorkerRole('admin')] }, async (request) => {
    const { tableName } = request.params as { tableName: string };
    validateIdentifier(tableName, 'table name');
    const dbSchema = resolveProjectSchema(request);
    const body = (request.body ?? {}) as { cascade?: boolean; restart_identity?: boolean };
    return schemaService.truncateTable(dbSchema, tableName, {
      cascade: !!body.cascade,
      restart_identity: !!body.restart_identity,
    });
  });

  app.post('/:projectId/tables/:tableName/foreign-keys', { preHandler: [requireWorkerRole('admin')] }, async (request) => {
    const { tableName } = request.params as { tableName: string };
    validateIdentifier(tableName, 'table name');
    const body = foreignKeySchema.parse(request.body);
    const dbSchema = resolveProjectSchema(request);
    const sql = await schemaService.addForeignKey(dbSchema, tableName, body);
    return { success: true, sql };
  });

  app.delete('/:projectId/tables/:tableName/foreign-keys/:constraintName', { preHandler: [requireWorkerRole('admin')] }, async (request, reply) => {
    const { tableName, constraintName } = request.params as {
      tableName: string; constraintName: string;
    };
    validateIdentifier(tableName, 'table name');
    validateIdentifier(constraintName, 'constraint name');
    const dbSchema = resolveProjectSchema(request);
    await schemaService.dropForeignKey(dbSchema, tableName, constraintName);
    return reply.status(204).send();
  });

  app.post('/:projectId/tables/:tableName/indexes', { preHandler: [requireWorkerRole('admin')] }, async (request) => {
    const { tableName } = request.params as { tableName: string };
    validateIdentifier(tableName, 'table name');
    const body = indexDefSchema.parse(request.body);
    const dbSchema = resolveProjectSchema(request);
    const sql = await schemaService.addIndex(dbSchema, tableName, body);
    return { success: true, sql };
  });

  app.delete('/:projectId/tables/:tableName/indexes/:indexName', { preHandler: [requireWorkerRole('admin')] }, async (request, reply) => {
    const { tableName, indexName } = request.params as { tableName: string; indexName: string };
    validateIdentifier(tableName, 'table name');
    validateIdentifier(indexName, 'index name');
    const dbSchema = resolveProjectSchema(request);
    await schemaService.dropIndex(dbSchema, indexName);
    return reply.status(204).send();
  });

  app.post('/:projectId/tables/:tableName/computed', { preHandler: [requireWorkerRole('admin')] }, async (request) => {
    const { tableName } = request.params as { tableName: string };
    validateIdentifier(tableName, 'table name');
    const body = computedColumnSchema.parse(request.body);
    const dbSchema = resolveProjectSchema(request);
    const sql = await computedService.addComputedColumn(
      dbSchema, tableName, body.name, body.expression, body.return_type
    );
    return { success: true, sql };
  });

  app.delete('/:projectId/tables/:tableName/computed/:columnName', { preHandler: [requireWorkerRole('admin')] }, async (request, reply) => {
    const { tableName, columnName } = request.params as { tableName: string; columnName: string };
    validateIdentifier(tableName, 'table name');
    validateIdentifier(columnName, 'column name');
    const dbSchema = resolveProjectSchema(request);
    await computedService.dropComputedColumn(dbSchema, tableName, columnName);
    return reply.status(204).send();
  });

  app.get('/:projectId/schema-versions', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const versions = await versioningService.listVersions(projectId);
    return { versions };
  });

  app.get('/:projectId/schema-versions/:versionId', async (request) => {
    const { versionId } = request.params as { versionId: string };
    const version = await versioningService.getVersion(versionId);
    return { version };
  });

  app.post('/:projectId/schema-versions', { preHandler: [requireWorkerRole('admin')] }, async (request) => {
    const { projectId } = request.params as { projectId: string };
    const body = createVersionSchema.parse(request.body);
    const dbSchema = resolveProjectSchema(request);
    const userId = request.userId ?? 'system';
    const version = await versioningService.captureVersion(
      projectId, dbSchema, body.description, userId
    );
    return { version };
  });

  app.post('/:projectId/schema-versions/:versionId/rollback', {
    preHandler: [requireWorkerRole('admin')],
    config: { rawBody: false },
    schema: { body: { type: 'object', additionalProperties: true } },
  }, async (request) => {
    const { projectId, versionId } = request.params as { projectId: string; versionId: string };
    const dbSchema = resolveProjectSchema(request);
    await versioningService.rollback(projectId, dbSchema, versionId);
    return { success: true };
  });

  app.get('/:projectId/materialized-views', async (request) => {
    const dbSchema = resolveProjectSchema(request);
    return { views: await schemaService.listMaterializedViews(dbSchema) };
  });

  app.post('/:projectId/materialized-views', { preHandler: [requireWorkerRole('admin')] }, async (request) => {
    const dbSchema = resolveProjectSchema(request);
    const body = z.object({
      name: z.string().min(1).regex(/^[a-z_][a-z0-9_]*$/),
      query: z.string().min(1),
      refresh_concurrently: z.boolean().optional(),
    }).parse(request.body);
    return schemaService.createMaterializedView(dbSchema, body);
  });

  app.post('/:projectId/materialized-views/:name/refresh', { preHandler: [requireWorkerRole('admin')] }, async (request) => {
    const dbSchema = resolveProjectSchema(request);
    const { name } = request.params as { name: string };
    validateIdentifier(name, 'view name');
    const concurrently = (request.query as Record<string, string>)?.concurrently === '1';
    const sql = `REFRESH MATERIALIZED VIEW ${concurrently ? 'CONCURRENTLY ' : ''}"${dbSchema}"."${name}"`;
    await request.server.db.raw(sql);
    return { refreshed: `${dbSchema}.${name}`, concurrently };
  });

  app.delete('/:projectId/materialized-views/:name', { preHandler: [requireWorkerRole('admin')] }, async (request, reply) => {
    const dbSchema = resolveProjectSchema(request);
    const { name } = request.params as { name: string };
    validateIdentifier(name, 'view name');
    await request.server.db.raw(`DROP MATERIALIZED VIEW IF EXISTS "${dbSchema}"."${name}" CASCADE`);
    return reply.status(204).send();
  });

  app.get('/:projectId/schema-quality', async (request) => {
    const dbSchema = resolveProjectSchema(request);
    const issues: Array<{ severity: 'low' | 'medium' | 'high'; code: string; message: string; table?: string }> = [];

    const tables: any = await request.server.db.raw(`
      SELECT t.relname AS name, t.reltuples::bigint AS estimated_rows,
             pg_total_relation_size(t.oid) AS size_bytes,
             (SELECT COUNT(*) FROM pg_index i WHERE i.indrelid = t.oid) AS index_count,
             (SELECT COUNT(*) FROM pg_index i WHERE i.indrelid = t.oid AND i.indisprimary) AS has_pk
      FROM pg_class t JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = ? AND t.relkind = 'r'
    `, [dbSchema]);

    for (const r of tables.rows) {
      if (Number(r.has_pk) === 0) {
        issues.push({ severity: 'high', code: 'NO_PRIMARY_KEY', message: 'Table has no primary key.', table: r.name });
      }
      if (Number(r.estimated_rows) > 100_000 && Number(r.index_count) <= 1) {
        issues.push({ severity: 'medium', code: 'LARGE_TABLE_FEW_INDEXES', message: `Table has ~${r.estimated_rows} rows but only ${r.index_count} index(es).`, table: r.name });
      }
    }

    const unused: any = await request.server.db.raw(`
      SELECT relname AS table, indexrelname AS index
      FROM pg_stat_user_indexes
      WHERE schemaname = ? AND idx_scan = 0
    `, [dbSchema]).catch(() => ({ rows: [] }));
    for (const r of unused.rows) {
      issues.push({ severity: 'low', code: 'UNUSED_INDEX', message: `Index "${r.index}" has never been used.`, table: r.table });
    }

    return { tables_checked: tables.rows.length, issues, tables: tables.rows.map((r: any) => ({
      name: r.name,
      estimated_rows: Number(r.estimated_rows),
      size_bytes: Number(r.size_bytes),
      index_count: Number(r.index_count),
      has_pk: Number(r.has_pk) > 0,
    })) };
  });
}
