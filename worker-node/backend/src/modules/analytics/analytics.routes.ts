import type { FastifyInstance } from 'fastify';
import { nodeAuthMiddleware } from '../../middleware/node-auth.middleware.js';
import { requireWorkerRole } from '../../middleware/worker-rbac.middleware.js';

export async function analyticsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', nodeAuthMiddleware);
  app.addHook('preHandler', requireWorkerRole('viewer'));

  // GET /:projectId/analytics/summary
  app.get('/:projectId/analytics/summary', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [totalToday] = await app.db('api_request_logs')
      .where('project_id', projectId)
      .where('created_at', '>=', today.toISOString())
      .count('id as count');

    const [avgResponse] = await app.db('api_request_logs')
      .where('project_id', projectId)
      .where('created_at', '>=', today.toISOString())
      .avg('response_time_ms as avg');

    const [errorCount] = await app.db('api_request_logs')
      .where('project_id', projectId)
      .where('created_at', '>=', today.toISOString())
      .where('status_code', '>=', 400)
      .count('id as count');

    const totalCount = Number(totalToday?.count ?? 0);
    const errorCnt = Number(errorCount?.count ?? 0);

    const topEndpoint = await app.db('api_request_logs')
      .where('project_id', projectId)
      .where('created_at', '>=', today.toISOString())
      .select('path', 'method')
      .count('id as count')
      .groupBy('path', 'method')
      .orderBy('count', 'desc')
      .first();

    return {
      totalRequests: totalCount,
      avgResponseTime: Math.round(Number(avgResponse?.avg ?? 0)),
      errorRate: totalCount > 0 ? Math.round((errorCnt / totalCount) * 10000) / 100 : 0,
      topEndpoint: topEndpoint ? `${topEndpoint.method} ${topEndpoint.path}` : null,
    };
  });

  // GET /:projectId/analytics/requests — paginated list
  app.get('/:projectId/analytics/requests', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const query = request.query as Record<string, string>;

    const page = Number(query.page ?? 1);
    const limit = Math.min(Number(query.limit ?? 50), 100);
    const offset = (page - 1) * limit;

    let qb = app.db('api_request_logs')
      .where('project_id', projectId);

    if (query.from) {
      qb = qb.where('created_at', '>=', query.from);
    }
    if (query.to) {
      qb = qb.where('created_at', '<=', query.to);
    }
    if (query.status) {
      qb = qb.where('status_code', Number(query.status));
    }
    if (query.method) {
      qb = qb.where('method', query.method.toUpperCase());
    }
    if (query.path) {
      qb = qb.where('path', 'like', `%${query.path}%`);
    }

    const [{ count: total }] = await qb.clone().count('id as count');

    const rows = await qb
      .select('*')
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset);

    return {
      requests: rows,
      total: Number(total),
      page,
      limit,
    };
  });

  // GET /:projectId/analytics/top-endpoints
  app.get('/:projectId/analytics/top-endpoints', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const query = request.query as Record<string, string>;

    const days = Number(query.days ?? 7);
    const since = new Date();
    since.setDate(since.getDate() - days);

    const rows = await app.db('api_request_logs')
      .where('project_id', projectId)
      .where('created_at', '>=', since.toISOString())
      .select('method', 'path')
      .count('id as request_count')
      .avg('response_time_ms as avg_response_time')
      .groupBy('method', 'path')
      .orderBy('request_count', 'desc')
      .limit(10);

    return {
      endpoints: rows.map((r) => ({
        method: r.method,
        path: r.path,
        requestCount: Number(r.request_count),
        avgResponseTime: Math.round(Number(r.avg_response_time ?? 0)),
      })),
    };
  });

  // GET /:projectId/analytics/slow-queries
  app.get('/:projectId/analytics/slow-queries', async (request) => {
    const { projectId } = request.params as { projectId: string };

    const rows = await app.db('api_request_logs')
      .where('project_id', projectId)
      .select('*')
      .orderBy('response_time_ms', 'desc')
      .limit(20);

    return { requests: rows };
  });
}
