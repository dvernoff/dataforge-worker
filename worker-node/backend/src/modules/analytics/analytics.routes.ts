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

    const stats = await app.db('api_request_stats')
      .where('project_id', projectId)
      .where('hour', '>=', since.toISOString())
      .select(
        app.db.raw('COALESCE(SUM(total_count), 0)::int as total_count'),
        app.db.raw('COALESCE(SUM(error_count), 0)::int as error_count'),
        app.db.raw('CASE WHEN SUM(total_count) > 0 THEN SUM(total_response_time_ms) / SUM(total_count) ELSE 0 END as avg_response'),
        app.db.raw('COALESCE(MAX(max_response_time_ms), 0) as max_response'),
        app.db.raw('COALESCE(SUM(cache_hits), 0)::int as cache_hits'),
        app.db.raw('COALESCE(SUM(cache_misses), 0)::int as cache_misses'),
      )
      .first();

    const uniqueIpsResult = await app.db.raw(
      `SELECT COUNT(DISTINCT ip) as cnt
       FROM api_request_stats, unnest(unique_ips) AS ip
       WHERE project_id = ? AND hour >= ?`,
      [projectId, since.toISOString()],
    );

    const topEndpoint = await app.db('api_request_stats')
      .where('project_id', projectId)
      .where('hour', '>=', since.toISOString())
      .select('method', 'path')
      .sum('total_count as count')
      .groupBy('method', 'path')
      .orderBy('count', 'desc')
      .first();

    const totalCount = Number(stats?.total_count ?? 0);
    const errorCnt = Number(stats?.error_count ?? 0);

    return {
      totalRequests: totalCount,
      avgResponseTime: Math.round(Number(stats?.avg_response ?? 0)),
      errorRate: totalCount > 0 ? Math.round((errorCnt / totalCount) * 10000) / 100 : 0,
      uniqueIps: Number(uniqueIpsResult.rows[0]?.cnt ?? 0),
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

    if (query.from) qb = qb.where('created_at', '>=', query.from);
    if (query.to) qb = qb.where('created_at', '<=', query.to);
    if (query.status) qb = qb.where('status_code', Number(query.status));
    if (query.method) qb = qb.where('method', query.method.toUpperCase());
    if (query.path) qb = qb.where('path', 'like', `%${query.path}%`);

    const [{ count: total }] = await qb.clone().count('id as count');

    const rows = await qb
      .select('*')
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset);

    return { requests: rows, total: Number(total), page, limit };
  });

  app.get('/:projectId/analytics/top-endpoints', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const query = request.query as Record<string, string>;

    const days = Number(query.days ?? 7);
    const since = new Date();
    since.setDate(since.getDate() - days);

    const rows = await app.db('api_request_stats')
      .where('project_id', projectId)
      .where('hour', '>=', since.toISOString())
      .select('method', 'path')
      .sum('total_count as request_count')
      .sum('total_response_time_ms as sum_time')
      .sum('total_count as sum_count')
      .groupBy('method', 'path')
      .orderBy('request_count', 'desc')
      .limit(10);

    return {
      endpoints: rows.map((r: any) => ({
        method: r.method,
        path: r.path,
        requestCount: Number(r.request_count),
        avgResponseTime: Number(r.sum_count) > 0 ? Math.round(Number(r.sum_time) / Number(r.sum_count)) : 0,
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
      SELECT date_trunc('day', hour)::date as day,
             SUM(total_count)::int as total,
             SUM(total_count - error_count)::int as success,
             SUM(error_count)::int as errors
      FROM api_request_stats
      WHERE project_id = ? AND hour >= ?
      GROUP BY date_trunc('day', hour)::date
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

    const rows = await app.db('api_request_stats')
      .where('project_id', projectId)
      .where('hour', '>=', since.toISOString())
      .select('status_group')
      .sum('total_count as count')
      .groupBy('status_group');

    const result: Record<string, number> = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 };
    for (const row of rows as { status_group: number; count: string }[]) {
      const key = `${Math.floor(row.status_group / 100)}xx`;
      result[key] = (result[key] ?? 0) + Number(row.count);
    }

    return result;
  });

  app.get('/:projectId/analytics/cache-stats', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const query = request.query as Record<string, string>;
    const days = Number(query.days ?? 7);
    const since = new Date();
    since.setDate(since.getDate() - days);

    const stats = await app.db('api_request_stats')
      .where('project_id', projectId)
      .where('hour', '>=', since.toISOString())
      .select(
        app.db.raw('COALESCE(SUM(cache_hits), 0)::int as hits'),
        app.db.raw('COALESCE(SUM(cache_misses), 0)::int as misses'),
      )
      .first();

    return { Hit: Number(stats?.hits ?? 0), Miss: Number(stats?.misses ?? 0) };
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
