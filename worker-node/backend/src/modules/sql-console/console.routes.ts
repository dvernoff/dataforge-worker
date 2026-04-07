import type { FastifyInstance } from 'fastify';
import { ConsoleService } from './console.service.js';
import { AISQLService } from './ai.service.js';
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

export async function sqlConsoleRoutes(app: FastifyInstance) {
  const consoleService = new ConsoleService(app.db);
  const aiService = new AISQLService();

  app.addHook('preHandler', nodeAuthMiddleware);
  app.addHook('preHandler', requireWorkerRole('viewer'));

  app.post('/:projectId/sql/execute', async (request) => {
    const body = z.object({ query: z.string().min(1).max(50000) }).parse(request.body);
    const dbSchema = resolveProjectSchema(request);
    const { queryTimeout, reportViolation } = getQuotaHelpers(request);

    const userRole = request.userRole ?? 'editor';
    const role = userRole === 'admin' || userRole === 'superadmin' ? 'admin' : 'editor';

    const timeoutMs = queryTimeout > 0 ? queryTimeout : 30000;
    const result = await consoleService.execute(dbSchema, body.query, role, timeoutMs);

    if (result.duration_ms > timeoutMs * 0.8) {
      reportViolation('quota.slow_query', {
        query: body.query.substring(0, 200),
        duration_ms: result.duration_ms,
        timeout_ms: timeoutMs,
        message: `Query took ${result.duration_ms}ms (limit: ${timeoutMs}ms). Consider optimizing.`,
      });
    }

    return result;
  });

  app.post('/:projectId/sql/explain', async (request) => {
    const body = z.object({ query: z.string().min(1) }).parse(request.body);
    const dbSchema = resolveProjectSchema(request);
    return consoleService.explain(dbSchema, body.query);
  });

  app.get('/:projectId/sql/saved', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const userId = request.userId;
    const queries = await app.db('saved_queries')
      .where({ project_id: projectId })
      .where(function (this: import('knex').Knex.QueryBuilder) {
        this.where({ user_id: userId }).orWhere({ is_shared: true });
      })
      .orderBy('updated_at', 'desc');
    return { queries };
  });

  app.post('/:projectId/sql/saved', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const userId = request.userId;
    const body = z.object({
      name: z.string().min(1).max(255),
      query: z.string().min(1),
      description: z.string().optional(),
      is_shared: z.boolean().optional(),
    }).parse(request.body);

    const [saved] = await app.db('saved_queries')
      .insert({
        project_id: projectId,
        user_id: userId,
        ...body,
      })
      .returning('*');
    return { query: saved };
  });

  app.delete('/:projectId/sql/saved/:queryId', async (request, reply) => {
    const { projectId, queryId } = request.params as { projectId: string; queryId: string };
    const userId = request.userId;
    await app.db('saved_queries').where({ id: queryId, user_id: userId, project_id: projectId }).delete();
    return reply.status(204).send();
  });

  app.get('/:projectId/sql/explorer', async (request) => {
    const dbSchema = resolveProjectSchema(request);

    const tables = await app.db.raw(`
      SELECT t.table_name,
        json_agg(json_build_object(
          'name', c.column_name,
          'type', c.data_type,
          'nullable', c.is_nullable = 'YES'
        ) ORDER BY c.ordinal_position) as columns
      FROM information_schema.tables t
      JOIN information_schema.columns c
        ON c.table_schema = t.table_schema AND c.table_name = t.table_name
      WHERE t.table_schema = ? AND t.table_type = 'BASE TABLE'
        AND t.table_name NOT LIKE '__history_%'
      GROUP BY t.table_name
      ORDER BY t.table_name
    `, [dbSchema]);

    return { tables: tables.rows };
  });

  async function checkAiQuota(userId: string): Promise<void> {
    const hasTable = await app.db.schema.hasTable('ai_usage_log');
    if (!hasTable) return;

    const today = new Date().toISOString().split('T')[0];
    const usage = await app.db('ai_usage_log')
      .where('user_id', userId)
      .whereRaw("created_at::date = ?", [today])
      .select(
        app.db.raw('COUNT(*)::int as requests'),
        app.db.raw('COALESCE(SUM(input_tokens + output_tokens), 0)::int as tokens')
      )
      .first();

    let maxRequests = 50;
    let maxTokens = 100000;
    try {
      const hasUserQuotas = await app.db.schema.hasTable('user_quotas');
      if (hasUserQuotas) {
        const userQuota = await app.db('user_quotas').where({ user_id: userId }).first();
        if (userQuota) {
          maxRequests = userQuota.max_ai_requests_per_day ?? maxRequests;
          maxTokens = userQuota.max_ai_tokens_per_day ?? maxTokens;
        } else {
          const hasDefaults = await app.db.schema.hasTable('default_quotas');
          if (hasDefaults) {
            const defaults = await app.db('default_quotas').first();
            if (defaults) {
              maxRequests = defaults.max_ai_requests_per_day ?? maxRequests;
              maxTokens = defaults.max_ai_tokens_per_day ?? maxTokens;
            }
          }
        }
      }
    } catch { }

    if ((usage?.requests ?? 0) >= maxRequests) {
      throw new AppError(429, 'Daily AI request limit exceeded');
    }
    if ((usage?.tokens ?? 0) >= maxTokens) {
      throw new AppError(429, 'Daily AI token limit exceeded');
    }
  }

  async function logAiUsage(userId: string, projectId: string, action: string, model: string, inputTokens: number, outputTokens: number) {
    try {
      const hasTable = await app.db.schema.hasTable('ai_usage_log');
      if (!hasTable) return;
      await app.db('ai_usage_log').insert({
        user_id: userId,
        project_id: projectId,
        action,
        model,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
      });
    } catch { }
  }

  async function getSchemaContext(dbSchema: string): Promise<string> {
    const tables = await app.db.raw(`
      SELECT t.table_name,
        json_agg(json_build_object(
          'name', c.column_name,
          'type', c.data_type
        ) ORDER BY c.ordinal_position) as columns
      FROM information_schema.tables t
      JOIN information_schema.columns c
        ON c.table_schema = t.table_schema AND c.table_name = t.table_name
      WHERE t.table_schema = ? AND t.table_type = 'BASE TABLE'
        AND t.table_name NOT LIKE '__history_%'
      GROUP BY t.table_name
      ORDER BY t.table_name
    `, [dbSchema]);

    return tables.rows.map((t: { table_name: string; columns: { name: string; type: string }[] }) =>
      `Table: ${t.table_name}\n  Columns: ${t.columns.map((c) => `${c.name} (${c.type})`).join(', ')}`
    ).join('\n');
  }

  app.post('/:projectId/sql/ai/generate', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const userId = request.userId ?? 'unknown';
    await checkAiQuota(userId);
    const body = z.object({ prompt: z.string().min(1).max(2000) }).parse(request.body);
    const dbSchema = resolveProjectSchema(request);
    const schemaContext = await getSchemaContext(dbSchema);
    const sql = await aiService.generateSQL(schemaContext, body.prompt);
    const inputTokens = Math.ceil((schemaContext.length + body.prompt.length) / 4);
    const outputTokens = Math.ceil(sql.length / 4);
    await logAiUsage(userId, projectId, 'sql.generate', 'claude-sonnet-4', inputTokens, outputTokens);
    return { sql, estimated_tokens: inputTokens + outputTokens };
  });

  app.post('/:projectId/sql/ai/explain', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const userId = request.userId ?? 'unknown';
    await checkAiQuota(userId);
    const body = z.object({ sql: z.string().min(1) }).parse(request.body);
    const explanation = await aiService.explainSQL(body.sql);
    const inputTokens = Math.ceil(body.sql.length / 4);
    const outputTokens = Math.ceil(explanation.length / 4);
    await logAiUsage(userId, projectId, 'sql.explain', 'claude-sonnet-4', inputTokens, outputTokens);
    return { explanation, estimated_tokens: inputTokens + outputTokens };
  });

  app.post('/:projectId/sql/ai/optimize', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const userId = request.userId ?? 'unknown';
    await checkAiQuota(userId);
    const body = z.object({ sql: z.string().min(1) }).parse(request.body);
    const dbSchema = resolveProjectSchema(request);
    const schemaContext = await getSchemaContext(dbSchema);
    const result = await aiService.optimizeSQL(body.sql, schemaContext);
    const inputTokens = Math.ceil((schemaContext.length + body.sql.length) / 4);
    const outputTokens = Math.ceil(result.length / 4);
    await logAiUsage(userId, projectId, 'sql.optimize', 'claude-sonnet-4', inputTokens, outputTokens);
    return { result, estimated_tokens: inputTokens + outputTokens };
  });

  app.post('/:projectId/sql/ai/fix', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const userId = request.userId ?? 'unknown';
    await checkAiQuota(userId);
    const body = z.object({
      sql: z.string().min(1),
      error: z.string().min(1),
    }).parse(request.body);
    const dbSchema = resolveProjectSchema(request);
    const schemaContext = await getSchemaContext(dbSchema);
    const sql = await aiService.fixError(body.sql, body.error, schemaContext);
    const inputTokens = Math.ceil((schemaContext.length + body.sql.length + body.error.length) / 4);
    const outputTokens = Math.ceil(sql.length / 4);
    await logAiUsage(userId, projectId, 'sql.fix', 'claude-sonnet-4', inputTokens, outputTokens);
    return { sql, estimated_tokens: inputTokens + outputTokens };
  });
}
