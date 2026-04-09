import type { FastifyInstance } from 'fastify';
import { nodeAuthMiddleware } from '../../../../middleware/node-auth.middleware.js';
import { requireWorkerRole } from '../../../../middleware/worker-rbac.middleware.js';
import { z } from 'zod';

const ALLOWED_INTERVALS = [1, 5, 15, 60, 720];

async function ensureTables(app: FastifyInstance, projectSchema?: string) {
  const hasMonitors = await app.db.schema.hasTable('uptime_monitors');
  if (!hasMonitors) {
    await app.db.schema.createTable('uptime_monitors', (t) => {
      t.uuid('id').primary().defaultTo(app.db.fn.uuid());
      t.uuid('project_id').notNullable();
      t.string('name', 255);
      t.string('category', 100);
      t.text('url').notNullable();
      t.string('method', 10).defaultTo('GET');
      t.jsonb('headers').defaultTo('{}');
      t.text('body');
      t.integer('expected_status').defaultTo(200);
      t.text('expected_body');
      t.integer('interval_minutes').notNullable().defaultTo(5);
      t.integer('timeout_ms').defaultTo(10000);
      t.boolean('is_active').defaultTo(true);
      t.integer('retention_days').defaultTo(7);
      t.timestamp('created_at').defaultTo(app.db.fn.now());
      t.index('project_id');
    });
  } else {
    const hasCategory = await app.db.schema.hasColumn('uptime_monitors', 'category');
    if (!hasCategory) {
      await app.db.schema.alterTable('uptime_monitors', (t) => { t.string('category', 100); });
    }
  }

  if (projectSchema) {
    const logsTable = `${projectSchema}.uptime_logs`;
    const exists = await app.db.raw(`SELECT 1 FROM information_schema.tables WHERE table_schema = ? AND table_name = 'uptime_logs'`, [projectSchema]);
    if (exists.rows.length === 0) {
      await app.db.raw(`CREATE TABLE ${logsTable} (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        monitor_id UUID NOT NULL,
        monitor_name VARCHAR(255),
        category VARCHAR(100),
        url TEXT,
        status_code INTEGER,
        response_time_ms INTEGER,
        is_up BOOLEAN DEFAULT true,
        error TEXT,
        reason TEXT,
        checked_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await app.db.raw(`CREATE INDEX idx_uptime_logs_monitor ON ${logsTable} (monitor_id, checked_at)`);
    }
    await app.db.raw(`COMMENT ON TABLE ${logsTable} IS 'system:uptime-ping'`).catch(() => {});

    const pubExists = await app.db.raw(`SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'uptime_logs'`);
    if (pubExists.rows.length > 0) {
      await app.db.raw(`INSERT INTO ${logsTable} (monitor_id, monitor_name, url, status_code, response_time_ms, is_up, error, reason, checked_at)
        SELECT monitor_id, monitor_name, url, status_code, response_time_ms, is_up, error, reason, checked_at FROM public.uptime_logs
        ON CONFLICT DO NOTHING`).catch(() => {});
      await app.db.raw(`DROP TABLE public.uptime_logs`).catch(() => {});
    }
  }
}

const monitorSchema = z.object({
  name: z.string().max(255).optional(),
  category: z.string().max(100).optional().nullable(),
  url: z.string().url().max(2000),
  method: z.enum(['GET', 'POST', 'HEAD']).optional(),
  headers: z.record(z.string()).optional(),
  body: z.string().max(10000).optional().nullable(),
  expected_status: z.number().int().min(100).max(599).optional(),
  expected_body: z.string().max(1000).optional().nullable(),
  interval_minutes: z.number().int().refine((v) => ALLOWED_INTERVALS.includes(v)),
  timeout_ms: z.number().int().min(1000).max(30000).optional(),
  is_active: z.boolean().optional(),
  retention_days: z.number().int().min(1).max(7).optional(),
});

function getLogsTable(request: unknown): string {
  const schema = (request as Record<string, unknown>).projectSchema as string | undefined;
  return schema ? `${schema}.uptime_logs` : 'uptime_logs';
}

export async function uptimeMonitorRoutes(app: FastifyInstance) {
  app.addHook('preHandler', nodeAuthMiddleware);
  app.addHook('preHandler', requireWorkerRole('editor'));

  app.get('/:projectId/uptime-monitors', async (request) => {
    const { projectId } = request.params as { projectId: string };
    await ensureTables(app, (request as Record<string, unknown>).projectSchema as string);
    const monitors = await app.db('uptime_monitors')
      .where({ project_id: projectId })
      .orderBy('created_at', 'desc');

    const result = [];
    for (const m of monitors) {
      const [lastLog] = await app.db(getLogsTable(request))
        .where({ monitor_id: m.id })
        .orderBy('checked_at', 'desc')
        .limit(1);

      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const [stats24h] = await app.db(getLogsTable(request))
        .where({ monitor_id: m.id })
        .where('checked_at', '>=', since24h)
        .select(
          app.db.raw('COUNT(*)::int as total'),
          app.db.raw('COUNT(*) FILTER (WHERE is_up = true)::int as up_count'),
          app.db.raw('ROUND(AVG(response_time_ms))::int as avg_response_time'),
        );

      result.push({
        ...m,
        last_status: lastLog ? { is_up: lastLog.is_up, status_code: lastLog.status_code, response_time_ms: lastLog.response_time_ms, checked_at: lastLog.checked_at, error: lastLog.error, reason: lastLog.reason } : null,
        uptime_24h: stats24h?.total > 0 ? Math.round((stats24h.up_count / stats24h.total) * 10000) / 100 : null,
        avg_response_time_24h: stats24h?.avg_response_time ?? null,
        checks_24h: stats24h?.total ?? 0,
      });
    }
    return { monitors: result };
  });

  app.get('/:projectId/uptime-monitors/:id/logs', async (request) => {
    const { projectId, id } = request.params as { projectId: string; id: string };
    const query = request.query as Record<string, string>;
    const limit = Math.min(Number(query.limit ?? 100), 500);
    await ensureTables(app, (request as Record<string, unknown>).projectSchema as string);
    const logs = await app.db(getLogsTable(request))
      .where({ monitor_id: id })
      .orderBy('checked_at', 'desc')
      .limit(limit);
    return { logs };
  });

  app.get('/:projectId/uptime-monitors/:id/stats', async (request) => {
    const { id } = request.params as { projectId: string; id: string };
    await ensureTables(app, (request as Record<string, unknown>).projectSchema as string);

    const periods = [
      { key: '1h', ms: 60 * 60 * 1000 },
      { key: '24h', ms: 24 * 60 * 60 * 1000 },
      { key: '7d', ms: 7 * 24 * 60 * 60 * 1000 },
    ];

    const stats: Record<string, unknown> = {};
    for (const p of periods) {
      const since = new Date(Date.now() - p.ms).toISOString();
      const [row] = await app.db(getLogsTable(request))
        .where({ monitor_id: id })
        .where('checked_at', '>=', since)
        .select(
          app.db.raw('COUNT(*)::int as total'),
          app.db.raw('COUNT(*) FILTER (WHERE is_up = true)::int as up_count'),
          app.db.raw('ROUND(AVG(response_time_ms))::int as avg_ms'),
          app.db.raw('MIN(response_time_ms)::int as min_ms'),
          app.db.raw('MAX(response_time_ms)::int as max_ms'),
        );
      stats[p.key] = {
        total: row?.total ?? 0,
        uptime: row?.total > 0 ? Math.round((row.up_count / row.total) * 10000) / 100 : 100,
        avg_ms: row?.avg_ms ?? 0,
        min_ms: row?.min_ms ?? 0,
        max_ms: row?.max_ms ?? 0,
      };
    }

    const timeline = await app.db(getLogsTable(request))
      .where({ monitor_id: id })
      .where('checked_at', '>=', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .select('is_up', 'status_code', 'response_time_ms', 'checked_at')
      .orderBy('checked_at', 'asc');

    return { stats, timeline };
  });

  app.post('/:projectId/uptime-monitors', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const body = monitorSchema.parse(request.body);
    await ensureTables(app, (request as Record<string, unknown>).projectSchema as string);
    const [row] = await app.db('uptime_monitors')
      .insert({
        project_id: projectId,
        name: body.name ?? null,
        category: body.category ?? null,
        url: body.url,
        method: body.method ?? 'GET',
        headers: JSON.stringify(body.headers ?? {}),
        body: body.body ?? null,
        expected_status: body.expected_status ?? 200,
        expected_body: body.expected_body ?? null,
        interval_minutes: body.interval_minutes,
        timeout_ms: body.timeout_ms ?? 10000,
        is_active: body.is_active ?? true,
        retention_days: body.retention_days ?? 7,
      })
      .returning('*');

    const scheduler = (app as unknown as Record<string, unknown>).uptimeScheduler as { scheduleMonitor(m: unknown): void } | undefined;
    if (scheduler && row.is_active) scheduler.scheduleMonitor(row);

    return { monitor: row };
  });

  app.put('/:projectId/uptime-monitors/:id', async (request) => {
    const { projectId, id } = request.params as { projectId: string; id: string };
    const body = monitorSchema.partial().parse(request.body);
    await ensureTables(app, (request as Record<string, unknown>).projectSchema as string);
    const update: Record<string, unknown> = {};
    for (const key of ['name', 'category', 'url', 'method', 'expected_status', 'expected_body', 'interval_minutes', 'timeout_ms', 'is_active', 'retention_days', 'body'] as const) {
      if ((body as Record<string, unknown>)[key] !== undefined) update[key] = (body as Record<string, unknown>)[key];
    }
    if (body.headers !== undefined) update.headers = JSON.stringify(body.headers);
    const [row] = await app.db('uptime_monitors')
      .where({ id, project_id: projectId })
      .update(update)
      .returning('*');
    if (!row) return { error: 'Not found' };

    const scheduler = (app as unknown as Record<string, unknown>).uptimeScheduler as { rescheduleMonitor(m: unknown): void } | undefined;
    if (scheduler) scheduler.rescheduleMonitor(row);

    return { monitor: row };
  });

  app.delete('/:projectId/uptime-monitors/:id', async (request, reply) => {
    const { projectId, id } = request.params as { projectId: string; id: string };
    await ensureTables(app, (request as Record<string, unknown>).projectSchema as string);

    const scheduler = (app as unknown as Record<string, unknown>).uptimeScheduler as { stopMonitor(id: string): void } | undefined;
    if (scheduler) scheduler.stopMonitor(id);

    await app.db('uptime_monitors').where({ id, project_id: projectId }).delete();
    return reply.status(204).send();
  });
}

export { ensureTables };
