import type { FastifyInstance } from 'fastify';
import { FlowsService } from './flows.service.js';
import { nodeAuthMiddleware } from '../../middleware/node-auth.middleware.js';
import { requireWorkerRole } from '../../middleware/worker-rbac.middleware.js';
import { z } from 'zod';

export async function flowsRoutes(app: FastifyInstance) {
  const flowsService = new FlowsService(app.db);

  app.addHook('preHandler', nodeAuthMiddleware);
  app.addHook('preHandler', requireWorkerRole('admin'));

  app.get('/:projectId/flows', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const flows = await flowsService.findAll(projectId);
    return { flows };
  });

  app.post('/:projectId/flows', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const body = z.object({
      name: z.string().min(1).max(255),
      description: z.string().optional(),
      trigger_type: z.enum(['manual', 'data_change', 'webhook', 'cron', 'api_call']),
      trigger_config: z.record(z.unknown()).optional(),
      nodes: z.array(z.object({
        id: z.string(),
        type: z.string(),
        config: z.record(z.unknown()),
        next: z.string().nullable().optional(),
        trueBranch: z.string().nullable().optional(),
        falseBranch: z.string().nullable().optional(),
      })).optional(),
      edges: z.array(z.record(z.unknown())).optional(),
      is_active: z.boolean().optional(),
    }).parse(request.body);
    const flow = await flowsService.create(projectId, body);
    return { flow };
  });

  app.get('/:projectId/flows/:flowId', async (request) => {
    const { projectId, flowId } = request.params as { projectId: string; flowId: string };
    const flow = await flowsService.findById(flowId, projectId);
    const runs = await flowsService.getRuns(flowId, projectId, 20);
    return { flow, runs };
  });

  app.put('/:projectId/flows/:flowId', async (request) => {
    const { projectId, flowId } = request.params as { projectId: string; flowId: string };
    const body = request.body as Record<string, unknown>;
    const flow = await flowsService.update(flowId, projectId, body);
    return { flow };
  });

  app.delete('/:projectId/flows/:flowId', async (request, reply) => {
    const { projectId, flowId } = request.params as { projectId: string; flowId: string };
    await flowsService.delete(flowId, projectId);
    return reply.status(204).send();
  });

  app.post('/:projectId/flows/:flowId/run', async (request) => {
    const { projectId, flowId } = request.params as { projectId: string; flowId: string };
    const triggerData = request.body ?? {};
    const result = await flowsService.executeFlow(flowId, projectId, triggerData);
    return { result };
  });

  app.get('/:projectId/flows/:flowId/runs', async (request) => {
    const { projectId, flowId } = request.params as { projectId: string; flowId: string };
    const query = request.query as Record<string, string>;
    const runs = await flowsService.getRuns(flowId, projectId, Number(query.limit ?? 50));
    return { runs };
  });
}
