import type { FastifyInstance } from 'fastify';
import { nodeAuthMiddleware } from '../../middleware/node-auth.middleware.js';
import { requireWorkerRole } from '../../middleware/worker-rbac.middleware.js';

export async function analyticsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', nodeAuthMiddleware);
  app.addHook('preHandler', requireWorkerRole('viewer'));

  app.get('/:projectId/analytics/summary', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const since = new Date();
    since.setDate(since.getDate() - 7);

    const [stats, topEndpoint] = await Promise.all([
      app.db('api_request_logs')
        .where('project_id', projectId)
        .where('created_at', '>=', since.toISOString())
        .select(
          app.db.raw('COUNT(*)::int as total_count'),
          app.db.raw('COALESCE(AVG(response_time_ms), 0) as avg_response'),
          app.db.raw('COUNT(CASE WHEN status_code >= 400 THEN 1 END)::int as error_count'),
          app.db.raw('COUNT(DISTINCT ip_address)::int as unique_ips')
        )
        .first(),
      app.db('api_request_logs')
        .where('project_id', projectId)
        .where('created_at', '>=', since.toISOString())
        .select('path', 'method')
        .count('id as count')
        .groupBy('path', 'method')
        .orderBy('count', 'desc')
        .first(),
    ]);

    const totalCount = Number(stats?.total_count ?? 0);
    const errorCnt = Number(stats?.error_count ?? 0);

    return {
      totalRequests: totalCount,
      avgResponseTime: Math.round(Number(stats?.avg_response ?? 0)),
      errorRate: totalCount > 0 ? Math.round((errorCnt / totalCount) * 10000) / 100 : 0,
      uniqueIps: Number(stats?.unique_ips ?? 0),
      topEndpoint: topEndpoint ? `${topEndpoint.method} ${topEndpoint.path}` : null,
    };
  });

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

  app.get('/:projectId/analytics/daily-stats', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const query = request.query as Record<string, string>;
    const days = Number(query.days ?? 7);
    const since = new Date();
    since.setDate(since.getDate() - days);

    const rows = await app.db.raw(`
      SELECT date_trunc('day', created_at)::date as day,
             COUNT(*)::int as total,
             COUNT(CASE WHEN status_code < 400 THEN 1 END)::int as success,
             COUNT(CASE WHEN status_code >= 400 THEN 1 END)::int as errors
      FROM api_request_logs
      WHERE project_id = ? AND created_at >= ?
      GROUP BY date_trunc('day', created_at)::date
      ORDER BY day ASC
    `, [projectId, since.toISOString()]).then((r: { rows: unknown[] }) => r.rows);

    const result = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const row = rows.find((r: Record<string, unknown>) => {
        const rowDate = new Date(r.day as string).toISOString().split('T')[0];
        return rowDate === dateStr;
      });
      result.push({
        day: dateStr,
        total: Number((row as Record<string, unknown>)?.total ?? 0),
        success: Number((row as Record<string, unknown>)?.success ?? 0),
        errors: Number((row as Record<string, unknown>)?.errors ?? 0),
      });
    }

    return { stats: result };
  });

  app.get('/:projectId/analytics/status-breakdown', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const query = request.query as Record<string, string>;
    const days = Number(query.days ?? 7);
    const since = new Date();
    since.setDate(since.getDate() - days);

    const rows = await app.db.raw(`
      SELECT
        CASE WHEN status_code < 300 THEN '2xx' WHEN status_code < 400 THEN '3xx' WHEN status_code < 500 THEN '4xx' ELSE '5xx' END as status_group,
        COUNT(*)::int as count
      FROM api_request_logs
      WHERE project_id = ? AND created_at >= ?
      GROUP BY 1
    `, [projectId, since.toISOString()]).then((r: { rows: unknown[] }) => r.rows);

    const result: Record<string, number> = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 };
    for (const row of rows as { status_group: string; count: string }[]) {
      result[row.status_group] = Number(row.count);
    }

    return result;
  });

  app.get('/:projectId/analytics/cache-stats', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const query = request.query as Record<string, string>;
    const days = Number(query.days ?? 7);
    const since = new Date();
    since.setDate(since.getDate() - days);

    const rows = await app.db('api_request_logs')
      .where('project_id', projectId)
      .where('created_at', '>=', since.toISOString())
      .whereNotNull('cache_status')
      .select('cache_status')
      .count('id as count')
      .groupBy('cache_status');

    const result: Record<string, number> = { Hit: 0, Miss: 0 };
    for (const row of rows as { cache_status: string; count: string }[]) {
      if (row.cache_status === 'HIT') result.Hit = Number(row.count);
      if (row.cache_status === 'MISS') result.Miss = Number(row.count);
    }

    return result;
  });

  app.get('/:projectId/analytics/slow-queries', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const since = new Date();
    since.setDate(since.getDate() - 7);

    const rows = await app.db('api_request_logs')
      .where('project_id', projectId)
      .where('created_at', '>=', since.toISOString())
      .where('response_time_ms', '>=', 100)
      .select('id', 'method', 'path', 'status_code', 'response_time_ms', 'created_at', 'ip_address', 'cache_status')
      .orderBy('response_time_ms', 'desc')
      .limit(20);

    return { requests: rows };
  });
}
