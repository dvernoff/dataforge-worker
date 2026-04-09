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

  app.get('/:projectId/plugins/features', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const DEFAULT_FEATURES = ['feature-cron', 'feature-backups', 'feature-analytics'];
    const rows = await app.db('plugin_instances')
      .where({ project_id: projectId })
      .select('plugin_id', 'is_enabled');
    const explicitlyEnabled = new Set<string>();
    const explicitlyDisabled = new Set<string>();
    for (const r of rows as { plugin_id: string; is_enabled: boolean }[]) {
      if (r.is_enabled) explicitlyEnabled.add(r.plugin_id);
      else explicitlyDisabled.add(r.plugin_id);
    }
    const features = new Set(explicitlyEnabled);
    for (const def of DEFAULT_FEATURES) {
      if (!explicitlyDisabled.has(def)) features.add(def);
    }
    return { features: [...features] };
  });

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
