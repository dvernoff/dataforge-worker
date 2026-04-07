import type { FastifyInstance } from 'fastify';
import { SchemaService } from './schema.service.js';
import { ComputedColumnService } from './computed.service.js';
import { VersioningService } from './versioning.service.js';
import { nodeAuthMiddleware } from '../../middleware/node-auth.middleware.js';
import { requireWorkerRole } from '../../middleware/worker-rbac.middleware.js';
import { z } from 'zod';
import { AppError } from '../../middleware/error-handler.js';

const columnSchema = z.object({
  name: z.string().min(1).max(63).regex(/^[a-z_][a-z0-9_]*$/),
  type: z.string(),
  nullable: z.boolean().default(true),
  default_value: z.string().optional(),
  is_unique: z.boolean().default(false),
  is_primary: z.boolean().default(false),
});

const createTableSchema = z.object({
  name: z.string().min(1).max(63).regex(/^[a-z_][a-z0-9_]*$/),
  columns: z.array(columnSchema).min(1),
  add_timestamps: z.boolean().default(true),
  add_uuid_pk: z.boolean().default(true),
});

const alterColumnsSchema = z.object({
  changes: z.array(z.object({
    action: z.enum(['add', 'alter', 'drop', 'rename']),
    name: z.string(),
    newName: z.string().optional(),
    type: z.string().optional(),
    nullable: z.boolean().optional(),
    default_value: z.string().nullable().optional(),
    is_unique: z.boolean().optional(),
  })).min(1),
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
    const dbSchema = resolveProjectSchema(request);
    const table = await schemaService.getTableInfo(dbSchema, tableName);
    return { table };
  });

  app.post('/:projectId/tables', async (request) => {
    const body = createTableSchema.parse(request.body);
    const dbSchema = resolveProjectSchema(request);
    const sql = await schemaService.createTable(dbSchema, body);
    return { success: true, sql };
  });

  app.post('/:projectId/tables/preview', async (request) => {
    const body = createTableSchema.parse(request.body);
    const dbSchema = resolveProjectSchema(request);
    const sql = schemaService.previewCreateTable(dbSchema, body);
    return { sql };
  });

  app.put('/:projectId/tables/:tableName/columns', async (request) => {
    const { tableName } = request.params as { tableName: string };
    const body = alterColumnsSchema.parse(request.body);
    const dbSchema = resolveProjectSchema(request);
    const sqls = await schemaService.alterColumns(dbSchema, tableName, body.changes);
    return { success: true, sqls };
  });

  app.delete('/:projectId/tables/:tableName', async (request) => {
    const { tableName } = request.params as { tableName: string };
    const dbSchema = resolveProjectSchema(request);
    const projectId = request.projectId;
    const deleted = await schemaService.dropTable(dbSchema, tableName, projectId);
    return { success: true, cleaned: deleted };
  });

  app.post('/:projectId/tables/:tableName/foreign-keys', async (request) => {
    const { tableName } = request.params as { tableName: string };
    const body = foreignKeySchema.parse(request.body);
    const dbSchema = resolveProjectSchema(request);
    const sql = await schemaService.addForeignKey(dbSchema, tableName, body);
    return { success: true, sql };
  });

  app.delete('/:projectId/tables/:tableName/foreign-keys/:constraintName', async (request, reply) => {
    const { tableName, constraintName } = request.params as {
      tableName: string; constraintName: string;
    };
    const dbSchema = resolveProjectSchema(request);
    await schemaService.dropForeignKey(dbSchema, tableName, constraintName);
    return reply.status(204).send();
  });

  app.post('/:projectId/tables/:tableName/indexes', async (request) => {
    const { tableName } = request.params as { tableName: string };
    const body = indexDefSchema.parse(request.body);
    const dbSchema = resolveProjectSchema(request);
    const sql = await schemaService.addIndex(dbSchema, tableName, body);
    return { success: true, sql };
  });

  app.delete('/:projectId/tables/:tableName/indexes/:indexName', async (request, reply) => {
    const { indexName } = request.params as { indexName: string };
    const dbSchema = resolveProjectSchema(request);
    await schemaService.dropIndex(dbSchema, indexName);
    return reply.status(204).send();
  });

  app.post('/:projectId/tables/:tableName/computed', async (request) => {
    const { tableName } = request.params as { tableName: string };
    const body = computedColumnSchema.parse(request.body);
    const dbSchema = resolveProjectSchema(request);
    const sql = await computedService.addComputedColumn(
      dbSchema, tableName, body.name, body.expression, body.return_type
    );
    return { success: true, sql };
  });

  app.delete('/:projectId/tables/:tableName/computed/:columnName', async (request, reply) => {
    const { tableName, columnName } = request.params as { tableName: string; columnName: string };
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

  app.post('/:projectId/schema-versions', async (request) => {
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
    config: { rawBody: false },
    schema: { body: { type: 'object', additionalProperties: true } },
  }, async (request) => {
    const { projectId, versionId } = request.params as { projectId: string; versionId: string };
    const dbSchema = resolveProjectSchema(request);
    await versioningService.rollback(projectId, dbSchema, versionId);
    return { success: true };
  });
}
