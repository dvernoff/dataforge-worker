import type { FastifyRequest, FastifyReply } from 'fastify';
import { env } from '../config/env.js';

/**
 * Tracks concurrent requests per user and enforces limits.
 * Only active on shared nodes (quotas.concurrent > 0).
 */
const concurrentByUser = new Map<string, number>();

/** Report quota violation to CP audit_log */
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
  } catch { /* fire and forget */ }
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

  // Decrement when response is sent (onResponse) or connection drops (onRequestAbort)
  reply.raw.on('finish', decrement);
  request.raw.on('close', () => {
    // If the connection was aborted before response finished
    if (!reply.raw.writableFinished) {
      decrement();
    }
  });
}

export function getQuotaHelpers(request: FastifyRequest) {
  const { quotas, isSharedNode: isShared, userId, projectId } = request;

  return {
    /** Effective row limit for data list queries. 0 = no limit (personal node). */
    maxRows: (isShared && quotas?.maxRows) ? quotas.maxRows : 0,
    /** Effective row limit for export. 0 = no limit. */
    maxExport: (isShared && quotas?.maxExport) ? quotas.maxExport : 0,
    /** Effective statement_timeout in ms. 0 = no limit. */
    queryTimeout: (isShared && quotas?.queryTimeout) ? quotas.queryTimeout : 0,

    /** Log a quota violation to CP audit log */
    reportViolation(action: string, details: Record<string, unknown>) {
      reportQuotaViolation(projectId, userId, action, details);
    },
  };
}
