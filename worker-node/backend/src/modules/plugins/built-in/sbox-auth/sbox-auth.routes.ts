import type { FastifyInstance } from 'fastify';
import { SboxAuthPlugin } from './index.js';
import { PluginManager } from '../../plugin.manager.js';

export async function sboxAuthRoutes(app: FastifyInstance) {
  const sboxAuth = new SboxAuthPlugin(app.db);

  app.post('/:slug/sbox_login', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const body = request.body as { token: string; extra?: Record<string, unknown> };

    const project = await resolveProject(app, slug);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const pluginManager = (app as unknown as Record<string, unknown>).pluginManager as PluginManager;
    if (!pluginManager) {
      return reply.status(503).send({ error: 'Plugin system not initialized' });
    }

    const instance = await pluginManager.getEnabledPluginInstance(project.id, 'sbox-auth');
    if (!instance) {
      return reply.status(404).send({ error: 'S&box Auth plugin is not enabled for this project' });
    }

    const config = typeof instance.settings === 'string'
      ? JSON.parse(instance.settings)
      : instance.settings;

    try {
      const result = await sboxAuth.handleLogin(
        project.db_schema,
        config,
        body
      );
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

    const pluginManager = (app as unknown as Record<string, unknown>).pluginManager as PluginManager;
    if (!pluginManager) {
      return reply.status(503).send({ error: 'Plugin system not initialized' });
    }

    const instance = await pluginManager.getEnabledPluginInstance(project.id, 'sbox-auth');
    if (!instance) {
      return reply.status(404).send({ error: 'S&box Auth plugin is not enabled for this project' });
    }

    const config = typeof instance.settings === 'string'
      ? JSON.parse(instance.settings)
      : instance.settings;

    try {
      const player = await sboxAuth.handleSessionCheck(
        project.db_schema,
        config,
        body.session_key
      );

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

    const pluginManager = (app as unknown as Record<string, unknown>).pluginManager as PluginManager;
    if (!pluginManager) {
      return reply.status(503).send({ error: 'Plugin system not initialized' });
    }

    const instance = await pluginManager.getEnabledPluginInstance(project.id, 'sbox-auth');
    if (!instance) {
      return reply.status(404).send({ error: 'S&box Auth plugin is not enabled for this project' });
    }

    const config = typeof instance.settings === 'string'
      ? JSON.parse(instance.settings)
      : instance.settings;

    try {
      const success = await sboxAuth.handleLogout(
        project.db_schema,
        config,
        body.session_key
      );
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
