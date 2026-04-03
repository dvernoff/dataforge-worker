import type { FastifyInstance } from 'fastify';
import { FlowsService } from './flows.service.js';
import { nodeAuthMiddleware } from '../../middleware/node-auth.middleware.js';
import { z } from 'zod';

export async function flowsRoutes(app: FastifyInstance) {
  const flowsService = new FlowsService(app.db);

  app.addHook('preHandler', nodeAuthMiddleware);

  // List flows
  app.get('/:projectId/flows', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const flows = await flowsService.findAll(projectId);
    return { flows };
  });

  // Create flow
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

  // Get flow detail
  app.get('/:projectId/flows/:flowId', async (request) => {
    const { projectId, flowId } = request.params as { projectId: string; flowId: string };
    const flow = await flowsService.findById(flowId, projectId);
    const runs = await flowsService.getRuns(flowId, 20);
    return { flow, runs };
  });

  // Update flow
  app.put('/:projectId/flows/:flowId', async (request) => {
    const { projectId, flowId } = request.params as { projectId: string; flowId: string };
    const body = request.body as Record<string, unknown>;
    const flow = await flowsService.update(flowId, projectId, body);
    return { flow };
  });

  // Delete flow
  app.delete('/:projectId/flows/:flowId', async (request, reply) => {
    const { projectId, flowId } = request.params as { projectId: string; flowId: string };
    await flowsService.delete(flowId, projectId);
    return reply.status(204).send();
  });

  // Manual trigger
  app.post('/:projectId/flows/:flowId/run', async (request) => {
    const { projectId, flowId } = request.params as { projectId: string; flowId: string };
    const triggerData = request.body ?? {};
    const result = await flowsService.executeFlow(flowId, projectId, triggerData);
    return { result };
  });

  // Run history
  app.get('/:projectId/flows/:flowId/runs', async (request) => {
    const { projectId, flowId } = request.params as { projectId: string; flowId: string };
    const query = request.query as Record<string, string>;
    const runs = await flowsService.getRuns(flowId, Number(query.limit ?? 50));
    return { runs };
  });
}
