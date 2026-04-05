import type { FastifyInstance } from 'fastify';
import { DashboardsService } from './dashboards.service.js';
import { nodeAuthMiddleware } from '../../middleware/node-auth.middleware.js';
import { requireWorkerRole } from '../../middleware/worker-rbac.middleware.js';
import { AppError } from '../../middleware/error-handler.js';
import { z } from 'zod';

function resolveProjectSchema(request: any): string {
  const schema = request.projectSchema;
  if (!schema) throw new AppError(400, 'Missing project schema header');
  return schema;
}

export async function dashboardsRoutes(app: FastifyInstance) {
  const dashboardsService = new DashboardsService(app.db);

  app.addHook('preHandler', nodeAuthMiddleware);
  app.addHook('preHandler', requireWorkerRole('editor'));

  // GET /:projectId/dashboards
  app.get('/:projectId/dashboards', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const dashboards = await dashboardsService.list(projectId);
    return { dashboards };
  });

  // POST /:projectId/dashboards
  app.post('/:projectId/dashboards', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const userId = request.userId;
    const body = z.object({
      name: z.string().min(1).max(255),
      description: z.string().optional(),
    }).parse(request.body);

    const dashboard = await dashboardsService.create({
      project_id: projectId,
      name: body.name,
      description: body.description,
      created_by: userId,
    });
    return { dashboard };
  });

  // GET /:projectId/dashboards/:dashboardId
  app.get('/:projectId/dashboards/:dashboardId', async (request) => {
    const { projectId, dashboardId } = request.params as { projectId: string; dashboardId: string };
    const dashboard = await dashboardsService.getById(dashboardId, projectId);
    if (!dashboard) throw new AppError(404, 'Dashboard not found');
    return { dashboard };
  });

  // PUT /:projectId/dashboards/:dashboardId
  app.put('/:projectId/dashboards/:dashboardId', async (request) => {
    const { projectId, dashboardId } = request.params as { projectId: string; dashboardId: string };
    const body = z.object({
      name: z.string().min(1).max(255).optional(),
      description: z.string().optional(),
      widgets: z.array(z.record(z.unknown())).optional(),
      layout: z.record(z.unknown()).optional(),
      is_public: z.boolean().optional(),
      public_slug: z.string().max(100).nullable().optional(),
    }).parse(request.body);

    const dashboard = await dashboardsService.update(dashboardId, projectId, body as any);
    if (!dashboard) throw new AppError(404, 'Dashboard not found');
    return { dashboard };
  });

  // DELETE /:projectId/dashboards/:dashboardId
  app.delete('/:projectId/dashboards/:dashboardId', async (request, reply) => {
    const { projectId, dashboardId } = request.params as { projectId: string; dashboardId: string };
    await dashboardsService.delete(dashboardId, projectId);
    return reply.status(204).send();
  });

  // POST /:projectId/dashboards/:dashboardId/execute
  app.post('/:projectId/dashboards/:dashboardId/execute', async (request) => {
    const { projectId, dashboardId } = request.params as { projectId: string; dashboardId: string };
    const dbSchema = resolveProjectSchema(request);
    // Verify dashboard belongs to project before executing
    const dashboard = await dashboardsService.getById(dashboardId, projectId);
    if (!dashboard) throw new AppError(404, 'Dashboard not found');
    const results = await dashboardsService.executeAllWidgets(dashboardId, dbSchema);
    return { results };
  });
}
