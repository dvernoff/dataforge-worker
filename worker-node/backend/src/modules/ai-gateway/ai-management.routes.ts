import type { FastifyInstance } from 'fastify';
import { nodeAuthMiddleware } from '../../middleware/node-auth.middleware.js';
import { requireWorkerRole } from '../../middleware/worker-rbac.middleware.js';
import { AiGatewayService } from './ai-gateway.service.js';
import { isModuleEnabled } from '../../utils/module-check.js';

export async function aiManagementRoutes(app: FastifyInstance) {
  app.addHook('preHandler', nodeAuthMiddleware);
  const service = new AiGatewayService(app.db);

  app.get('/:projectId/ai-gateway/status', { preHandler: requireWorkerRole('viewer') }, async (request) => {
    const { projectId } = request.params as { projectId: string };
    const restEnabled = await isModuleEnabled(app.db, projectId, 'ai-rest-gateway');
    const mcpEnabled = await isModuleEnabled(app.db, projectId, 'ai-mcp-server');
    const studioEnabled = await isModuleEnabled(app.db, projectId, 'ai-studio');
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const recentCount = await app.db('ai_gateway_logs')
      .where({ project_id: projectId })
      .where('created_at', '>', cutoff)
      .count('* as count')
      .first()
      .catch(() => ({ count: 0 }));

    return {
      rest_gateway: { enabled: restEnabled },
      mcp_server: { enabled: mcpEnabled },
      ai_studio: { enabled: studioEnabled },
      last_24h_calls: Number((recentCount as Record<string, unknown>)?.count ?? 0),
    };
  });

  app.get('/:projectId/ai-gateway/activity', { preHandler: requireWorkerRole('viewer') }, async (request) => {
    const { projectId } = request.params as { projectId: string };
    const { limit = '50', offset = '0' } = request.query as { limit?: string; offset?: string };
    const rows = await service.getActivity(projectId, Number(limit), Number(offset));
    return { activity: rows };
  });

  app.get('/:projectId/ai-gateway/stats', { preHandler: requireWorkerRole('viewer') }, async (request) => {
    const { projectId } = request.params as { projectId: string };
    return service.getStats(projectId);
  });
}
