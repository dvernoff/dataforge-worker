import type { FastifyInstance } from 'fastify';
import { ErrorsService } from './errors.service.js';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { requireSuperadmin } from '../../middleware/rbac.middleware.js';
import { z } from 'zod';

const createErrorSchema = z.object({
  project_id: z.string().uuid().optional(),
  node_id: z.string().uuid().optional(),
  source: z.enum(['api', 'webhook', 'cron', 'node', 'system']),
  severity: z.enum(['error', 'warning', 'critical']),
  title: z.string().min(1).max(500),
  message: z.string().optional(),
  stack_trace: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export async function errorsRoutes(app: FastifyInstance) {
  const errorsService = new ErrorsService(app.db);

  // GET /api/errors — list (superadmin)
  app.get('/', {
    preHandler: [authMiddleware, requireSuperadmin()],
  }, async (request) => {
    const query = request.query as Record<string, string>;
    const result = await errorsService.list({
      source: query.source,
      severity: query.severity,
      status: query.status,
      page: query.page ? Number(query.page) : undefined,
      limit: query.limit ? Number(query.limit) : undefined,
    });
    return result;
  });

  // GET /api/errors/:id — detail
  app.get('/:id', {
    preHandler: [authMiddleware, requireSuperadmin()],
  }, async (request) => {
    const { id } = request.params as { id: string };
    const error = await errorsService.getById(id);
    return { error };
  });

  // POST /api/errors/:id/acknowledge
  app.post('/:id/acknowledge', {
    preHandler: [authMiddleware, requireSuperadmin()],
  }, async (request) => {
    const { id } = request.params as { id: string };
    const error = await errorsService.acknowledge(id, request.user.id);
    return { error };
  });

  // POST /api/errors/:id/resolve
  app.post('/:id/resolve', {
    preHandler: [authMiddleware, requireSuperadmin()],
  }, async (request) => {
    const { id } = request.params as { id: string };
    const error = await errorsService.resolve(id);
    return { error };
  });

  // POST /internal/errors — receive error from Worker (node auth)
  app.post('/internal', async (request, reply) => {
    const apiKey = request.headers['x-node-api-key'] as string | undefined;
    if (!apiKey) {
      return reply.status(401).send({ error: 'X-Node-Api-Key header required' });
    }

    // Verify node API key
    const node = await app.db('nodes').select('*').then(async (nodes) => {
      const bcrypt = await import('bcrypt');
      for (const n of nodes) {
        if (n.api_key_hash) {
          const match = await bcrypt.compare(apiKey, n.api_key_hash);
          if (match) return n;
        }
      }
      return null;
    });

    if (!node) {
      return reply.status(401).send({ error: 'Invalid API key' });
    }

    const body = createErrorSchema.parse(request.body);
    const error = await errorsService.create({
      ...body,
      node_id: node.id,
    });

    return { error };
  });
}
