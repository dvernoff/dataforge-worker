import type { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { authenticateAiRequest } from './ai-auth.middleware.js';
import { AiGatewayService } from './ai-gateway.service.js';
import { MCP_TOOLS } from './mcp-tools.js';
import { enrichError } from '../../utils/error-codes.js';
import { TxnManager } from './txn-manager.js';

const VALID_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const VALID_COL_TYPES = new Set(['text','integer','bigint','float','decimal','boolean','date','timestamp','timestamptz','uuid','json','jsonb','inet','cidr','macaddr','text[]','integer[]','inet[]','serial','bigserial']);

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface McpSession {
  projectId: string;
  dbSchema: string;
  sseReply: unknown;
}

const sessions = new Map<string, McpSession>();

export async function aiMcpServerRoutes(app: FastifyInstance) {
  const service = new AiGatewayService(app.db, app.redis);

  app.get('/api/v1/:projectSlug/mcp', async (request, reply) => {
    const auth = await authenticateAiRequest(request, reply, app.db, app.redis, 'ai-mcp-server');
    if (!auth) return;

    const sessionId = crypto.randomUUID();
    sessions.set(sessionId, { projectId: auth.project.id, dbSchema: auth.project.db_schema, sseReply: reply.raw });

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-MCP-Session-Id': sessionId,
    });

    const send = (data: unknown) => {
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    send({
      jsonrpc: '2.0',
      method: 'initialized',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'dataforge-ai-gateway', version: '1.0.0' },
      },
    });

    request.raw.on('close', () => {
      sessions.delete(sessionId);
    });

    await new Promise(() => {});
  });

  app.post('/api/v1/:projectSlug/mcp', async (request, reply) => {
    const auth = await authenticateAiRequest(request, reply, app.db, app.redis, 'ai-mcp-server');
    if (!auth) return;

    const sessionId = request.headers['x-mcp-session-id'] as string;
    const session = sessionId ? sessions.get(sessionId) : null;
    const projectId = auth.project.id;
    const dbSchema = auth.project.db_schema;

    const msg = request.body as JsonRpcRequest;
    if (!msg || msg.jsonrpc !== '2.0') {
      return reply.status(400).send({ error: 'Invalid JSON-RPC request' });
    }

    const respond = (id: string | number | undefined, result: unknown) => {
      const response = { jsonrpc: '2.0' as const, id, result };
      if (session?.sseReply) {
        (session.sseReply as NodeJS.WritableStream).write(`data: ${JSON.stringify(response)}\n\n`);
      }
      return response;
    };

    const respondError = (id: string | number | undefined, code: number, message: string) => {
      const enriched = enrichError(message);
      const err = enriched
        ? { code, message: enriched.message, data: { code: enriched.code, cause: enriched.cause, suggestion: enriched.suggestion, ...(enriched.query_location ? { query_location: enriched.query_location } : {}) } }
        : { code, message };
      const response = { jsonrpc: '2.0' as const, id, error: err };
      if (session?.sseReply) {
        (session.sseReply as NodeJS.WritableStream).write(`data: ${JSON.stringify(response)}\n\n`);
      }
      return response;
    };

    if (msg.method === 'initialize') {
      return respond(msg.id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'dataforge-ai-gateway', version: '1.0.0' },
      });
    }

    if (msg.method === 'tools/list') {
      return respond(msg.id, { tools: MCP_TOOLS });
    }

    if (msg.method === 'tools/call') {
      const params = msg.params as { name: string; arguments: Record<string, unknown> };
      const toolName = params?.name;
      const args = params?.arguments ?? {};
      const start = Date.now();

      try {
        let result: unknown;

        switch (toolName) {
          case 'get_project_info':
            result = service.getProjectInfo();
            break;
          case 'get_schema_context':
            result = await service.getContext(projectId, dbSchema);
            break;
          case 'list_tables':
            result = await service.listTables(dbSchema);
            break;
          case 'describe_table': {
            if (!args.name) throw new Error('Missing "name"');
            result = await service.describeTable(dbSchema, args.name as string);
            break;
          }
          case 'list_endpoints':
            result = await service.listEndpointsFiltered(projectId, {
              method: args.method as string | undefined,
              path_contains: args.path_contains as string | undefined,
            });
            break;
          case 'create_table': {
            if (!args.name) throw new Error('Missing "name". Example: "users"');
            if (!Array.isArray(args.columns) || (args.columns as unknown[]).length === 0) throw new Error('Missing "columns" (non-empty array). Example: [{"name":"email","type":"text","nullable":false}]');
            for (const col of args.columns as Record<string, unknown>[]) {
              if (!col.name) throw new Error('Column missing "name"');
              if (!col.type || !VALID_COL_TYPES.has(col.type as string)) throw new Error(`Column "${col.name}": invalid type "${col.type}". Valid: ${[...VALID_COL_TYPES].join(', ')}`);
            }
            result = await service.createTable(dbSchema, args as Parameters<AiGatewayService['createTable']>[1]);
            break;
          }
          case 'alter_columns':
            result = await service.alterColumns(
              dbSchema,
              args.table_name as string,
              (args.changes as unknown[]) ?? [],
              { storage_params: args.storage_params as Record<string, number> | undefined },
            );
            break;
          case 'drop_table':
            result = await service.dropTable(dbSchema, args.table_name as string, projectId);
            break;
          case 'add_index':
            result = await service.addIndex(dbSchema, args.table_name as string, {
              columns: args.columns as string[] | undefined,
              expressions: args.expressions as string[] | undefined,
              type: (args.type as string) ?? 'btree',
              is_unique: (args.is_unique as boolean) ?? false,
              where: args.where as string | undefined,
              include: args.include as string[] | undefined,
              name: args.name as string | undefined,
            });
            break;
          case 'drop_index':
            result = await service.dropIndex(dbSchema, args.index_name as string);
            break;
          case 'add_foreign_key':
            result = await service.addForeignKey(dbSchema, args.table_name as string, {
              source_column: args.source_column as string, target_table: args.target_table as string,
              target_column: args.target_column as string, on_delete: args.on_delete as string, on_update: args.on_update as string,
            });
            break;
          case 'drop_foreign_key':
            result = await service.dropForeignKey(dbSchema, args.table_name as string, args.constraint_name as string);
            break;
          case 'create_endpoint': {
            if (!args.method || !VALID_METHODS.has((args.method as string).toUpperCase())) throw new Error(`Invalid "method". Must be: ${[...VALID_METHODS].join(', ')}`);
            if (!args.path || typeof args.path !== 'string' || !(args.path as string).startsWith('/')) throw new Error('Missing "path" (must start with /). Example: "/users"');
            if (!args.source_type) throw new Error('Missing "source_type". Must be: table, custom_sql, composite');
            if (!args.source_config) throw new Error('Missing "source_config". For custom_sql: {"query":"SELECT ..."}. For table: {"table":"users","operation":"find"}');
            args.method = (args.method as string).toUpperCase();
            result = await service.createEndpoint(projectId, args);
            break;
          }
          case 'update_endpoint':
            { const { endpoint_id, ...rest } = args; result = await service.updateEndpoint(endpoint_id as string, projectId, rest); }
            break;
          case 'delete_endpoint':
            result = await service.deleteEndpoint(args.endpoint_id as string, projectId);
            break;
          case 'execute_sql':
            result = await service.executeSql(dbSchema, args.query as string, args.timeout as number);
            break;
          case 'execute_sql_mutation': {
            if (!args.query) throw new Error('Missing "query"');
            if (args.confirm_write !== true) throw new Error('confirm_write must be true to execute a write SQL statement. Set confirm_write=true after verifying the query is correct.');
            const txnId = args.txn_id as string | undefined;
            const trx = txnId ? TxnManager.get().getTrx(txnId, projectId) : undefined;
            result = await service.executeSqlMutation(dbSchema, args.query as string, {
              params: args.params as Record<string, unknown> | undefined,
              returning: args.returning as boolean | undefined,
              dry_run: args.dry_run as boolean | undefined,
              timeout: args.timeout as number | undefined,
              trx,
            });
            break;
          }
case 'create_materialized_view': {
            if (!args.name || !args.query) throw new Error('Missing "name" or "query"');
            result = await service.createMaterializedView(dbSchema, args as Parameters<AiGatewayService['createMaterializedView']>[1]);
            break;
          }
          case 'list_materialized_views':
            result = await service.listMaterializedViews(dbSchema);
            break;
          case 'search_endpoints': {
            if (!args.query) throw new Error('Missing "query"');
            result = await service.searchEndpoints(projectId, args.query as string);
            break;
          }
          case 'suggest_index': {
            if (!args.table) throw new Error('Missing "table"');
            result = await service.suggestIndex(dbSchema, args.table as string);
            break;
          }
          case 'analyze_schema_quality':
            result = await service.analyzeSchemaQuality(dbSchema);
            break;
          case 'explain_query': {
            if (!args.sql) throw new Error('Missing "sql"');
            result = await service.explainQuery(dbSchema, args.sql as string, (args.params as Record<string, unknown>) ?? {}, (args.analyze as boolean) ?? false);
            break;
          }
          case 'begin_transaction': {
            result = await TxnManager.get().begin(app.db, projectId, dbSchema, args.timeout_seconds as number | undefined);
            break;
          }
          case 'commit_transaction': {
            if (!args.txn_id) throw new Error('Missing "txn_id"');
            result = await TxnManager.get().commit(args.txn_id as string);
            break;
          }
          case 'rollback_transaction': {
            if (!args.txn_id) throw new Error('Missing "txn_id"');
            result = await TxnManager.get().rollback(args.txn_id as string, 'user');
            break;
          }
          case 'list_transactions': {
            result = TxnManager.get().list(projectId);
            break;
          }
          case 'create_hypertable': {
            if (!args.table) throw new Error('Missing "table"');
            if (!args.time_column) throw new Error('Missing "time_column"');
            result = await service.createHypertable(dbSchema, args as Parameters<AiGatewayService['createHypertable']>[1]);
            break;
          }
          case 'add_continuous_aggregate': {
            if (!args.view_name || !args.source_table || !args.time_column || !args.time_bucket || !args.aggregations) {
              throw new Error('Missing required field (view_name, source_table, time_column, time_bucket, aggregations)');
            }
            result = await service.addContinuousAggregate(dbSchema, args as Parameters<AiGatewayService['addContinuousAggregate']>[1]);
            break;
          }
          case 'add_compression_policy': {
            if (!args.table) throw new Error('Missing "table"');
            if (!args.compress_after) throw new Error('Missing "compress_after"');
            result = await service.addCompressionPolicy(dbSchema, args as Parameters<AiGatewayService['addCompressionPolicy']>[1]);
            break;
          }
          case 'add_retention_policy': {
            if (!args.table) throw new Error('Missing "table"');
            if (!args.drop_after) throw new Error('Missing "drop_after"');
            result = await service.addRetentionPolicy(dbSchema, args as Parameters<AiGatewayService['addRetentionPolicy']>[1]);
            break;
          }
          case 'list_hypertables':
            result = await service.listHypertables(dbSchema);
            break;
          case 'get_openapi_spec': {
            const slugRow = await app.db('projects').where({ id: projectId }).first();
            const slug = slugRow?.slug ?? '';
            const hostHeader = (request.headers['x-forwarded-host'] as string) ?? request.headers.host ?? 'localhost:4001';
            const proto = (request.headers['x-forwarded-proto'] as string) ?? 'http';
            const baseUrl = `${proto}://${hostHeader}`;
            result = await service.getOpenapiSpec(projectId, slug, dbSchema, baseUrl, (args.format as 'json' | 'yaml' | undefined) ?? 'json');
            break;
          }
          case 'call_endpoint': {
            const slugRow = await app.db('projects').where({ id: projectId }).first();
            const slug = slugRow?.slug ?? '';
            result = await service.callEndpoint(projectId, dbSchema, slug, {
              endpoint_id: args.endpoint_id as string | undefined,
              path: args.path as string | undefined,
              method: args.method as string | undefined,
              params: args.params as Record<string, string> | undefined,
              body: args.body,
              headers: args.headers as Record<string, string> | undefined,
              bypass_cache: args.bypass_cache as boolean | undefined,
            });
            break;
          }
          case 'list_api_tokens':
            result = await service.listApiTokens(projectId);
            break;
          case 'create_api_token': {
            if (!args.name || !args.scopes) throw new Error('Missing "name" or "scopes"');
            result = await service.createApiToken(projectId, args as Parameters<AiGatewayService['createApiToken']>[1]);
            break;
          }
          case 'update_api_token': {
            if (!args.token_id) throw new Error('Missing "token_id"');
            const { token_id, ...rest } = args;
            result = await service.updateApiToken(projectId, token_id as string, rest as Parameters<AiGatewayService['updateApiToken']>[2]);
            break;
          }
          case 'rotate_api_token':
            if (!args.token_id) throw new Error('Missing "token_id"');
            result = await service.rotateApiToken(projectId, args.token_id as string);
            break;
          case 'revoke_api_token':
            if (!args.token_id) throw new Error('Missing "token_id"');
            result = await service.revokeApiToken(projectId, args.token_id as string);
            break;
          case 'delete_api_token':
            if (!args.token_id) throw new Error('Missing "token_id"');
            result = await service.deleteApiToken(projectId, args.token_id as string);
            break;
          case 'list_cron_jobs':
            result = await service.listCronJobs(projectId);
            break;
          case 'get_cron_job': {
            if (!args.job_id) throw new Error('Missing "job_id"');
            result = await service.getCronJob(args.job_id as string, projectId);
            break;
          }
          case 'create_cron_job': {
            if (!args.name) throw new Error('Missing "name"');
            if (!args.cron_expression) throw new Error('Missing "cron_expression"');
            if (!args.action_type) throw new Error('Missing "action_type"');
            if (!args.action_config) throw new Error('Missing "action_config"');
            result = await service.createCronJob(projectId, {
              name: args.name as string,
              cron_expression: args.cron_expression as string,
              action_type: args.action_type as string,
              action_config: args.action_config as Record<string, unknown>,
              is_active: args.is_active as boolean | undefined,
            });
            break;
          }
          case 'update_cron_job': {
            if (!args.job_id) throw new Error('Missing "job_id"');
            const { job_id: updateJobId, ...updateFields } = args;
            result = await service.updateCronJob(updateJobId as string, projectId, updateFields);
            break;
          }
          case 'delete_cron_job': {
            if (!args.job_id) throw new Error('Missing "job_id"');
            await service.deleteCronJob(args.job_id as string, projectId);
            result = { deleted: true };
            break;
          }
          case 'toggle_cron_job': {
            if (!args.job_id) throw new Error('Missing "job_id"');
            result = await service.toggleCronJob(args.job_id as string, projectId);
            break;
          }
          case 'run_cron_job': {
            if (!args.job_id) throw new Error('Missing "job_id"');
            result = await service.runCronJob(args.job_id as string, projectId);
            break;
          }

          // ===== AI Studio =====
          case 'ai_studio_list_endpoints':
            result = await service.listAiEndpoints(projectId, dbSchema);
            break;
          case 'ai_studio_get_endpoint': {
            if (!args.endpoint) throw new Error('Missing "endpoint" (id or slug)');
            result = await service.getAiEndpoint(projectId, dbSchema, args.endpoint as string);
            if (!result) throw new Error(`AI Studio endpoint "${args.endpoint}" not found`);
            break;
          }
          case 'ai_studio_list_models':
            result = service.listAiModels();
            break;
          case 'ai_studio_create_endpoint': {
            if (!args.name || !args.provider || !args.model) throw new Error('Missing required: name, provider, model');
            result = await service.createAiEndpoint(projectId, dbSchema, args as unknown as Parameters<AiGatewayService['createAiEndpoint']>[2]);
            break;
          }
          case 'ai_studio_update_endpoint': {
            if (!args.endpoint_id) throw new Error('Missing "endpoint_id"');
            const { endpoint_id, ...rest } = args;
            result = await service.updateAiEndpoint(projectId, dbSchema, endpoint_id as string, rest as unknown as Parameters<AiGatewayService['updateAiEndpoint']>[3]);
            break;
          }
          case 'ai_studio_delete_endpoint': {
            if (!args.endpoint_id) throw new Error('Missing "endpoint_id"');
            result = await service.deleteAiEndpoint(projectId, dbSchema, args.endpoint_id as string);
            break;
          }
          case 'ai_studio_test_endpoint': {
            if (!args.endpoint) throw new Error('Missing "endpoint" (id or slug)');
            if (!args.input && !args.messages) throw new Error('Provide "input" (single-turn) or "messages" (multi-turn)');
            result = await service.testAiEndpoint(projectId, dbSchema, args.endpoint as string, {
              input: args.input as string | undefined,
              messages: args.messages as Array<{ role: 'user' | 'assistant'; content: string }> | undefined,
              session_id: args.session_id as string | undefined,
            });
            break;
          }
          case 'ai_studio_get_logs':
            result = await service.getAiLogs(projectId, dbSchema, {
              endpoint_id: args.endpoint_id as string | undefined,
              limit: args.limit as number | undefined,
              offset: args.offset as number | undefined,
            });
            break;
          case 'ai_studio_get_stats':
            result = await service.getAiStats(projectId, dbSchema);
            break;
          case 'ai_studio_get_session': {
            if (!args.endpoint || !args.session_id) throw new Error('Missing "endpoint" or "session_id"');
            result = await service.getAiSession(projectId, dbSchema, args.endpoint as string, args.session_id as string);
            break;
          }
          case 'ai_studio_clear_session': {
            if (!args.endpoint || !args.session_id) throw new Error('Missing "endpoint" or "session_id"');
            result = await service.clearAiSession(projectId, dbSchema, args.endpoint as string, args.session_id as string);
            break;
          }

          default:
            return respondError(msg.id, -32601, `Unknown tool: ${toolName}`);
        }

        await service.logActivity({ project_id: projectId, gateway_type: 'mcp', tool_name: toolName, request_summary: null, response_status: 200, duration_ms: Date.now() - start });
        const serialized = result === undefined
          ? JSON.stringify({ ok: true })
          : JSON.stringify(result, null, 2);
        return respond(msg.id, { content: [{ type: 'text', text: serialized ?? '{"ok":true}' }] });
      } catch (err) {
        await service.logActivity({ project_id: projectId, gateway_type: 'mcp', tool_name: toolName, request_summary: null, response_status: 500, duration_ms: Date.now() - start });
        return respondError(msg.id, -32000, (err as Error).message);
      }
    }

    return respondError(msg.id, -32601, `Unknown method: ${msg.method}`);
  });
}
