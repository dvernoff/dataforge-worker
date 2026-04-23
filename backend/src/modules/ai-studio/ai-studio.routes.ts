import type { FastifyInstance } from 'fastify';
import { nodeAuthMiddleware } from '../../middleware/node-auth.middleware.js';
import { requireWorkerRole } from '../../middleware/worker-rbac.middleware.js';
import { AiStudioService } from './ai-studio.service.js';
import { isModuleEnabled, moduleDisabledError } from '../../utils/module-check.js';

const VALID_PROVIDERS = ['openai', 'deepseek', 'claude'];

export async function aiStudioRoutes(app: FastifyInstance) {
  app.addHook('preHandler', nodeAuthMiddleware);
  const service = new AiStudioService(app.db);
  const migrated = new Set<string>();

  async function ensureMigrations(schema: string) {
    if (migrated.has(schema)) return;
    migrated.add(schema);
    try { await app.db.raw(`ALTER TABLE "${schema}".ai_studio_endpoints ADD COLUMN IF NOT EXISTS api_key TEXT`); } catch {}
    try { await app.db.raw(`ALTER TABLE "${schema}".ai_studio_endpoints ADD COLUMN IF NOT EXISTS max_context_messages INTEGER DEFAULT 50`); } catch {}
    try { await app.db.raw(`ALTER TABLE "${schema}".ai_studio_endpoints ADD COLUMN IF NOT EXISTS max_tokens_per_session INTEGER DEFAULT 0`); } catch {}
    try { await app.db.raw(`ALTER TABLE "${schema}".ai_studio_contexts ADD COLUMN IF NOT EXISTS tokens_used INTEGER DEFAULT 0`); } catch {}
  }

  async function checkEnabled(request: { projectId?: string }, reply: { status: (n: number) => { send: (b: unknown) => unknown } }) {
    const projectId = (request as Record<string, string>).projectId;
    const enabled = await isModuleEnabled(app.db, projectId, 'ai-studio');
    if (!enabled) { reply.status(404).send(moduleDisabledError('AI Studio')); return false; }
    const schema = (request as Record<string, string>).projectSchema;
    if (schema) await ensureMigrations(schema);
    return true;
  }

  app.get('/:projectId/ai-studio/endpoints', { preHandler: requireWorkerRole('viewer') }, async (request, reply) => {
    if (!await checkEnabled(request, reply)) return;
    const schema = (request as Record<string, string>).projectSchema;
    return { endpoints: await service.listEndpoints(schema) };
  });

  app.post('/:projectId/ai-studio/endpoints', { preHandler: requireWorkerRole('editor') }, async (request, reply) => {
    if (!await checkEnabled(request, reply)) return;
    const schema = (request as Record<string, string>).projectSchema;
    const body = request.body as Record<string, unknown>;
    if (!body.name) return reply.status(400).send({ error: 'Missing "name"' });
    if (!body.provider || !VALID_PROVIDERS.includes(body.provider as string)) return reply.status(400).send({ error: `Invalid "provider". Must be: ${VALID_PROVIDERS.join(', ')}` });
    if (!body.model) return reply.status(400).send({ error: 'Missing "model"' });
    return { endpoint: await service.createEndpoint(schema, body as Parameters<AiStudioService['createEndpoint']>[1]) };
  });

  app.get('/:projectId/ai-studio/endpoints/:id', { preHandler: requireWorkerRole('viewer') }, async (request, reply) => {
    if (!await checkEnabled(request, reply)) return;
    const schema = (request as Record<string, string>).projectSchema;
    const { id } = request.params as { id: string };
    const ep = await service.getEndpoint(schema, id);
    if (!ep) return reply.status(404).send({ error: 'Endpoint not found' });
    return { endpoint: ep };
  });

  app.put('/:projectId/ai-studio/endpoints/:id', { preHandler: requireWorkerRole('editor') }, async (request, reply) => {
    if (!await checkEnabled(request, reply)) return;
    const schema = (request as Record<string, string>).projectSchema;
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    if (body.provider && !VALID_PROVIDERS.includes(body.provider as string)) return reply.status(400).send({ error: `Invalid "provider". Must be: ${VALID_PROVIDERS.join(', ')}` });
    return { endpoint: await service.updateEndpoint(schema, id, body) };
  });

  app.delete('/:projectId/ai-studio/endpoints/:id', { preHandler: requireWorkerRole('editor') }, async (request, reply) => {
    if (!await checkEnabled(request, reply)) return;
    const schema = (request as Record<string, string>).projectSchema;
    const { id } = request.params as { id: string };
    await service.deleteEndpoint(schema, id);
    return { success: true };
  });

  app.post('/:projectId/ai-studio/endpoints/:id/test', { preHandler: requireWorkerRole('editor') }, async (request, reply) => {
    if (!await checkEnabled(request, reply)) return;
    const schema = (request as Record<string, string>).projectSchema;
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;

    const ep = await service.getEndpoint(schema, id);
    if (!ep) return reply.status(404).send({ error: 'Endpoint not found' });

    const projectId = (request as Record<string, string>).projectId;
    const pluginSettings = await getPluginSettings(app.db, projectId);

    try {
      const result = await service.callEndpoint(schema, ep.slug, body as Parameters<AiStudioService['callEndpoint']>[2], pluginSettings);
      return { success: true, ...result };
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }
  });

  app.get('/:projectId/ai-studio/logs', { preHandler: requireWorkerRole('viewer') }, async (request, reply) => {
    if (!await checkEnabled(request, reply)) return;
    const schema = (request as Record<string, string>).projectSchema;
    const { limit, offset, endpointId } = request.query as { limit?: string; offset?: string; endpointId?: string };
    return { logs: await service.getLogs(schema, { limit: Number(limit ?? 50), offset: Number(offset ?? 0), endpointId }) };
  });

  app.get('/:projectId/ai-studio/stats', { preHandler: requireWorkerRole('viewer') }, async (request, reply) => {
    if (!await checkEnabled(request, reply)) return;
    const schema = (request as Record<string, string>).projectSchema;
    return service.getStats(schema);
  });
}

async function getPluginSettings(db: Knex, projectId: string): Promise<Record<string, unknown>> {
  const row = await db('plugin_instances').where({ project_id: projectId, plugin_id: 'ai-studio' }).first();
  if (!row) return {};
  try { return typeof row.settings === 'string' ? JSON.parse(row.settings) : (row.settings ?? {}); } catch { return {}; }
}
