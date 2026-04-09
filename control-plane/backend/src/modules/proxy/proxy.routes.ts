import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ProxyService, fetchWithKeepAlive } from './proxy.service.js';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { requireRole } from '../../middleware/rbac.middleware.js';
import { ProjectQuotasService } from '../project-quotas/project-quotas.service.js';
import { logAudit } from '../audit/audit.middleware.js';

export async function proxyRoutes(app: FastifyInstance) {
  const proxyService = new ProxyService(app.db, app.redis);
  const projectQuotasService = new ProjectQuotasService(app.db, app.redis);

  app.addHook('preHandler', authMiddleware);

  // Map URL segments to quota resource types for POST enforcement
  const createQuotaMap: Record<string, 'tables' | 'endpoints' | 'cron' | 'files' | 'backups'> = {
    tables: 'tables',
    endpoints: 'endpoints',
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
        const blocked = await projectQuotasService.checkProjectCreateQuota(projectId, resourceType);
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

    // Resolve project performance quotas (slug & nodeOwnerId already in worker info)
    const quotaHeaders: Record<string, string> = {};
    const isSharedNode = !worker.nodeOwnerId;
    quotaHeaders['x-node-shared'] = isSharedNode ? '1' : '0';

    if (isSharedNode) {
      try {
        const { quota } = await projectQuotasService.getEffectiveProjectQuota(projectId);
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
          'x-project-slug': worker.slug,
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
        const scanDel = async (pattern: string) => {
          let cursor = '0';
          do {
            const [next, keys] = await app.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
            cursor = next;
            if (keys.length) await app.redis.del(...keys.map(k => k.replace(/^cp:/, '')));
          } while (cursor !== '0');
        };
        scanDel('cp:projects:*').catch(() => {});
        scanDel(`cache:endpoint:${projectId}:*`).catch(() => {});
      }

      return reply.status(result.status).send(result.body);
    } catch (err) {
      request.log.error({ err, workerPath, projectId }, 'Proxy error');
      return reply.status(502).send({ error: 'Worker proxy failed', details: (err as Error).message });
    }
  }

  // ── Admin-only routes (cron, backup-export) ──
  const adminPatterns = [
    '/:projectId/cron/*', '/:projectId/cron',
    '/:projectId/rls/*', '/:projectId/rls',
    '/:projectId/backups/export-data',
    '/:projectId/backups/restore-data',
  ];
  for (const pattern of adminPatterns) {
    app.all(pattern, { preHandler: [requireRole('admin')] }, handleProxy);
  }

  // ── Editor routes (dashboards, plugins) ──
  const editorPatterns = [
    '/:projectId/dashboards/*', '/:projectId/dashboards',
    '/:projectId/plugins/*', '/:projectId/plugins',
    '/:projectId/discord-webhooks/*', '/:projectId/discord-webhooks',
    '/:projectId/telegram-notifications/*', '/:projectId/telegram-notifications',
    '/:projectId/uptime-monitors/*', '/:projectId/uptime-monitors',
  ];
  for (const pattern of editorPatterns) {
    app.all(pattern, { preHandler: [requireRole('editor')] }, handleProxy);
  }

  // ── OpenAPI spec proxy (viewer+) ──
  app.get('/:projectId/openapi-spec', { preHandler: [requireRole('viewer')] }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };

    const worker = await proxyService.getWorkerForProject(projectId);
    const specUrl = `${worker.url}/api/v1/${worker.slug}/docs/openapi.json`;

    try {
      const res = await fetchWithKeepAlive(specUrl, {
        headers: { 'X-Node-Api-Key': worker.apiKey },
      });
      const spec = await res.json();
      return reply.send(spec);
    } catch {
      return reply.status(502).send({ error: 'Failed to fetch OpenAPI spec from worker' });
    }
  });

  // ── API Playground proxy (bypass CORS) ──
  app.post('/:projectId/api-playground/proxy', { preHandler: [requireRole('viewer')] }, async (request, reply) => {
    const { url, method: reqMethod, headers: reqHeaders, body: reqBody } = request.body as {
      url: string;
      method: string;
      headers?: Record<string, string>;
      body?: string;
    };

    if (!url || !reqMethod) {
      return reply.status(400).send({ error: 'url and method are required' });
    }

    try {
      new URL(url);
    } catch {
      return reply.status(400).send({ error: 'Invalid URL' });
    }

    const allowedMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
    if (!allowedMethods.includes(reqMethod.toUpperCase())) {
      return reply.status(400).send({ error: 'Unsupported HTTP method' });
    }

    try {
      const fetchOptions: RequestInit = {
        method: reqMethod.toUpperCase(),
        headers: reqHeaders ?? {},
      };
      if (reqBody && !['GET', 'HEAD'].includes(reqMethod.toUpperCase())) {
        fetchOptions.body = reqBody;
      }

      const start = performance.now();
      const res = await fetch(url, fetchOptions);
      const duration = Math.round(performance.now() - start);

      const responseHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => { responseHeaders[k] = v; });

      const contentType = res.headers.get('content-type') ?? '';
      let responseBody: string;
      if (contentType.includes('json')) {
        try {
          const json = await res.json();
          responseBody = JSON.stringify(json, null, 2);
        } catch {
          responseBody = await res.text();
        }
      } else {
        responseBody = await res.text();
      }

      return reply.send({
        status: res.status,
        statusText: res.statusText,
        headers: responseHeaders,
        body: responseBody,
        duration,
      });
    } catch (err: any) {
      return reply.send({
        status: 0,
        statusText: 'Network Error',
        headers: {},
        body: err.message ?? 'Failed to connect',
        duration: 0,
      });
    }
  });

  // ── Viewer routes (read-only) ──
  const viewerPatterns = [
    '/:projectId/tables/*', '/:projectId/tables',
    '/:projectId/endpoints/*', '/:projectId/endpoints',
    '/:projectId/webhooks/*', '/:projectId/webhooks',
    '/:projectId/sql/*', '/:projectId/sql',
    '/:projectId/schema-versions/*', '/:projectId/schema-versions',
    '/:projectId/batch',
    '/:projectId/graphql',
    '/:projectId/analytics/*', '/:projectId/analytics',
    '/:projectId/explorer/*', '/:projectId/explorer',
    '/:projectId/db-map',
    '/:projectId/files/*', '/:projectId/files',
    '/:projectId/ws-stats',
  ];
  for (const pattern of viewerPatterns) {
    app.get(pattern, { preHandler: [requireRole('viewer')] }, handleProxy);
    app.post(pattern, { preHandler: [requireRole('editor')] }, handleProxy);
    app.put(pattern, { preHandler: [requireRole('editor')] }, handleProxy);
    app.patch(pattern, { preHandler: [requireRole('editor')] }, handleProxy);
    app.delete(pattern, { preHandler: [requireRole('editor')] }, handleProxy);
  }
}
