import type { FastifyInstance } from 'fastify';
import { NodesService } from './nodes.service.js';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { requireSuperadmin } from '../../middleware/rbac.middleware.js';
import { logAudit } from '../audit/audit.middleware.js';
import { z } from 'zod';

const createNodeSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().min(2).max(255).regex(/^[a-z0-9-]+$/),
  url: z.string().max(2000).optional(),
  region: z.string().max(100).optional(),
  is_local: z.boolean().optional(),
  max_projects: z.coerce.number().int().min(1).optional(),
});

const updateNodeSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  url: z.string().url().max(2000).optional(),
  region: z.string().max(100).optional(),
  status: z.enum(['online', 'offline', 'draining']).optional(),
  max_projects: z.coerce.number().int().min(1).optional(),
});

const heartbeatSchema = z.object({
  cpu_usage: z.number().min(0).max(100),
  ram_usage: z.number().min(0).max(100),
  disk_usage: z.number().min(0).max(100),
  active_projects: z.number().int().min(0).optional(),
});

export async function nodesRoutes(app: FastifyInstance) {
  const nodesService = new NodesService(app.db);

  // --- CRUD routes (require superadmin) ---

  // GET /api/nodes
  app.get('/', {
    preHandler: [authMiddleware, requireSuperadmin()],
  }, async () => {
    const nodes = await nodesService.findAll();
    return { nodes };
  });

  // POST /api/nodes
  app.post('/', {
    preHandler: [authMiddleware, requireSuperadmin()],
  }, async (request) => {
    const body = createNodeSchema.parse(request.body);
    const { node, setupToken, tokenExpires } = await nodesService.create(body);
    logAudit(request, 'node.create', 'node', node.id, { name: body.name, slug: body.slug });
    return { node, setup_token: setupToken, token_expires: tokenExpires.toISOString() };
  });

  // GET /api/nodes/:nodeId
  app.get('/:nodeId', {
    preHandler: [authMiddleware, requireSuperadmin()],
  }, async (request) => {
    const { nodeId } = request.params as { nodeId: string };
    const node = await nodesService.findById(nodeId);
    return { node };
  });

  // PUT /api/nodes/:nodeId
  app.put('/:nodeId', {
    preHandler: [authMiddleware, requireSuperadmin()],
  }, async (request) => {
    const { nodeId } = request.params as { nodeId: string };
    const body = updateNodeSchema.parse(request.body);
    const node = await nodesService.update(nodeId, body);
    return { node };
  });

  // POST /api/nodes/:nodeId/regenerate-token — regenerate setup token
  app.post('/:nodeId/regenerate-token', {
    preHandler: [authMiddleware, requireSuperadmin()],
  }, async (request) => {
    const { nodeId } = request.params as { nodeId: string };
    const node = await nodesService.findById(nodeId);
    const { setupToken, tokenExpires } = await nodesService.regenerateSystemToken(nodeId);
    logAudit(request, 'node.regenerate-token', 'node', nodeId, { name: node.name });
    return { setup_token: setupToken, token_expires: tokenExpires.toISOString() };
  });

  // DELETE /api/nodes/:nodeId (soft delete — sets status to offline)
  app.delete('/:nodeId', {
    preHandler: [authMiddleware, requireSuperadmin()],
  }, async (request, reply) => {
    const { nodeId } = request.params as { nodeId: string };
    const node = await nodesService.findById(nodeId);
    await nodesService.delete(nodeId);
    logAudit(request, 'node.delete', 'node', nodeId, { name: node.name, slug: node.slug });
    return reply.status(204).send();
  });


  // ─── Personal Nodes ─────────────────────────────────────

  // POST /api/nodes/personal — create personal node (generates setup_token)
  app.post('/personal', {
    preHandler: [authMiddleware],
  }, async (request) => {
    const body = z.object({
      name: z.string().min(1).max(255),
      region: z.string().max(100).optional(),
      update_mode: z.enum(['auto', 'manual']).optional(),
    }).parse(request.body);

    const { node, setupToken, tokenExpires } = await nodesService.createPersonalNode(
      request.user.id,
      body,
    );
    logAudit(request, 'node.personal.create', 'node', node.id, { name: body.name });
    return { node, setup_token: setupToken, token_expires: tokenExpires.toISOString() };
  });

  // GET /api/nodes/personal — list user's own nodes
  app.get('/personal', {
    preHandler: [authMiddleware],
  }, async (request) => {
    const nodes = await nodesService.findPersonalNodes(request.user.id);
    return { nodes };
  });

  // POST /api/nodes/personal/:id/regenerate-token — regenerate setup token for offline node
  app.post('/personal/:id/regenerate-token', {
    preHandler: [authMiddleware],
  }, async (request) => {
    const { id } = request.params as { id: string };
    const { setupToken, tokenExpires } = await nodesService.regenerateSetupToken(id, request.user.id);
    logAudit(request, 'node.personal.regenerate-token', 'node', id);
    return { setup_token: setupToken, token_expires: tokenExpires.toISOString() };
  });

  // DELETE /api/nodes/personal/:id — delete personal node
  app.delete('/personal/:id', {
    preHandler: [authMiddleware],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const node = await nodesService.findById(id);
    await nodesService.deletePersonalNode(id, request.user.id);
    logAudit(request, 'node.personal.delete', 'node', id, { name: node.name });
    return reply.status(204).send();
  });

  // GET /api/nodes/status — public (auth required, not superadmin) for node selection
  app.get('/status', {
    preHandler: [authMiddleware],
  }, async () => {
    const nodes = await nodesService.findAll();
    // Return only active/online nodes with metrics for project creation
    const activeNodes = nodes
      .filter((n: Record<string, unknown>) => n.status === 'online' || n.status === 'draining')
      .map((n: Record<string, unknown>) => ({
        id: n.id,
        name: n.name,
        slug: n.slug,
        url: n.url,
        region: n.region,
        status: n.status,
        cpu_usage: n.cpu_usage ?? 0,
        ram_usage: n.ram_usage ?? 0,
        disk_usage: n.disk_usage ?? 0,
        max_projects: n.max_projects,
        projects_count: n.projects_count ?? 0,
        last_heartbeat: n.last_heartbeat,
      }));
    return { nodes: activeNodes };
  });

}
