import type { FastifyInstance } from 'fastify';
import type { Knex } from 'knex';
import { authenticateAiRequest } from '../ai-gateway/ai-auth.middleware.js';
import { AiStudioService } from './ai-studio.service.js';

async function getPluginSettings(db: Knex, projectId: string): Promise<Record<string, unknown>> {
  const row = await db('plugin_instances').where({ project_id: projectId, plugin_id: 'ai-studio' }).first();
  if (!row) return {};
  try { return typeof row.settings === 'string' ? JSON.parse(row.settings) : (row.settings ?? {}); } catch { return {}; }
}

export async function aiStudioPublicRoutes(app: FastifyInstance) {
  const service = new AiStudioService(app.db);

  async function withAuth(request: Parameters<typeof authenticateAiRequest>[0], reply: Parameters<typeof authenticateAiRequest>[1]) {
    return authenticateAiRequest(request, reply, app.db, app.redis, 'ai-studio');
  }

  app.post('/api/v1/:projectSlug/ai-studio/:slug', async (request, reply) => {
    const auth = await withAuth(request, reply);
    if (!auth) return;
    const { slug } = request.params as { slug: string };
    const body = request.body as Record<string, unknown>;
    const settings = await getPluginSettings(app.db, auth.project.id);

    try {
      return await service.callEndpoint(auth.project.db_schema, slug, body, settings);
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }
  });

  app.post('/api/v1/:projectSlug/ai-studio/:slug/ctx/:sessionId', async (request, reply) => {
    const auth = await withAuth(request, reply);
    if (!auth) return;
    const { slug, sessionId } = request.params as { slug: string; sessionId: string };
    const body = request.body as Record<string, unknown>;
    const settings = await getPluginSettings(app.db, auth.project.id);

    try {
      return await service.callEndpoint(auth.project.db_schema, slug, { ...body, session_id: sessionId } as Parameters<AiStudioService['callEndpoint']>[2], settings);
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }
  });

  app.get('/api/v1/:projectSlug/ai-studio/:slug/ctx/:sessionId', async (request, reply) => {
    const auth = await withAuth(request, reply);
    if (!auth) return;
    const { slug, sessionId } = request.params as { slug: string; sessionId: string };
    const endpoint = await service.getEndpointBySlug(auth.project.db_schema, slug);
    if (!endpoint) return reply.status(404).send({ error: 'Endpoint not found' });

    const ctx = await service.getContext(auth.project.db_schema, endpoint.id, sessionId);
    return { messages: ctx?.messages ?? [], session_id: sessionId };
  });

  app.delete('/api/v1/:projectSlug/ai-studio/:slug/ctx/:sessionId', async (request, reply) => {
    const auth = await withAuth(request, reply);
    if (!auth) return;
    const { slug, sessionId } = request.params as { slug: string; sessionId: string };
    const endpoint = await service.getEndpointBySlug(auth.project.db_schema, slug);
    if (!endpoint) return reply.status(404).send({ error: 'Endpoint not found' });

    await service.deleteContext(auth.project.db_schema, endpoint.id, sessionId);
    return { success: true };
  });
}
