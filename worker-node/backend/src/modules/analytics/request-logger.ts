import type { FastifyInstance } from 'fastify';
import type { Knex } from 'knex';
import { WebSocketService } from '../realtime/websocket.service.js';

const FLUSH_INTERVAL = 60_000;
const RAW_LOG_LIMIT_PER_PROJECT = 1000;

interface StatsBucket {
  project_id: string;
  method: string;
  path: string;
  status_group: number;
  hour: string;
  total_count: number;
  error_count: number;
  total_response_time_ms: number;
  max_response_time_ms: number;
  cache_hits: number;
  cache_misses: number;
  ips: Set<string>;
}

const statsBuffer = new Map<string, StatsBucket>();
const rawBuffer: Array<{
  project_id: string;
  method: string;
  path: string;
  status_code: number;
  response_time_ms: number;
  ip_address: string;
  user_agent: string;
  error: string | null;
  cache_status: string | null;
}> = [];

function getHourKey(date: Date): string {
  const d = new Date(date);
  d.setMinutes(0, 0, 0);
  return d.toISOString();
}

function getStatusGroup(code: number): number {
  if (code < 200) return 100;
  if (code < 300) return 200;
  if (code < 400) return 300;
  if (code < 500) return 400;
  return 500;
}

function getBucketKey(projectId: string, method: string, path: string, statusGroup: number, hour: string): string {
  return `${projectId}|${method}|${path}|${statusGroup}|${hour}`;
}

async function flushStats(db: Knex, log: any) {
  if (statsBuffer.size === 0 && rawBuffer.length === 0) return;

  const buckets = Array.from(statsBuffer.values());
  statsBuffer.clear();

  const logs = rawBuffer.splice(0);

  if (buckets.length > 0) {
    try {
      for (const bucket of buckets) {
        const uniqueIps = Array.from(bucket.ips);
        await db.raw(
          `INSERT INTO api_request_stats
             (project_id, method, path, status_group, hour, total_count, error_count,
              total_response_time_ms, max_response_time_ms, cache_hits, cache_misses, unique_ips)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::text[])
           ON CONFLICT (project_id, method, path, status_group, hour) DO UPDATE SET
             total_count = api_request_stats.total_count + EXCLUDED.total_count,
             error_count = api_request_stats.error_count + EXCLUDED.error_count,
             total_response_time_ms = api_request_stats.total_response_time_ms + EXCLUDED.total_response_time_ms,
             max_response_time_ms = GREATEST(api_request_stats.max_response_time_ms, EXCLUDED.max_response_time_ms),
             cache_hits = api_request_stats.cache_hits + EXCLUDED.cache_hits,
             cache_misses = api_request_stats.cache_misses + EXCLUDED.cache_misses,
             unique_ips = (
               SELECT ARRAY(SELECT DISTINCT unnest FROM unnest(api_request_stats.unique_ips || EXCLUDED.unique_ips))
             )`,
          [
            bucket.project_id, bucket.method, bucket.path, bucket.status_group, bucket.hour,
            bucket.total_count, bucket.error_count, bucket.total_response_time_ms,
            bucket.max_response_time_ms, bucket.cache_hits, bucket.cache_misses,
            `{${uniqueIps.map(ip => `"${ip}"`).join(',')}}`,
          ],
        );
      }
    } catch (err) {
      log.error({ err }, 'Failed to flush analytics stats');
    }
  }

  if (logs.length > 0) {
    try {
      const batchSize = 500;
      for (let i = 0; i < logs.length; i += batchSize) {
        await db('api_request_logs').insert(logs.slice(i, i + batchSize));
      }

      const projectIds = [...new Set(logs.map(l => l.project_id))];
      for (const pid of projectIds) {
        const count = await db('api_request_logs').where({ project_id: pid }).count('id as c').first();
        const total = Number(count?.c ?? 0);
        if (total > RAW_LOG_LIMIT_PER_PROJECT) {
          const cutoffRow = await db('api_request_logs')
            .where({ project_id: pid })
            .orderBy('created_at', 'desc')
            .offset(RAW_LOG_LIMIT_PER_PROJECT)
            .limit(1)
            .select('created_at')
            .first();
          if (cutoffRow) {
            await db('api_request_logs')
              .where({ project_id: pid })
              .where('created_at', '<', cutoffRow.created_at)
              .del();
          }
        }
      }
    } catch (err) {
      log.error({ err }, 'Failed to flush raw request logs');
    }
  }
}

export function registerRequestLogger(app: FastifyInstance) {
  const flushTimer = setInterval(() => flushStats(app.db, app.log), FLUSH_INTERVAL);

  app.addHook('onClose', async () => {
    clearInterval(flushTimer);
    await flushStats(app.db, app.log);
  });

  app.addHook('onResponse', async (request, reply) => {
    if (!request.url.startsWith('/api/v1/')) return;

    const projectId = request.projectId as string | undefined;
    if (!projectId) return;

    const responseTime = Math.round(reply.elapsedTime);
    const ip = request.headers['x-forwarded-for'] as string ?? request.ip;
    const cleanIp = typeof ip === 'string' ? ip.split(',')[0].trim() : String(ip);
    const userAgent = request.headers['user-agent'] ?? '';
    const statusCode = reply.statusCode;
    const method = request.method;
    const path = request.url;

    const cacheHeader = reply.getHeader('X-Cache') as string | undefined;
    const cacheStatus = cacheHeader === 'HIT' ? 'HIT' : cacheHeader === 'MISS' ? 'MISS' : null;

    const now = new Date();
    const hour = getHourKey(now);
    const statusGroup = getStatusGroup(statusCode);
    const key = getBucketKey(projectId, method, path, statusGroup, hour);

    let bucket = statsBuffer.get(key);
    if (!bucket) {
      bucket = {
        project_id: projectId,
        method,
        path,
        status_group: statusGroup,
        hour,
        total_count: 0,
        error_count: 0,
        total_response_time_ms: 0,
        max_response_time_ms: 0,
        cache_hits: 0,
        cache_misses: 0,
        ips: new Set(),
      };
      statsBuffer.set(key, bucket);
    }

    bucket.total_count++;
    if (statusCode >= 400) bucket.error_count++;
    bucket.total_response_time_ms += responseTime;
    if (responseTime > bucket.max_response_time_ms) bucket.max_response_time_ms = responseTime;
    if (cacheStatus === 'HIT') bucket.cache_hits++;
    if (cacheStatus === 'MISS') bucket.cache_misses++;
    bucket.ips.add(cleanIp);

    rawBuffer.push({
      project_id: projectId,
      method,
      path,
      status_code: statusCode,
      response_time_ms: responseTime,
      ip_address: cleanIp,
      user_agent: userAgent,
      error: statusCode >= 400 ? `HTTP ${statusCode}` : null,
      cache_status: cacheStatus,
    });

    try {
      const ws = WebSocketService.getInstance();
      ws.broadcast(`project:${projectId}`, {
        type: 'api_call' as any,
        table: '',
        action: 'INSERT',
        record: { method, path, status_code: statusCode, response_time_ms: responseTime, ip_address: cleanIp, cache_status: cacheStatus, created_at: now.toISOString() },
        timestamp: now.toISOString(),
      });
    } catch {}
  });
}
