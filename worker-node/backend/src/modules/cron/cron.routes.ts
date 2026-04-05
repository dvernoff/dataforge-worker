import type { FastifyInstance } from 'fastify';
import { CronService } from './cron.service.js';
import { nodeAuthMiddleware } from '../../middleware/node-auth.middleware.js';
import { requireWorkerRole } from '../../middleware/worker-rbac.middleware.js';
import { z } from 'zod';

export async function cronRoutes(app: FastifyInstance) {
  const cronService = new CronService(app.db);

  app.addHook('preHandler', nodeAuthMiddleware);
  app.addHook('preHandler', requireWorkerRole('admin'));

  // List cron jobs
  app.get('/:projectId/cron', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const jobs = await cronService.findAll(projectId);
    return { jobs };
  });

  // Create cron job
  app.post('/:projectId/cron', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const body = z.object({
      name: z.string().min(1).max(255),
      cron_expression: z.string().min(1).max(100),
      action_type: z.enum(['sql', 'api_call', 'webhook']),
      action_config: z.record(z.unknown()),
      is_active: z.boolean().optional(),
    }).parse(request.body);
    const job = await cronService.create(projectId, body);
    return { job };
  });

  // Get cron job with recent runs
  app.get('/:projectId/cron/:jobId', async (request) => {
    const { projectId, jobId } = request.params as { projectId: string; jobId: string };
    const job = await cronService.findById(jobId, projectId);
    return { job };
  });

  // Update cron job
  app.put('/:projectId/cron/:jobId', async (request) => {
    const { projectId, jobId } = request.params as { projectId: string; jobId: string };
    const body = z.object({
      name: z.string().min(1).max(255).optional(),
      cron_expression: z.string().min(1).max(100).optional(),
      action_type: z.enum(['sql', 'api_call', 'webhook']).optional(),
      action_config: z.record(z.unknown()).optional(),
      is_active: z.boolean().optional(),
    }).parse(request.body);
    const job = await cronService.update(jobId, projectId, body);
    return { job };
  });

  // Delete cron job
  app.delete('/:projectId/cron/:jobId', async (request, reply) => {
    const { projectId, jobId } = request.params as { projectId: string; jobId: string };
    await cronService.delete(jobId, projectId);
    return reply.status(204).send();
  });

  // Toggle active
  app.post('/:projectId/cron/:jobId/toggle', async (request) => {
    const { projectId, jobId } = request.params as { projectId: string; jobId: string };
    const job = await cronService.toggle(jobId, projectId);
    return { job };
  });

  // Manual trigger
  app.post('/:projectId/cron/:jobId/run', async (request) => {
    const { projectId, jobId } = request.params as { projectId: string; jobId: string };
    const result = await cronService.runNow(jobId, projectId);
    return { result };
  });

  // Run history
  app.get('/:projectId/cron/:jobId/runs', async (request) => {
    const { projectId, jobId } = request.params as { projectId: string; jobId: string };
    const query = request.query as Record<string, string>;
    const runs = await cronService.getRuns(jobId, projectId, Number(query.limit ?? 50));
    return { runs };
  });
}
