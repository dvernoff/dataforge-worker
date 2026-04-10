import type { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { authenticateAiRequest } from './ai-auth.middleware.js';
import { AiGatewayService } from './ai-gateway.service.js';
import { MCP_TOOLS } from './mcp-tools.js';

const VALID_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const VALID_COL_TYPES = new Set(['text','integer','bigint','float','decimal','boolean','date','timestamp','timestamptz','uuid','json','jsonb','text[]','integer[]','serial','bigserial']);

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
  const service = new AiGatewayService(app.db);

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
      const response = { jsonrpc: '2.0' as const, id, error: { code, message } };
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
            result = await service.alterColumns(dbSchema, args.table_name as string, args.changes as unknown[]);
            break;
          case 'drop_table':
            result = await service.dropTable(dbSchema, args.table_name as string, projectId);
            break;
          case 'add_index':
            result = await service.addIndex(dbSchema, args.table_name as string, {
              columns: args.columns as string[], type: (args.type as string) ?? 'btree', is_unique: (args.is_unique as boolean) ?? false,
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
          default:
            return respondError(msg.id, -32601, `Unknown tool: ${toolName}`);
        }

        await service.logActivity({ project_id: projectId, gateway_type: 'mcp', tool_name: toolName, request_summary: null, response_status: 200, duration_ms: Date.now() - start });
        return respond(msg.id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
      } catch (err) {
        await service.logActivity({ project_id: projectId, gateway_type: 'mcp', tool_name: toolName, request_summary: null, response_status: 500, duration_ms: Date.now() - start });
        return respondError(msg.id, -32000, (err as Error).message);
      }
    }

    return respondError(msg.id, -32601, `Unknown method: ${msg.method}`);
  });
}
