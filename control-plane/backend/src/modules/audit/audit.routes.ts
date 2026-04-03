import type { FastifyInstance } from 'fastify';
import { AuditService } from './audit.service.js';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { requireRole, requireSuperadmin } from '../../middleware/rbac.middleware.js';

export async function auditRoutes(app: FastifyInstance) {
  const auditService = new AuditService(app.db);

  app.addHook('preHandler', authMiddleware);

  // GET /api/projects/:projectId/audit
  app.get('/:projectId/audit', {
    preHandler: [requireRole('viewer')],
  }, async (request) => {
    const { projectId } = request.params as { projectId: string };
    const query = request.query as Record<string, string>;
    return auditService.findByProject(projectId, {
      page: Number(query.page ?? 1),
      limit: Number(query.limit ?? 50),
      action: query.action,
      userId: query.userId,
      search: query.search,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
    });
  });

  // GET /api/system/audit — superadmin global audit
  app.get('/system/audit', {
    preHandler: [requireSuperadmin()],
  }, async (request) => {
    const query = request.query as Record<string, string>;
    return auditService.findAll({
      page: Number(query.page ?? 1),
      limit: Number(query.limit ?? 50),
      projectId: query.projectId,
      action: query.action,
      userId: query.userId,
    });
  });
}
