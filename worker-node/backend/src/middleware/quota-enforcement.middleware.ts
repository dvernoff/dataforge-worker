import type { FastifyRequest, FastifyReply } from 'fastify';
import { env } from '../config/env.js';

const concurrentByUser = new Map<string, number>();

async function reportQuotaViolation(
  projectId: string,
  userId: string,
  action: string,
  details: Record<string, unknown>,
): Promise<void> {
  try {
    const cpUrl = env.CONTROL_PLANE_URL;
    if (!cpUrl) return;
    await fetch(`${cpUrl}/api/internal/audit`, {
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
