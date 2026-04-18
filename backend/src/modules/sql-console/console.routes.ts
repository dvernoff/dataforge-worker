import type { FastifyInstance } from 'fastify';
import { ConsoleService } from './console.service.js';
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

  app.post('/:projectId/sql/execute-mutation', async (request, reply) => {
    const body = z.object({
      query: z.string().min(1).max(50000),
      confirm_write: z.boolean(),
      params: z.record(z.unknown()).optional(),
      returning: z.boolean().optional(),
      dry_run: z.boolean().optional(),
      timeout: z.number().int().min(1000).max(120000).optional(),
    }).parse(request.body);

    if (body.confirm_write !== true) {
      return reply.status(400).send({ error: 'confirm_write must be true to execute a write SQL statement' });
    }

    const userRole = request.userRole ?? 'editor';
    if (userRole !== 'admin' && userRole !== 'superadmin' && userRole !== 'editor') {
      throw new AppError(403, 'Only editor, admin, or superadmin can execute write statements');
    }

    const dbSchema = resolveProjectSchema(request);
    const { queryTimeout } = getQuotaHelpers(request);
    const timeoutMs = body.timeout ?? (queryTimeout > 0 ? queryTimeout : 30000);

    return consoleService.executeMutation(dbSchema, body.query, {
      params: body.params,
      returning: body.returning,
      dryRun: body.dry_run,
      timeoutMs,
    });
  });

  app.post('/:projectId/sql/explain', async (request) => {
    const body = z.object({ query: z.string().min(1) }).parse(request.body);
    const dbSchema = resolveProjectSchema(request);
    return consoleService.explain(dbSchema, body.query);
  });

  app.post('/:projectId/sql/analyze', async (request) => {
    const body = z.object({
      sql: z.string().min(1),
      params: z.record(z.unknown()).optional(),
      analyze: z.boolean().optional(),
    }).parse(request.body);
    const dbSchema = resolveProjectSchema(request);
    const { AnalyzerService } = await import('./analyzer.service.js');
    const analyzer = new AnalyzerService(app.db);
    return analyzer.analyze(dbSchema, body.sql, body.params ?? {}, body.analyze ?? false);
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
}
