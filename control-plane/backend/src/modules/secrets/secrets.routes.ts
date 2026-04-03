import type { FastifyInstance } from 'fastify';
import { SecretsService } from './secrets.service.js';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { requireRole } from '../../middleware/rbac.middleware.js';
import { AppError } from '../../middleware/error-handler.js';
import { z } from 'zod';

export async function secretsRoutes(app: FastifyInstance) {
  const secretsService = new SecretsService(app.db);

  app.addHook('preHandler', authMiddleware);

  // GET /api/projects/:projectId/secrets — list (values masked)
  app.get('/:projectId/secrets', {
    preHandler: [requireRole('viewer')],
  }, async (request) => {
    const { projectId } = request.params as { projectId: string };
    const secrets = await secretsService.list(projectId);
    return { secrets };
  });

  // POST /api/projects/:projectId/secrets — create
  app.post('/:projectId/secrets', {
    preHandler: [requireRole('admin')],
  }, async (request) => {
    const { projectId } = request.params as { projectId: string };
    const body = z.object({
      key: z.string().min(1).max(255).regex(/^[A-Z][A-Z0-9_]*$/, 'Key must be uppercase with underscores'),
      value: z.string().min(1),
      description: z.string().max(1000).optional(),
    }).parse(request.body);

    const secret = await secretsService.create({
      project_id: projectId,
      key: body.key,
      value: body.value,
      description: body.description,
      created_by: request.user.id,
    });
    return { secret };
  });

  // GET /api/projects/:projectId/secrets/:secretId — get (masked unless ?reveal=true, admin only)
  app.get('/:projectId/secrets/:secretId', {
    preHandler: [requireRole('viewer')],
  }, async (request) => {
    const { projectId, secretId } = request.params as { projectId: string; secretId: string };
    const query = request.query as Record<string, string>;
    const reveal = query.reveal === 'true';

    // Only admins can reveal
    if (reveal) {
      const role = (request as unknown as Record<string, unknown>).projectRole as string;
      if (role !== 'admin' && role !== 'superadmin' && !request.user.is_superadmin) {
        throw new AppError(403, 'Only admins can reveal secret values');
      }
    }

    const secret = await secretsService.getById(projectId, secretId, reveal);
    if (!secret) {
      return { error: 'Secret not found' };
    }
    return { secret };
  });

  // PUT /api/projects/:projectId/secrets/:secretId — update
  app.put('/:projectId/secrets/:secretId', {
    preHandler: [requireRole('admin')],
  }, async (request) => {
    const { projectId, secretId } = request.params as { projectId: string; secretId: string };
    const body = z.object({
      value: z.string().min(1).optional(),
      description: z.string().max(1000).optional(),
    }).parse(request.body);

    const secret = await secretsService.update(projectId, secretId, body);
    return { secret };
  });

  // DELETE /api/projects/:projectId/secrets/:secretId — delete
  app.delete('/:projectId/secrets/:secretId', {
    preHandler: [requireRole('admin')],
  }, async (request, reply) => {
    const { projectId, secretId } = request.params as { projectId: string; secretId: string };
    await secretsService.delete(projectId, secretId);
    return reply.status(204).send();
  });
}
