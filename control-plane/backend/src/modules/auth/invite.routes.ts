import type { FastifyInstance } from 'fastify';
import { InviteService } from './invite.service.js';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { requireRole } from '../../middleware/rbac.middleware.js';
import { logAudit } from '../audit/audit.middleware.js';
import { z } from 'zod';

export async function inviteRoutes(app: FastifyInstance) {
  const inviteService = new InviteService(app.db);

  app.addHook('preHandler', authMiddleware);

  // GET /api/projects/:projectId/invites
  app.get('/:projectId/invites', {
    preHandler: [requireRole('admin')],
  }, async (request) => {
    const { projectId } = request.params as { projectId: string };
    const invites = await inviteService.findByProject(projectId);
    return { invites };
  });

  // POST /api/projects/:projectId/invites
  app.post('/:projectId/invites', {
    preHandler: [requireRole('admin')],
  }, async (request) => {
    const { projectId } = request.params as { projectId: string };
    const body = z.object({
      role: z.enum(['admin', 'editor', 'viewer']),
      maxUses: z.number().int().min(0).default(1),
      expiresAt: z.string().datetime().optional(),
    }).parse(request.body);

    const invite = await inviteService.create({
      ...body,
      projectId,
      createdBy: request.user.id,
    });

    logAudit(request, 'invite.create', 'invite', invite.id, { role: body.role });
    return { invite };
  });

  // DELETE /api/projects/:projectId/invites/:inviteId
  app.delete('/:projectId/invites/:inviteId', {
    preHandler: [requireRole('admin')],
  }, async (request, reply) => {
    const { projectId, inviteId } = request.params as { projectId: string; inviteId: string };
    await inviteService.deactivate(inviteId, projectId);
    logAudit(request, 'invite.delete', 'invite', inviteId);
    return reply.status(204).send();
  });
}
