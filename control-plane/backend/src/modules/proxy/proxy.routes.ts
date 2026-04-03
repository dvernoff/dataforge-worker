import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ProxyService } from './proxy.service.js';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { requireRole } from '../../middleware/rbac.middleware.js';
import { QuotasService } from '../quotas/quotas.service.js';
import { logAudit } from '../audit/audit.middleware.js';

export async function proxyRoutes(app: FastifyInstance) {
  const proxyService = new ProxyService(app.db, app.redis);
  const quotasService = new QuotasService(app.db, app.redis);

  app.addHook('preHandler', authMiddleware);

  // Map URL segments to quota resource types for POST enforcement
  const createQuotaMap: Record<string, 'tables' | 'endpoints' | 'webhooks' | 'cron' | 'files' | 'backups'> = {
    tables: 'tables',
    endpoints: 'endpoints',
    webhooks: 'webhooks',
    cron: 'cron',
    files: 'files',
    backups: 'backups',
  };

  // Shared proxy handler
  async function handleProxy(request: FastifyRequest, reply: FastifyReply) {
    const { projectId } = request.params as { projectId: string };
    const wildcardPath = (request.params as Record<string, string>)['*'] ?? '';

    const rawUrl = request.url;
    const segmentMatch = rawUrl.match(new RegExp(`${projectId}/([^/]+)`));
    const segment = segmentMatch ? segmentMatch[1] : '';

    // Preserve query string from the original request
    const qsIndex = rawUrl.indexOf('?');
    const queryString = qsIndex >= 0 ? rawUrl.substring(qsIndex) : '';

    // ── Quota enforcement: block POST creates if quota exceeded ──
    // Only check on POST to root collection (no wildcard = creating new resource)
    // Superadmins bypass quota checks
    if (request.method === 'POST' && !request.user.is_superadmin) {
      const resourceType = createQuotaMap[segment];
      if (resourceType && !wildcardPath) {
        const blocked = await quotasService.checkCreateQuota(request.user.id, resourceType);
        if (blocked) {
          return reply.status(429).send({
            error: blocked,
            errorCode: 'QUOTA_EXCEEDED',
          });
        }
      }
    }

    const worker = await proxyService.getWorkerForProject(projectId);
    const workerPath = `/api/projects/${projectId}/${segment}${wildcardPath ? '/' + wildcardPath : ''}${queryString}`;

    // Look up project slug and node type for auto-provisioning on worker
    const projInfo = await app.db('projects as p')
      .join('nodes as n', 'p.node_id', 'n.id')
      .where('p.id', projectId)
      .select('p.slug', 'n.owner_id')
      .first();

    // Resolve user performance quotas (cached in Redis by QuotasService)
    const quotaHeaders: Record<string, string> = {};
    const isSharedNode = !projInfo?.owner_id;
    quotaHeaders['x-node-shared'] = isSharedNode ? '1' : '0';

    if (isSharedNode && request.user?.id) {
      try {
        const { quota } = await quotasService.getEffectiveQuota(request.user.id);
        quotaHeaders['x-quota-query-timeout'] = String(quota.max_query_timeout_ms ?? 30000);
        quotaHeaders['x-quota-concurrent'] = String(quota.max_concurrent_requests ?? 10);
        quotaHeaders['x-quota-max-rows'] = String(quota.max_rows_per_query ?? 1000);
        quotaHeaders['x-quota-max-export'] = String(quota.max_export_rows ?? 10000);
      } catch { /* use worker defaults */ }
    }

    try {
      const result = await proxyService.forwardToWorker(
        worker.url,
        worker.apiKey,
        request.method,
        workerPath,
        {
          'content-type': (request.headers['content-type'] as string) ?? 'application/json',
          'x-user-id': request.user.id,
          'x-user-role': ((request as unknown as Record<string, unknown>).projectRole as string) ?? 'viewer',
          'x-project-slug': projInfo?.slug ?? '',
          ...quotaHeaders,
        },
        request.body,
        projectId,
        worker.schema
      );

      // Forward response headers (skip hop-by-hop)
      const skipHeaders = new Set([
        'transfer-encoding', 'connection', 'keep-alive',
        'proxy-authenticate', 'proxy-authorization', 'te',
        'trailer', 'upgrade',
      ]);
      for (const [key, value] of Object.entries(result.headers)) {
        if (!skipHeaders.has(key.toLowerCase())) {
          reply.header(key, value);
        }
      }

      // Audit log for mutating requests that succeeded
      if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method) && result.status < 400) {
        const methodMap: Record<string, string> = { POST: 'create', PUT: 'update', PATCH: 'update', DELETE: 'delete' };
        const action = `${segment}.${methodMap[request.method] ?? request.method.toLowerCase()}`;
        logAudit(request, action, segment, wildcardPath || undefined, {
          method: request.method,
          path: `/${segment}${wildcardPath ? '/' + wildcardPath : ''}`,
          status: result.status,
        });
      }

      // Invalidate caches after mutating requests
      if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method)) {
        // KEYS ignores ioredis keyPrefix, DEL auto-prepends it — strip prefix before del()
        const keys1 = await app.redis.keys('cp:projects:*');
        if (keys1.length) await app.redis.del(...keys1.map(k => k.replace(/^cp:/, '')));
        const keys2 = await app.redis.keys(`cache:endpoint:${projectId}:*`);
        if (keys2.length) await app.redis.del(...keys2.map(k => k.replace(/^cp:/, '')));
      }

      return reply.status(result.status).send(result.body);
    } catch (err) {
      request.log.error({ err, workerPath, projectId }, 'Proxy error');
      return reply.status(502).send({ error: 'Worker proxy failed', details: (err as Error).message });
    }
  }

  // ── Admin-only routes (cron, flows, pipelines, AI) ──
  const adminPatterns = [
    '/:projectId/cron/*', '/:projectId/cron',
    '/:projectId/flows/*', '/:projectId/flows',
    '/:projectId/pipelines/*', '/:projectId/pipelines',
    '/:projectId/ai/*', '/:projectId/ai',
  ];
  for (const pattern of adminPatterns) {
    app.all(pattern, { preHandler: [requireRole('admin')] }, handleProxy);
  }

  // ── Editor routes (dashboards, plugins) ──
  const editorPatterns = [
    '/:projectId/dashboards/*', '/:projectId/dashboards',
    '/:projectId/plugins/*', '/:projectId/plugins',
  ];
  for (const pattern of editorPatterns) {
    app.all(pattern, { preHandler: [requireRole('editor')] }, handleProxy);
  }

  // ── OpenAPI spec proxy (viewer+) ──
  app.get('/:projectId/openapi-spec', { preHandler: [requireRole('viewer')] }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await app.db('projects').where({ id: projectId }).select('slug').first();
    if (!project) return reply.status(404).send({ error: 'Project not found' });

    const worker = await proxyService.getWorkerForProject(projectId);
    const specUrl = `${worker.url}/api/v1/${project.slug}/docs/openapi.json`;

    try {
      const res = await fetch(specUrl, {
        headers: { 'X-Node-Api-Key': worker.apiKey },
      });
      const spec = await res.json();
      return reply.send(spec);
    } catch {
      return reply.status(502).send({ error: 'Failed to fetch OpenAPI spec from worker' });
    }
  });

  // ── Viewer routes (read-only: tables, data, endpoints, webhooks, sql, etc.) ──
  const viewerPatterns = [
    '/:projectId/tables/*', '/:projectId/tables',
    '/:projectId/endpoints/*', '/:projectId/endpoints',
    '/:projectId/webhooks/*', '/:projectId/webhooks',
    '/:projectId/sql/*', '/:projectId/sql',
    '/:projectId/schema-versions',
    '/:projectId/batch',
    '/:projectId/graphql',
    '/:projectId/analytics/*', '/:projectId/analytics',
    '/:projectId/explorer/*', '/:projectId/explorer',
    '/:projectId/db-map',
    '/:projectId/natural',
    '/:projectId/files/*', '/:projectId/files',
  ];
  for (const pattern of viewerPatterns) {
    app.all(pattern, { preHandler: [requireRole('viewer')] }, handleProxy);
  }
}
