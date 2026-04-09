import type { Knex } from 'knex';

interface Monitor {
  id: string;
  project_id: string;
  name: string | null;
  category: string | null;
  url: string;
  method: string;
  headers: Record<string, string> | string;
  body: string | null;
  expected_status: number;
  expected_body: string | null;
  interval_minutes: number;
  timeout_ms: number;
  is_active: boolean;
  retention_days: number;
}

const HTTP_REASONS: Record<number, string> = {
  200: 'OK', 201: 'Created', 204: 'No Content',
  301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified',
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found',
  405: 'Method Not Allowed', 408: 'Request Timeout', 429: 'Too Many Requests',
  500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout',
};

export class UptimeScheduler {
  private timers = new Map<string, ReturnType<typeof setInterval>>();

  constructor(private db: Knex) {}

  async startAll() {
    try {
      const hasTable = await this.db.schema.hasTable('uptime_monitors');
      if (!hasTable) return;
      const monitors = await this.db('uptime_monitors').where({ is_active: true });
      console.log(`[UptimeScheduler] Starting ${monitors.length} monitors`);
      for (const m of monitors) {
        this.scheduleMonitor(m);
      }
    } catch (err) {
      console.error('[UptimeScheduler] Failed to start:', (err as Error).message);
    }
  }

  scheduleMonitor(m: Monitor) {
    this.stopMonitor(m.id);
    if (!m.is_active) return;
    const ms = m.interval_minutes * 60 * 1000;
    this.runCheck(m).catch(() => {});
    const timer = setInterval(() => this.runCheck(m).catch(() => {}), ms);
    this.timers.set(m.id, timer);
  }

  rescheduleMonitor(m: Monitor) {
    this.stopMonitor(m.id);
    if (m.is_active) this.scheduleMonitor(m);
  }

  stopMonitor(id: string) {
    const t = this.timers.get(id);
    if (t) { clearInterval(t); this.timers.delete(id); }
  }

  stopAll() {
    for (const [id, t] of this.timers) { clearInterval(t); }
    this.timers.clear();
  }

  private async runCheck(m: Monitor) {
    const start = performance.now();
    let statusCode = 0;
    let isUp = false;
    let error: string | null = null;
    let reason: string | null = null;

    try {
      const headers: Record<string, string> = typeof m.headers === 'string' ? JSON.parse(m.headers) : (m.headers ?? {});
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), m.timeout_ms || 10000);

      const fetchOpts: RequestInit = {
        method: m.method || 'GET',
        headers,
        signal: controller.signal,
      };
      if (m.body && m.method !== 'GET' && m.method !== 'HEAD') {
        fetchOpts.body = m.body;
      }

      const res = await fetch(m.url, fetchOpts);
      clearTimeout(timeout);
      statusCode = res.status;
      reason = HTTP_REASONS[statusCode] ?? `HTTP ${statusCode}`;

      if (m.expected_status && statusCode !== m.expected_status) {
        isUp = false;
        error = `Expected status ${m.expected_status}, got ${statusCode}`;
        reason = `Status mismatch: expected ${m.expected_status}, got ${statusCode} (${reason})`;
      } else if (m.expected_body) {
        const bodyText = await res.text();
        if (!bodyText.includes(m.expected_body)) {
          isUp = false;
          error = `Response body does not contain expected string`;
          reason = `Body check failed: "${m.expected_body}" not found in response`;
        } else {
          isUp = true;
        }
      } else {
        isUp = statusCode >= 200 && statusCode < 400;
      }
    } catch (err: unknown) {
      const e = err as Error;
      if (e.name === 'AbortError') {
        error = `Timeout after ${m.timeout_ms}ms`;
        reason = `Request timed out after ${m.timeout_ms}ms`;
      } else {
        error = e.message;
        reason = `Connection failed: ${e.message}`;
      }
    }

    const responseTime = Math.round(performance.now() - start);

    try {
      const project = await this.db('projects').where({ id: m.project_id }).select('db_schema').first();
      const logsTable = project?.db_schema ? `${project.db_schema}.uptime_logs` : 'uptime_logs';

      await this.db(logsTable).insert({
        monitor_id: m.id,
        monitor_name: m.name ?? m.url,
        category: m.category ?? null,
        url: m.url,
        status_code: statusCode || null,
        response_time_ms: responseTime,
        is_up: isUp,
        error,
        reason,
      });

      const cutoff = new Date(Date.now() - Math.min(m.retention_days || 7, 7) * 24 * 60 * 60 * 1000);
      await this.db(logsTable)
        .where({ monitor_id: m.id })
        .where('checked_at', '<', cutoff.toISOString())
        .delete();
    } catch {}
  }

  getActiveCount(): number {
    return this.timers.size;
  }
}
