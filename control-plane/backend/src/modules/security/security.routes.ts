import type { FastifyInstance } from 'fastify';
import { SecurityService } from './security.service.js';
import { ProxyService } from '../proxy/proxy.service.js';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { requireRole } from '../../middleware/rbac.middleware.js';
import { env } from '../../config/env.js';
import { z } from 'zod';

const securitySchema = z.object({
  ip_whitelist: z.array(z.string()).optional(),
  ip_blacklist: z.array(z.string()).optional(),
  ip_mode: z.enum(['disabled', 'whitelist', 'blacklist']).optional(),
});

export async function securityRoutes(app: FastifyInstance) {
  const securityService = new SecurityService(app.db);
  const proxyService = new ProxyService(app.db, app.redis);

  app.get('/:projectId/security', {
    preHandler: [authMiddleware, requireRole('admin')],
  }, async (request) => {
    const { projectId } = request.params as { projectId: string };
    const security = await securityService.getProjectSecurity(projectId);
    return { security };
  });

  app.put('/:projectId/security', {
    preHandler: [authMiddleware, requireRole('admin')],
  }, async (request) => {
    const { projectId } = request.params as { projectId: string };
    const body = securitySchema.parse(request.body);
    const security = await securityService.updateProjectSecurity(projectId, body);

    // Sync IP settings to worker
    try {
      const worker = await proxyService.getWorkerForProject(projectId);
      await fetch(`${worker.url.replace(/\/$/, '')}/internal/security/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-node-api-key': worker.apiKey,
          ...(env.INTERNAL_SECRET ? { 'x-internal-secret': env.INTERNAL_SECRET } : {}),
        },
        body: JSON.stringify({
          project_id: projectId,
          ip_mode: security.ip_mode ?? 'disabled',
          ip_whitelist: security.ip_whitelist ?? [],
          ip_blacklist: security.ip_blacklist ?? [],
        }),
      });
    } catch (err) {
      app.log.error(err, 'Failed to sync security settings to worker');
    }

    return { security };
  });
}
