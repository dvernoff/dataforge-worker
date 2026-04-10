import type { FastifyRequest, FastifyReply } from 'fastify';
import { env } from '../config/env.js';

const concurrentByUser = new Map<string, number>();

const autoDisableRequested = new Set<string>();

export async function requestAutoDisable(projectId: string, reason: string): Promise<void> {
  if (autoDisableRequested.has(projectId)) return;
  autoDisableRequested.add(projectId);
  setTimeout(() => autoDisableRequested.delete(projectId), 60_000);

  try {
    const cpUrl = env.CONTROL_PLANE_URL;
    if (!cpUrl) return;
    await fetch(`${cpUrl}/internal/auto-disable`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-node-api-key': env.NODE_API_KEY,
      },
      body: JSON.stringify({ project_id: projectId, reason }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => {});
  } catch {}
}

export async function reportQuotaViolation(
  projectId: string,
  userId: string,
  action: string,
  details: Record<string, unknown>,
): Promise<void> {
  try {
    const cpUrl = env.CONTROL_PLANE_URL;
    if (!cpUrl) return;
    await fetch(`${cpUrl}/internal/audit`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-node-api-key': env.NODE_API_KEY,
      },
      body: JSON.stringify({
        project_id: projectId,
        user_id: userId,
        action,
        resource_type: 'quota',
        details,
      }),
      signal: AbortSignal.timeout(3000),
    }).catch(() => {});
  } catch {}
}

export async function quotaConcurrencyGuard(request: FastifyRequest, reply: FastifyReply) {
  const { quotas, userId } = request;
  if (!quotas || !quotas.concurrent || !userId) return;

  const current = concurrentByUser.get(userId) ?? 0;
  if (current >= quotas.concurrent) {
    const { projectId } = request;
    reportQuotaViolation(projectId, userId, 'quota.concurrent_exceeded', {
      limit: quotas.concurrent,
      current: current,
      path: request.url,
    });
    return reply.status(429).send({
      error: `Too many concurrent requests (limit: ${quotas.concurrent}). Wait for current requests to finish.`,
      errorCode: 'QUOTA_CONCURRENT',
    });
  }

  concurrentByUser.set(userId, current + 1);

  const decrement = () => {
    const val = concurrentByUser.get(userId) ?? 1;
    if (val <= 1) {
      concurrentByUser.delete(userId);
    } else {
      concurrentByUser.set(userId, val - 1);
    }
  };

  reply.raw.on('finish', decrement);
  request.raw.on('close', () => {
    if (!reply.raw.writableFinished) {
      decrement();
    }
  });
}

export async function checkResourceQuota(
  db: any,
  projectId: string,
  resource: 'tables' | 'endpoints' | 'cron' | 'files' | 'webhooks',
  quotas: Record<string, number> | null,
  schema?: string,
): Promise<string | null> {
  if (!quotas) return null;

  const limits: Record<string, { table: string; column: string; max: number }> = {
    tables: { table: 'information_schema.tables', column: 'table_name', max: quotas.maxTables || 0 },
    endpoints: { table: 'api_endpoints', column: 'id', max: quotas.maxEndpoints || 0 },
    cron: { table: 'cron_jobs', column: 'id', max: quotas.maxCron || 0 },
    files: { table: 'files', column: 'id', max: quotas.maxFiles || 0 },
    webhooks: { table: 'webhooks', column: 'id', max: quotas.maxWebhooks || 0 },
  };

  const cfg = limits[resource];
  if (!cfg || cfg.max <= 0) return null;

  try {
    let count: number;
    if (resource === 'tables' && schema) {
      const result = await db.raw(
        `SELECT COUNT(*)::int as count FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE'`,
        [schema]
      );
      count = result.rows[0].count;
    } else {
      const [row] = await db(cfg.table).where({ project_id: projectId }).count(`${cfg.column} as count`);
      count = Number(row.count);
    }

    if (count >= cfg.max) {
      return `Quota exceeded: maximum ${cfg.max} ${resource} allowed`;
    }
  } catch {}

  return null;
}

export async function checkRecordsQuota(
  redis: any,
  db: any,
  projectId: string,
  schema: string,
  maxRecords: number,
): Promise<string | null> {
  if (maxRecords <= 0) return null;

  const cacheKey = `records_count:${projectId}`;

  try {
    if (redis) {
      const cached = await redis.get(cacheKey);
      if (cached !== null) {
        const total = Number(cached);
        if (total >= maxRecords) {
          return `Quota exceeded: total records (${total}/${maxRecords})`;
        }
        return null;
      }
    }
  } catch {}

  try {
    const tables = await db.raw(
      `SELECT tablename FROM pg_tables WHERE schemaname = ?`, [schema]
    );
    if (!tables.rows?.length) return null;

    const countQueries = tables.rows.map((t: { tablename: string }) =>
      `SELECT COUNT(*)::bigint AS c FROM "${schema}"."${t.tablename}"`
    );
    const result = await db.raw(countQueries.join(' UNION ALL '));
    const total = (result.rows ?? []).reduce(
      (sum: number, r: { c: string }) => sum + Number(r.c), 0
    );

    try {
      if (redis) await redis.set(cacheKey, String(total), 'EX', 60);
    } catch {}

    if (total >= maxRecords) {
      requestAutoDisable(projectId, `Records limit exceeded: ${total}/${maxRecords}`);
      return `Quota exceeded: total records (${total}/${maxRecords})`;
    }
  } catch {}

  return null;
}

export async function checkStorageQuota(
  redis: any,
  db: any,
  projectId: string,
  schema: string,
  maxStorageMb: number,
  backupsSizeMb = 0,
): Promise<string | null> {
  if (maxStorageMb <= 0) return null;

  const cacheKey = `storage_mb:${projectId}`;

  try {
    if (redis) {
      const cached = await redis.get(cacheKey);
      if (cached !== null) {
        const totalMb = Number(cached) + backupsSizeMb;
        if (totalMb >= maxStorageMb) {
          return `Storage quota exceeded: ${totalMb.toFixed(1)}MB / ${maxStorageMb}MB`;
        }
        return null;
      }
    }
  } catch {}

  try {
    const sizeResult = await db.raw(
      `SELECT COALESCE(SUM(pg_total_relation_size('"' || ? || '"."' || tablename || '"')), 0)::bigint AS size_bytes
       FROM pg_tables WHERE schemaname = ?`,
      [schema, schema]
    );
    let localMb = Number(sizeResult.rows?.[0]?.size_bytes ?? 0) / 1024 / 1024;

    try {
      const hasFiles = await db.schema.hasTable('files');
      if (hasFiles) {
        const fileStats = await db('files')
          .where({ project_id: projectId })
          .select(db.raw('COALESCE(SUM(size), 0)::bigint as total_bytes'))
          .first();
        localMb += Number(fileStats?.total_bytes ?? 0) / 1024 / 1024;
      }
    } catch {}

    try {
      if (redis) await redis.set(cacheKey, String(Math.round(localMb * 100) / 100), 'EX', 60);
    } catch {}

    const totalMb = localMb + backupsSizeMb;
    if (totalMb >= maxStorageMb) {
      requestAutoDisable(projectId, `Storage limit exceeded: ${totalMb.toFixed(1)}MB / ${maxStorageMb}MB`);
      return `Storage quota exceeded: ${totalMb.toFixed(1)}MB / ${maxStorageMb}MB`;
    }
  } catch {}

  return null;
}

export async function checkApiRequestQuota(
  redis: any,
  projectId: string,
  maxApiRequests: number,
): Promise<string | null> {
  if (maxApiRequests <= 0 || !redis) return null;

  const today = new Date().toISOString().slice(0, 10);
  const key = `api_req_count:${projectId}:${today}`;

  try {
    const current = await redis.incr(key);
    if (current === 1) {
      await redis.expire(key, 90000);
    }

    if (current > maxApiRequests) {
      requestAutoDisable(projectId, `Daily API request limit exceeded: ${current}/${maxApiRequests}`);
      return `Daily API request quota exceeded (${current}/${maxApiRequests})`;
    }
  } catch {}

  return null;
}

export function getQuotaHelpers(request: FastifyRequest) {
  const { quotas, isSharedNode: isShared, userId, projectId } = request;

  return {
    maxRows: (isShared && quotas?.maxRows) ? quotas.maxRows : 0,
    maxExport: (isShared && quotas?.maxExport) ? quotas.maxExport : 0,
    queryTimeout: (isShared && quotas?.queryTimeout) ? quotas.queryTimeout : 0,

    reportViolation(action: string, details: Record<string, unknown>) {
      reportQuotaViolation(projectId, userId, action, details);
    },
  };
}
