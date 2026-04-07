import type { FastifyInstance } from 'fastify';
import { PluginManager } from './plugin.manager.js';
import { nodeAuthMiddleware } from '../../middleware/node-auth.middleware.js';
import { requireWorkerRole } from '../../middleware/worker-rbac.middleware.js';

export async function pluginRoutes(app: FastifyInstance) {
  const pluginManager = new PluginManager(app.db);
  await pluginManager.loadPlugins();

  (app as unknown as Record<string, unknown>).pluginManager = pluginManager;

  app.addHook('preHandler', nodeAuthMiddleware);
  app.addHook('preHandler', requireWorkerRole('editor'));

  app.get('/:projectId/plugins', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const plugins = await pluginManager.listPluginsWithStatus(projectId);
    return { plugins };
  });

  app.post('/:projectId/plugins/:pluginId/enable', async (request) => {
    const { projectId, pluginId } = request.params as { projectId: string; pluginId: string };
    const body = (request.body as Record<string, unknown>) ?? {};
    const settings = (body.settings as Record<string, unknown>) ?? {};
    const instance = await pluginManager.enablePlugin(projectId, pluginId, settings);
    return { instance };
  });

  app.post('/:projectId/plugins/:pluginId/disable', async (request) => {
    const { projectId, pluginId } = request.params as { projectId: string; pluginId: string };
    const instance = await pluginManager.disablePlugin(projectId, pluginId);
    return { instance };
  });

  app.get('/:projectId/plugins/:pluginId/settings', async (request) => {
    const { projectId, pluginId } = request.params as { projectId: string; pluginId: string };
    const result = await pluginManager.getPluginSettings(projectId, pluginId);
    return result;
  });

  app.put('/:projectId/plugins/:pluginId/settings', async (request) => {
    const { projectId, pluginId } = request.params as { projectId: string; pluginId: string };
    const body = (request.body as Record<string, unknown>) ?? {};
    const settings = (body.settings as Record<string, unknown>) ?? body;
    const instance = await pluginManager.updatePluginSettings(projectId, pluginId, settings);
    return { instance };
  });
}
