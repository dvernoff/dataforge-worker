import type { FastifyInstance } from 'fastify';
import { NodesService } from './nodes.service.js';
import { AuditService } from '../audit/audit.service.js';
import { z } from 'zod';

const heartbeatSchema = z.object({
  cpu_usage: z.number(),
  ram_usage: z.number(),
  disk_usage: z.number(),
  disk_total_gb: z.number().optional(),
  disk_free_gb: z.number().optional(),
  active_connections: z.number().optional(),
  request_count: z.number().optional(),
});

export async function heartbeatRoutes(app: FastifyInstance) {
  const nodesService = new NodesService(app.db);
  const auditService = new AuditService(app.db);

  // POST /internal/heartbeat
  app.post('/heartbeat', async (request, reply) => {
    const apiKey = request.headers['x-node-api-key'] as string | undefined;

    if (!apiKey) {
      return reply.status(401).send({ error: 'X-Node-Api-Key header required' });
    }

    const node = await nodesService.findByApiKey(apiKey);

    if (!node) {
      return reply.status(401).send({ error: 'Invalid API key' });
    }

    const body = heartbeatSchema.parse(request.body);
    const updated = await nodesService.processHeartbeat(node.id, body);

    return { status: 'ok', node: { id: updated.id, status: updated.status } };
  });

  // POST /internal/audit — Worker reports quota violations / events to CP audit log
  app.post('/audit', async (request, reply) => {
    const apiKey = request.headers['x-node-api-key'] as string | undefined;
    if (!apiKey) {
      return reply.status(401).send({ error: 'X-Node-Api-Key header required' });
    }
    // Validate API key belongs to a known node
    const node = await nodesService.findByApiKey(apiKey);
    if (!node) {
      return reply.status(401).send({ error: 'Invalid API key' });
    }

    const body = z.object({
      project_id: z.string().uuid().optional(),
      user_id: z.string().uuid().optional(),
      action: z.string().min(1).max(100),
      resource_type: z.string().max(50).optional(),
      resource_id: z.string().max(255).optional(),
      details: z.record(z.unknown()).optional(),
    }).parse(request.body);

    await auditService.log({
      project_id: body.project_id,
      user_id: body.user_id,
      action: body.action,
      resource_type: body.resource_type,
      resource_id: body.resource_id,
      details: body.details,
      ip_address: request.ip,
    });

    return { status: 'ok' };
  });

  // POST /internal/node-register — Worker registers with setup token and gets API key
  app.post('/node-register', async (request, reply) => {
    const body = z.object({
      setup_token: z.string().min(1),
      worker_url: z.string().url(),
    }).parse(request.body);

    try {
      const result = await nodesService.registerWithSetupToken(body.setup_token, body.worker_url);
      return { node_id: result.nodeId, api_key: result.apiKey };
    } catch (err) {
      const error = err as Error & { statusCode?: number };
      return reply.status(error.statusCode ?? 500).send({ error: error.message });
    }
  });
}
