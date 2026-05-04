import type { FastifyInstance } from 'fastify';
import { authenticateAiRequest } from './ai-auth.middleware.js';
import { AiGatewayService } from './ai-gateway.service.js';

const VALID_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const VALID_SOURCE_TYPES = new Set(['table', 'custom_sql', 'composite']);
const VALID_COL_TYPES = new Set(['text','integer','bigint','float','decimal','boolean','date','timestamp','timestamptz','uuid','json','jsonb','inet','cidr','macaddr','text[]','integer[]','inet[]','serial','bigserial']);

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
  const service = new AiGatewayService(app.db, app.redis);

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

  app.get('/api/v1/:projectSlug/ai/tables', async (request, reply) => {
    const auth = await withAuth(request, reply);
    if (!auth) return;
    return logged(auth.project.id, 'list_tables', () => service.listTables(auth.project.db_schema));
  });

  app.get('/api/v1/:projectSlug/ai/tables/:tableName', async (request, reply) => {
    const auth = await withAuth(request, reply);
    if (!auth) return;
    const { tableName } = request.params as { tableName: string };
    return logged(auth.project.id, 'describe_table', () => service.describeTable(auth.project.db_schema, tableName));
  });

  app.get('/api/v1/:projectSlug/ai/endpoints', async (request, reply) => {
    const auth = await withAuth(request, reply);
    if (!auth) return;
    const q = request.query as { method?: string; path_contains?: string };
    return logged(auth.project.id, 'list_endpoints', () => service.listEndpointsFiltered(auth.project.id, q));
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
    const { changes, storage_params } = request.body as { changes?: unknown[]; storage_params?: Record<string, number> };
    return logged(auth.project.id, 'alter_columns', () =>
      service.alterColumns(auth.project.db_schema, tableName, changes ?? [], { storage_params })
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

  app.post('/api/v1/:projectSlug/ai/tables/:tableName/truncate', async (request, reply) => {
    const auth = await withAuth(request, reply);
    if (!auth) return;
    const { tableName } = request.params as { tableName: string };
    const body = request.body as { cascade?: boolean; restart_identity?: boolean } | undefined;
    return logged(auth.project.id, 'truncate_table', () =>
      service.truncateTable(auth.project.db_schema, tableName, body ?? {})
    );
  });

  app.post('/api/v1/:projectSlug/ai/tables/:tableName/indexes', async (request, reply) => {
    const auth = await withAuth(request, reply);
    if (!auth) return;
    const { tableName } = request.params as { tableName: string };
    const body = request.body as {
      columns?: string[];
      expressions?: string[];
      type: string;
      is_unique: boolean;
      name?: string;
      where?: string;
      include?: string[];
    };
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

  app.post('/api/v1/:projectSlug/ai/endpoints/bulk', async (request, reply) => {
    const auth = await withAuth(request, reply);
    if (!auth) return;
    const body = request.body as { updates?: Array<{ endpoint_id: string } & Record<string, unknown>> };
    if (!Array.isArray(body?.updates) || body.updates.length === 0) {
      return reply.status(400).send({ error: 'updates must be a non-empty array' });
    }
    return logged(auth.project.id, 'bulk_update_endpoint', () =>
      service.bulkUpdateEndpoint(auth.project.id, body.updates!)
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

  app.get('/api/v1/:projectSlug/ai/timescale/hypertables', async (request, reply) => {
    const auth = await withAuth(request, reply);
    if (!auth) return;
    return logged(auth.project.id, 'list_hypertables', () => service.listHypertables(auth.project.db_schema));
  });

  app.post('/api/v1/:projectSlug/ai/timescale/hypertables', async (request, reply) => {
    const auth = await withAuth(request, reply);
    if (!auth) return;
    const body = request.body as Parameters<AiGatewayService['createHypertable']>[1];
    if (!body?.table || !body?.time_column) return reply.status(400).send({ error: 'table and time_column are required' });
    return logged(auth.project.id, 'create_hypertable', () => service.createHypertable(auth.project.db_schema, body));
  });

  app.post('/api/v1/:projectSlug/ai/timescale/continuous-aggregates', async (request, reply) => {
    const auth = await withAuth(request, reply);
    if (!auth) return;
    const body = request.body as Parameters<AiGatewayService['addContinuousAggregate']>[1];
    return logged(auth.project.id, 'add_continuous_aggregate', () => service.addContinuousAggregate(auth.project.db_schema, body));
  });

  app.post('/api/v1/:projectSlug/ai/timescale/compression-policies', async (request, reply) => {
    const auth = await withAuth(request, reply);
    if (!auth) return;
    const body = request.body as Parameters<AiGatewayService['addCompressionPolicy']>[1];
    return logged(auth.project.id, 'add_compression_policy', () => service.addCompressionPolicy(auth.project.db_schema, body));
  });

  app.post('/api/v1/:projectSlug/ai/timescale/retention-policies', async (request, reply) => {
    const auth = await withAuth(request, reply);
    if (!auth) return;
    const body = request.body as Parameters<AiGatewayService['addRetentionPolicy']>[1];
    return logged(auth.project.id, 'add_retention_policy', () => service.addRetentionPolicy(auth.project.db_schema, body));
  });

  app.get('/api/v1/:projectSlug/ai/timescale/continuous-aggregates', async (request, reply) => {
    const auth = await withAuth(request, reply);
    if (!auth) return;
    return logged(auth.project.id, 'list_continuous_aggregates', () => service.listContinuousAggregates(auth.project.db_schema));
  });

  app.get('/api/v1/:projectSlug/ai/timescale/jobs', async (request, reply) => {
    const auth = await withAuth(request, reply);
    if (!auth) return;
    return logged(auth.project.id, 'list_timescaledb_jobs', () => service.listTimescaleJobs(auth.project.db_schema));
  });

  app.get('/api/v1/:projectSlug/ai/timescale/retention-policies', async (request, reply) => {
    const auth = await withAuth(request, reply);
    if (!auth) return;
    return logged(auth.project.id, 'list_retention_policies', () => service.listRetentionPolicies(auth.project.db_schema));
  });

  app.get('/api/v1/:projectSlug/ai/timescale/compression-policies', async (request, reply) => {
    const auth = await withAuth(request, reply);
    if (!auth) return;
    return logged(auth.project.id, 'list_compression_policies', () => service.listCompressionPolicies(auth.project.db_schema));
  });

  app.post('/api/v1/:projectSlug/ai/timescale/continuous-aggregates/refresh', async (request, reply) => {
    const auth = await withAuth(request, reply);
    if (!auth) return;
    const body = request.body as Parameters<AiGatewayService['refreshContinuousAggregate']>[1];
    if (!body?.view_name) return reply.status(400).send({ error: 'view_name is required' });
    return logged(auth.project.id, 'refresh_continuous_aggregate', () => service.refreshContinuousAggregate(auth.project.db_schema, body));
  });

  app.delete('/api/v1/:projectSlug/ai/timescale/retention-policies/:table', async (request, reply) => {
    const auth = await withAuth(request, reply);
    if (!auth) return;
    const { table } = request.params as { table: string };
    return logged(auth.project.id, 'remove_retention_policy', () => service.removeRetentionPolicy(auth.project.db_schema, table));
  });

  app.delete('/api/v1/:projectSlug/ai/timescale/compression-policies/:table', async (request, reply) => {
    const auth = await withAuth(request, reply);
    if (!auth) return;
    const { table } = request.params as { table: string };
    return logged(auth.project.id, 'remove_compression_policy', () => service.removeCompressionPolicy(auth.project.db_schema, table));
  });

  app.delete('/api/v1/:projectSlug/ai/timescale/continuous-aggregates/:viewName/policy', async (request, reply) => {
    const auth = await withAuth(request, reply);
    if (!auth) return;
    const { viewName } = request.params as { viewName: string };
    return logged(auth.project.id, 'remove_continuous_aggregate_policy', () => service.removeContinuousAggregatePolicy(auth.project.db_schema, viewName));
  });

  app.put('/api/v1/:projectSlug/ai/timescale/retention-policies', async (request, reply) => {
    const auth = await withAuth(request, reply);
    if (!auth) return;
    const body = request.body as Parameters<AiGatewayService['updateRetentionPolicy']>[1];
    if (!body?.table || !body?.drop_after) return reply.status(400).send({ error: 'table and drop_after are required' });
    return logged(auth.project.id, 'update_retention_policy', () => service.updateRetentionPolicy(auth.project.db_schema, body));
  });

  app.put('/api/v1/:projectSlug/ai/timescale/compression-policies', async (request, reply) => {
    const auth = await withAuth(request, reply);
    if (!auth) return;
    const body = request.body as Parameters<AiGatewayService['updateCompressionPolicy']>[1];
    if (!body?.table || !body?.compress_after) return reply.status(400).send({ error: 'table and compress_after are required' });
    return logged(auth.project.id, 'update_compression_policy', () => service.updateCompressionPolicy(auth.project.db_schema, body));
  });

  app.put('/api/v1/:projectSlug/ai/timescale/continuous-aggregates/:viewName/policy', async (request, reply) => {
    const auth = await withAuth(request, reply);
    if (!auth) return;
    const { viewName } = request.params as { viewName: string };
    const body = request.body as { start_offset?: string; end_offset?: string; schedule_interval?: string };
    if (!body?.start_offset || !body?.end_offset || !body?.schedule_interval) {
      return reply.status(400).send({ error: 'start_offset, end_offset, schedule_interval are required' });
    }
    return logged(auth.project.id, 'update_continuous_aggregate_policy', () =>
      service.updateContinuousAggregatePolicy(auth.project.db_schema, { view_name: viewName, ...body } as Parameters<AiGatewayService['updateContinuousAggregatePolicy']>[1]),
    );
  });

  app.delete('/api/v1/:projectSlug/ai/timescale/continuous-aggregates/:viewName', async (request, reply) => {
    const auth = await withAuth(request, reply);
    if (!auth) return;
    const { viewName } = request.params as { viewName: string };
    const cascade = (request.query as Record<string, string>)?.cascade === 'true';
    return logged(auth.project.id, 'drop_continuous_aggregate', () => service.dropContinuousAggregate(auth.project.db_schema, viewName, cascade));
  });

  app.delete('/api/v1/:projectSlug/ai/timescale/hypertables/:table', async (request, reply) => {
    const auth = await withAuth(request, reply);
    if (!auth) return;
    const { table } = request.params as { table: string };
    const cascade = (request.query as Record<string, string>)?.cascade === 'true';
    return logged(auth.project.id, 'drop_hypertable', () => service.dropHypertable(auth.project.db_schema, table, cascade));
  });

  app.post('/api/v1/:projectSlug/ai/timescale/hypertables/:hypertable/drop-chunks', async (request, reply) => {
    const auth = await withAuth(request, reply);
    if (!auth) return;
    const { hypertable } = request.params as { hypertable: string };
    const body = request.body as { older_than?: string };
    if (!body?.older_than) return reply.status(400).send({ error: 'older_than is required' });
    return logged(auth.project.id, 'drop_chunks', () => service.dropChunks(auth.project.db_schema, { hypertable, older_than: body.older_than! }));
  });

  app.put('/api/v1/:projectSlug/ai/timescale/jobs/:jobId', async (request, reply) => {
    const auth = await withAuth(request, reply);
    if (!auth) return;
    const { jobId } = request.params as { jobId: string };
    const body = request.body as { schedule_interval?: string; next_start?: string };
    return logged(auth.project.id, 'alter_timescaledb_job', () =>
      service.alterTimescaleJob(auth.project.db_schema, { job_id: Number(jobId), ...body }),
    );
  });

  app.post('/api/v1/:projectSlug/ai/timescale/jobs/:jobId/run', async (request, reply) => {
    const auth = await withAuth(request, reply);
    if (!auth) return;
    const { jobId } = request.params as { jobId: string };
    return logged(auth.project.id, 'run_timescaledb_job', () =>
      service.runTimescaleJob(auth.project.db_schema, { job_id: Number(jobId) }),
    );
  });

  app.post('/api/v1/:projectSlug/ai/timescale/chunks/:chunkName/compress', async (request, reply) => {
    const auth = await withAuth(request, reply);
    if (!auth) return;
    const { chunkName } = request.params as { chunkName: string };
    const body = (request.body ?? {}) as { if_not_compressed?: boolean };
    return logged(auth.project.id, 'compress_chunk', () =>
      service.compressChunk(auth.project.db_schema, { chunk_name: chunkName, ...body }),
    );
  });

  app.post('/api/v1/:projectSlug/ai/timescale/chunks/:chunkName/decompress', async (request, reply) => {
    const auth = await withAuth(request, reply);
    if (!auth) return;
    const { chunkName } = request.params as { chunkName: string };
    const body = (request.body ?? {}) as { if_compressed?: boolean };
    return logged(auth.project.id, 'decompress_chunk', () =>
      service.decompressChunk(auth.project.db_schema, { chunk_name: chunkName, ...body }),
    );
  });

  app.post('/api/v1/:projectSlug/ai/timescale/chunks/:chunkName/recompress', async (request, reply) => {
    const auth = await withAuth(request, reply);
    if (!auth) return;
    const { chunkName } = request.params as { chunkName: string };
    return logged(auth.project.id, 'recompress_chunk', () =>
      service.recompressChunk(auth.project.db_schema, { chunk_name: chunkName }),
    );
  });

  app.put('/api/v1/:projectSlug/ai/timescale/hypertables/:hypertable/chunk-interval', async (request, reply) => {
    const auth = await withAuth(request, reply);
    if (!auth) return;
    const { hypertable } = request.params as { hypertable: string };
    const body = request.body as { new_interval?: string };
    if (!body?.new_interval) return reply.status(400).send({ error: 'new_interval is required' });
    return logged(auth.project.id, 'set_chunk_time_interval', () =>
      service.setChunkTimeInterval(auth.project.db_schema, { hypertable, new_interval: body.new_interval! }),
    );
  });

  app.post('/api/v1/:projectSlug/ai/execute-sql-mutation', async (request, reply) => {
    const auth = await withAuth(request, reply);
    if (!auth) return;
    const body = request.body as {
      query?: string;
      confirm_write?: boolean;
      params?: Record<string, unknown>;
      returning?: boolean;
      dry_run?: boolean;
      timeout?: number;
    };
    if (!body.query) return reply.status(400).send({ error: 'query is required' });
    if (body.confirm_write !== true) return reply.status(400).send({ error: 'confirm_write must be true to execute a write SQL statement' });
    return logged(auth.project.id, 'execute_sql_mutation', () =>
      service.executeSqlMutation(auth.project.db_schema, body.query!, {
        params: body.params,
        returning: body.returning,
        dry_run: body.dry_run,
        timeout: body.timeout,
      })
    );
  });
}
