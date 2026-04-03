import type { FastifyInstance } from 'fastify';
import { SecurityService } from './security.service.js';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { requireRole } from '../../middleware/rbac.middleware.js';
import { z } from 'zod';

const securitySchema = z.object({
  ip_whitelist: z.array(z.string()).optional(),
  ip_blacklist: z.array(z.string()).optional(),
  ip_mode: z.enum(['disabled', 'whitelist', 'blacklist']).optional(),
  geo_countries: z.array(z.string()).optional(),
  geo_mode: z.enum(['disabled', 'allow', 'block']).optional(),
  apply_to_ui: z.boolean().optional(),
  apply_to_api: z.boolean().optional(),
});

export async function securityRoutes(app: FastifyInstance) {
  const securityService = new SecurityService(app.db);

  // GET /api/projects/:projectId/security — get security settings
  app.get('/:projectId/security', {
    preHandler: [authMiddleware, requireRole('admin')],
  }, async (request) => {
    const { projectId } = request.params as { projectId: string };
    const security = await securityService.getProjectSecurity(projectId);
    return { security };
  });

  // PUT /api/projects/:projectId/security — update security settings
  app.put('/:projectId/security', {
    preHandler: [authMiddleware, requireRole('admin')],
  }, async (request) => {
    const { projectId } = request.params as { projectId: string };
    const body = securitySchema.parse(request.body);
    const security = await securityService.updateProjectSecurity(projectId, body);
    return { security };
  });
}
