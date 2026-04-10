import type { FastifyInstance } from 'fastify';
import { authenticateAiRequest } from './ai-auth.middleware.js';
import { AiGatewayService } from './ai-gateway.service.js';

const VALID_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const VALID_SOURCE_TYPES = new Set(['table', 'custom_sql', 'composite']);
const VALID_COL_TYPES = new Set(['text','integer','bigint','float','decimal','boolean','date','timestamp','timestamptz','uuid','json','jsonb','text[]','integer[]','serial','bigserial']);

function validateCreateTable(body: Record<string, unknown>) {
  if (!body.name || typeof body.name !== 'string') return 'Missing "name" (string). Example: "users"';
  if (!Array.isArray(body.columns) || body.columns.length === 0) return 'Missing "columns" (non-empty array). Example: [{"name":"email","type":"text","nullable":false,"is_unique":true,"is_primary":false}]';
  for (const col of body.columns as Record<string, unknown>[]) {
    if (!col.name) return `Column missing "name"`;
    if (!col.type) return `Column "${col.name}" missing "type". Valid: ${[...VALID_COL_TYPES].join(', ')}`;
    if (!VALID_COL_TYPES.has(col.type as string)) return `Column "${col.name}": unknown type "${col.type}". Valid: ${[...VALID_COL_TYPES].join(', ')}`;
  }
  return null;
}

function validateCreateEndpoint(body: Record<string, unknown>) {
  if (!body.method || !VALID_METHODS.has((body.method as string).toUpperCase())) return `Invalid "method". Must be one of: ${[...VALID_METHODS].join(', ')}`;
  if (!body.path || typeof body.path !== 'string' || !(body.path as string).startsWith('/')) return 'Missing "path" (must start with /). Example: "/users"';
  if (!body.source_type || !VALID_SOURCE_TYPES.has(body.source_type as string)) return `Invalid "source_type". Must be: ${[...VALID_SOURCE_TYPES].join(', ')}`;
  if (!body.source_config || typeof body.source_config !== 'object') return 'Missing "source_config" (object). For custom_sql: {"query":"SELECT ..."}. For table: {"table":"users","operation":"find"}';
  const cfg = body.source_config as Record<string, unknown>;
  if (body.source_type === 'custom_sql' && (!cfg.query || typeof cfg.query !== 'string')) return 'source_config.query is required for custom_sql. Example: {"query":"SELECT * FROM users WHERE id = {{id}}"}';
  if (body.source_type === 'table' && !cfg.table) return 'source_config.table is required. Example: {"table":"users","operation":"find"}';
  body.method = (body.method as string).toUpperCase();
  return null;
}

export async function aiRestGatewayRoutes(app: FastifyInstance) {
  const service = new AiGatewayService(app.db);

  async function withAuth(request: Parameters<typeof authenticateAiRequest>[0], reply: Parameters<typeof authenticateAiRequest>[1]) {
    return authenticateAiRequest(request, reply, app.db, app.redis, 'ai-rest-gateway');
  }

  async function logged(projectId: string, tool: string, fn: () => Promise<unknown>) {
    const start = Date.now();
    try {
      const result = await fn();
      await service.logActivity({ project_id: projectId, gateway_type: 'rest', tool_name: tool, request_summary: null, response_status: 200, duration_ms: Date.now() - start });
      return { success: true, data: result };
    } catch (err) {
      const duration = Date.now() - start;
      await service.logActivity({ project_id: projectId, gateway_type: 'rest', tool_name: tool, request_summary: null, response_status: 500, duration_ms: duration });
      throw err;
    }
  }

  app.get('/api/v1/:projectSlug/ai/info', async (request, reply) => {
    const auth = await withAuth(request, reply);
    if (!auth) return;
    return logged(auth.project.id, 'get_project_info', () => Promise.resolve(service.getProjectInfo()));
  });

  app.get('/api/v1/:projectSlug/ai/context', async (request, reply) => {
    const auth = await withAuth(request, reply);
    if (!auth) return;
    return logged(auth.project.id, 'get_context', () => service.getContext(auth.project.id, auth.project.db_schema));
  });

  app.post('/api/v1/:projectSlug/ai/tables', async (request, reply) => {
    const auth = await withAuth(request, reply);
    if (!auth) return;
    const body = request.body as Record<string, unknown>;
    const err = validateCreateTable(body);
    if (err) return reply.status(400).send({ error: err });
    return logged(auth.project.id, 'create_table', () =>
      service.createTable(auth.project.db_schema, body as Parameters<AiGatewayService['createTable']>[1])
    );
  });

  app.put('/api/v1/:projectSlug/ai/tables/:tableName/columns', async (request, reply) => {
    const auth = await withAuth(request, reply);
    if (!auth) return;
    const { tableName } = request.params as { tableName: string };
    const { changes } = request.body as { changes: unknown[] };
    return logged(auth.project.id, 'alter_columns', () =>
      service.alterColumns(auth.project.db_schema, tableName, changes)
    );
  });

  app.delete('/api/v1/:projectSlug/ai/tables/:tableName', async (request, reply) => {
    const auth = await withAuth(request, reply);
    if (!auth) return;
    const { tableName } = request.params as { tableName: string };
    return logged(auth.project.id, 'drop_table', () =>
      service.dropTable(auth.project.db_schema, tableName, auth.project.id)
    );
  });

  app.post('/api/v1/:projectSlug/ai/tables/:tableName/indexes', async (request, reply) => {
    const auth = await withAuth(request, reply);
    if (!auth) return;
    const { tableName } = request.params as { tableName: string };
    const body = request.body as { columns: string[]; type: string; is_unique: boolean; name?: string };
    return logged(auth.project.id, 'add_index', () =>
      service.addIndex(auth.project.db_schema, tableName, body)
    );
  });

  app.delete('/api/v1/:projectSlug/ai/tables/:tableName/indexes/:indexName', async (request, reply) => {
    const auth = await withAuth(request, reply);
    if (!auth) return;
    const { indexName } = request.params as { tableName: string; indexName: string };
    return logged(auth.project.id, 'drop_index', () =>
      service.dropIndex(auth.project.db_schema, indexName)
    );
  });

  app.post('/api/v1/:projectSlug/ai/tables/:tableName/foreign-keys', async (request, reply) => {
    const auth = await withAuth(request, reply);
    if (!auth) return;
    const { tableName } = request.params as { tableName: string };
    const body = request.body as Parameters<AiGatewayService['addForeignKey']>[2];
    return logged(auth.project.id, 'add_foreign_key', () =>
      service.addForeignKey(auth.project.db_schema, tableName, body)
    );
  });

  app.delete('/api/v1/:projectSlug/ai/tables/:tableName/foreign-keys/:constraintName', async (request, reply) => {
    const auth = await withAuth(request, reply);
    if (!auth) return;
    const { tableName, constraintName } = request.params as { tableName: string; constraintName: string };
    return logged(auth.project.id, 'drop_foreign_key', () =>
      service.dropForeignKey(auth.project.db_schema, tableName, constraintName)
    );
  });

  app.post('/api/v1/:projectSlug/ai/endpoints', async (request, reply) => {
    const auth = await withAuth(request, reply);
    if (!auth) return;
    const body = request.body as Record<string, unknown>;
    const err = validateCreateEndpoint(body);
    if (err) return reply.status(400).send({ error: err });
    return logged(auth.project.id, 'create_endpoint', () =>
      service.createEndpoint(auth.project.id, body)
    );
  });

  app.put('/api/v1/:projectSlug/ai/endpoints/:endpointId', async (request, reply) => {
    const auth = await withAuth(request, reply);
    if (!auth) return;
    const { endpointId } = request.params as { endpointId: string };
    const body = request.body as Record<string, unknown>;
    return logged(auth.project.id, 'update_endpoint', () =>
      service.updateEndpoint(endpointId, auth.project.id, body)
    );
  });

  app.delete('/api/v1/:projectSlug/ai/endpoints/:endpointId', async (request, reply) => {
    const auth = await withAuth(request, reply);
    if (!auth) return;
    const { endpointId } = request.params as { endpointId: string };
    return logged(auth.project.id, 'delete_endpoint', () =>
      service.deleteEndpoint(endpointId, auth.project.id)
    );
  });

  app.post('/api/v1/:projectSlug/ai/execute-sql', async (request, reply) => {
    const auth = await withAuth(request, reply);
    if (!auth) return;
    const { query, timeout } = request.body as { query: string; timeout?: number };
    if (!query) return reply.status(400).send({ error: 'query is required' });
    return logged(auth.project.id, 'execute_sql', () =>
      service.executeSql(auth.project.db_schema, query, timeout)
    );
  });
}
