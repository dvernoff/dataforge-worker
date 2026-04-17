import type { FastifyInstance } from 'fastify';
import { SboxAuthPlugin } from './index.js';
import { PluginManager } from '../../plugin.manager.js';
import { nodeAuthMiddleware } from '../../../../middleware/node-auth.middleware.js';
import { requireWorkerRole } from '../../../../middleware/worker-rbac.middleware.js';

export async function sboxAuthManagementRoutes(app: FastifyInstance) {
  const sboxAuth = new SboxAuthPlugin(app.db);

  app.addHook('preHandler', nodeAuthMiddleware);
  app.addHook('preHandler', requireWorkerRole('viewer'));

  app.get('/:projectId/sbox-auth/sessions', async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const { config, schema, error } = await getPluginConfigById(app, projectId);
    if (error) return reply.status(error.status).send({ error: error.message });

    const sessions = await sboxAuth.getActiveSessions(schema!, config!);
    return { sessions };
  });

  app.get('/:projectId/sbox-auth/sessions/:steamId', async (request, reply) => {
    const { projectId, steamId } = request.params as { projectId: string; steamId: string };
    const { config, schema, error } = await getPluginConfigById(app, projectId);
    if (error) return reply.status(error.status).send({ error: error.message });

    const player = await sboxAuth.getPlayerProfile(schema!, config!, steamId);
    if (!player) {
      return reply.status(404).send({ error: 'Player not found' });
    }
    return { player };
  });

  app.post('/:projectId/sbox-auth/sessions/:steamId/revoke', async (request, reply) => {
    const { projectId, steamId } = request.params as { projectId: string; steamId: string };
    const { config, schema, error } = await getPluginConfigById(app, projectId);
    if (error) return reply.status(error.status).send({ error: error.message });

    const success = await sboxAuth.revokeSession(schema!, config!, steamId);
    return { success };
  });

  app.post('/:projectId/sbox-auth/sessions/revoke-all', async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const { config, schema, error } = await getPluginConfigById(app, projectId);
    if (error) return reply.status(error.status).send({ error: error.message });

    const revoked = await sboxAuth.revokeAllSessions(schema!, config!);
    return { revoked };
  });

  app.get('/:projectId/sbox-auth/stats', async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const { config, schema, error } = await getPluginConfigById(app, projectId);
    if (error) return reply.status(error.status).send({ error: error.message });

    const stats = await sboxAuth.getStats(schema!, config!);
    return stats;
  });

  app.post('/:projectId/sbox-auth/cleanup', async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const { config, schema, error } = await getPluginConfigById(app, projectId);
    if (error) return reply.status(error.status).send({ error: error.message });

    const cleaned = await sboxAuth.cleanExpiredSessions(schema!, config!);
    return { cleaned };
  });
}

export async function sboxAuthRoutes(app: FastifyInstance) {
  const sboxAuth = new SboxAuthPlugin(app.db);

  app.post('/:slug/sbox_login', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const body = request.body as { token: string; extra?: Record<string, unknown> };

    const project = await resolveProject(app, slug);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const { config, error } = await getPluginConfig(app, project.id);
    if (error) return reply.status(error.status).send({ error: error.message });

    try {
      const result = await sboxAuth.handleLogin(project.db_schema, config!, body);
      return result;
    } catch (err) {
      const statusCode = (err as Record<string, unknown>).statusCode as number ?? 500;
      return reply.status(statusCode).send({
        error: err instanceof Error ? err.message : 'Login failed',
      });
    }
  });

  app.post('/:slug/sbox_session', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const body = request.body as { session_key: string };

    const project = await resolveProject(app, slug);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const { config, error } = await getPluginConfig(app, project.id);
    if (error) return reply.status(error.status).send({ error: error.message });

    try {
      const player = await sboxAuth.handleSessionCheck(project.db_schema, config!, body.session_key);
      if (!player) {
        return { valid: false };
      }
      return { valid: true, player };
    } catch (err) {
      const statusCode = (err as Record<string, unknown>).statusCode as number ?? 500;
      return reply.status(statusCode).send({
        error: err instanceof Error ? err.message : 'Session check failed',
      });
    }
  });

  app.post('/:slug/sbox_logout', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const body = request.body as { session_key: string };

    const project = await resolveProject(app, slug);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const { config, error } = await getPluginConfig(app, project.id);
    if (error) return reply.status(error.status).send({ error: error.message });

    try {
      const success = await sboxAuth.handleLogout(project.db_schema, config!, body.session_key);
      return { success };
    } catch (err) {
      const statusCode = (err as Record<string, unknown>).statusCode as number ?? 500;
      return reply.status(statusCode).send({
        error: err instanceof Error ? err.message : 'Logout failed',
      });
    }
  });
}

async function resolveProject(
  app: FastifyInstance,
  slug: string
): Promise<{ id: string; db_schema: string } | null> {
  try {
    const project = await app.db('_dataforge_projects')
      .where({ slug })
      .select('id', 'db_schema')
      .first();
    return project ?? null;
  } catch {
    try {
      const project = await app.db('projects')
        .where({ slug })
        .select('id', 'db_schema')
        .first();
      return project ?? null;
    } catch {
      return null;
    }
  }
}

async function getPluginConfig(app: FastifyInstance, projectId: string) {
  const pluginManager = (app as unknown as Record<string, unknown>).pluginManager as PluginManager;
  if (!pluginManager) {
    return { config: null, error: { status: 503, message: 'Plugin system not initialized' } };
  }

  const instance = await pluginManager.getEnabledPluginInstance(projectId, 'sbox-auth');
  if (!instance) {
    return { config: null, error: { status: 404, message: 'S&box Auth plugin is not enabled for this project' } };
  }

  const config = typeof instance.settings === 'string'
    ? JSON.parse(instance.settings)
    : instance.settings;

  return { config, error: null };
}

async function getPluginConfigById(app: FastifyInstance, projectId: string) {
  const project = await app.db('projects').where({ id: projectId }).select('id', 'db_schema').first();
  if (!project) {
    return { config: null, schema: null, error: { status: 404, message: 'Project not found' } };
  }

  const { config, error } = await getPluginConfig(app, projectId);
  if (error) return { config: null, schema: null, error };

  return { config, schema: project.db_schema, error: null };
}
