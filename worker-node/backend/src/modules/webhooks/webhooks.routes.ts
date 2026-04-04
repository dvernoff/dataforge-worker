import type { FastifyInstance } from 'fastify';
import { WebhooksService } from './webhooks.service.js';
import { nodeAuthMiddleware } from '../../middleware/node-auth.middleware.js';
import { requireWorkerRole } from '../../middleware/worker-rbac.middleware.js';
import { z } from 'zod';

export async function webhookRoutes(app: FastifyInstance) {
  const webhooksService = new WebhooksService(app.db);

  app.addHook('preHandler', nodeAuthMiddleware);
  app.addHook('preHandler', requireWorkerRole('viewer'));

  app.get('/:projectId/webhooks', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const webhooks = await webhooksService.findAll(projectId);
    return { webhooks };
  });

  app.get('/:projectId/webhooks/:webhookId', async (request) => {
    const { projectId, webhookId } = request.params as { projectId: string; webhookId: string };
    const webhook = await webhooksService.findById(webhookId, projectId);
    return { webhook };
  });

  app.post('/:projectId/webhooks', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const userId = request.userId;
    const body = z.object({
      name: z.string().max(255).optional(),
      table_name: z.string().min(1),
      events: z.array(z.enum(['INSERT', 'UPDATE', 'DELETE'])).min(1),
      url: z.string().url().max(2000),
      method: z.enum(['POST', 'PUT', 'PATCH']).optional(),
      headers: z.record(z.string()).optional(),
      payload_template: z.record(z.unknown()).optional(),
      secret: z.string().max(255).optional(),
      retry_count: z.number().int().min(0).max(10).optional(),
      is_active: z.boolean().optional(),
    }).parse(request.body);
    const webhook = await webhooksService.create(projectId, userId, body);
    return { webhook };
  });

  app.put('/:projectId/webhooks/:webhookId', async (request) => {
    const { projectId, webhookId } = request.params as { projectId: string; webhookId: string };
    const body = request.body as Record<string, unknown>;
    const webhook = await webhooksService.update(webhookId, projectId, body);
    return { webhook };
  });

  app.delete('/:projectId/webhooks/:webhookId', async (request, reply) => {
    const { projectId, webhookId } = request.params as { projectId: string; webhookId: string };
    await webhooksService.delete(webhookId, projectId);
    return reply.status(204).send();
  });

  app.get('/:projectId/webhooks/:webhookId/logs', async (request) => {
    const { webhookId } = request.params as { webhookId: string };
    const query = request.query as Record<string, string>;
    const logs = await webhooksService.getLogs(webhookId, Number(query.limit ?? 50));
    return { logs };
  });
}
