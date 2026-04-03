import type { FastifyInstance } from 'fastify';
import { TokensService } from './tokens.service.js';
import { ProxyService } from '../proxy/proxy.service.js';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { requireRole } from '../../middleware/rbac.middleware.js';
import { logAudit } from '../audit/audit.middleware.js';
import { z } from 'zod';

async function syncTokenToWorker(
  proxyService: ProxyService,
  projectId: string,
  action: 'create' | 'revoke',
  tokenHash: string,
  log: FastifyInstance['log'],
  extra?: { scopes?: string[]; allowed_ips?: string[] | null; expires_at?: string | null },
) {
  try {
    const worker = await proxyService.getWorkerForProject(projectId);
    await fetch(`${worker.url.replace(/\/$/, '')}/internal/tokens/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Node-Api-Key': worker.apiKey,
      },
      body: JSON.stringify({
        action,
        token_hash: tokenHash,
        project_id: projectId,
        ...(action === 'create' ? {
          scopes: extra?.scopes ?? ['read'],
          allowed_ips: extra?.allowed_ips ?? [],
          expires_at: extra?.expires_at ?? null,
        } : {}),
      }),
    });
  } catch (err) {
    // Log but don't fail the request — token is created in CP DB regardless
    log.error(err, `Failed to sync token to worker for project ${projectId}`);
  }
}

export async function tokensRoutes(app: FastifyInstance) {
  const tokensService = new TokensService(app.db);
  const proxyService = new ProxyService(app.db, app.redis);

  app.addHook('preHandler', authMiddleware);

  app.get('/:projectId/tokens', { preHandler: [requireRole('viewer')] }, async (request) => {
    const { projectId } = request.params as { projectId: string };
    const tokens = await tokensService.findAll(projectId);
    return { tokens };
  });

  app.post('/:projectId/tokens', { preHandler: [requireRole('admin')] }, async (request) => {
    const { projectId } = request.params as { projectId: string };
    const body = z.object({
      name: z.string().min(1).max(255),
      scopes: z.array(z.enum(['read', 'write', 'delete', 'admin'])).min(1),
      allowed_ips: z.array(z.string()).optional(),
      expires_at: z.string().datetime().optional(),
    }).parse(request.body);

    const token = await tokensService.create(projectId, request.user.id, body);
    logAudit(request, 'token.create', 'api_token', token.id, { name: body.name });

    // Sync the SHA256 hash to the worker node's Redis cache
    await syncTokenToWorker(proxyService, projectId, 'create', token.token_hash, app.log, {
      scopes: body.scopes,
      allowed_ips: body.allowed_ips,
      expires_at: body.expires_at,
    });

    return { token };
  });

  app.post('/:projectId/tokens/:tokenId/revoke', { preHandler: [requireRole('admin')] }, async (request) => {
    const { projectId, tokenId } = request.params as { projectId: string; tokenId: string };
    const token = await tokensService.revoke(tokenId, projectId);
    logAudit(request, 'token.revoke', 'api_token', tokenId);

    // Remove the token from worker's Redis cache
    await syncTokenToWorker(proxyService, projectId, 'revoke', token.token_hash, app.log);

    return { token };
  });

  app.delete('/:projectId/tokens/:tokenId', { preHandler: [requireRole('admin')] }, async (request, reply) => {
    const { projectId, tokenId } = request.params as { projectId: string; tokenId: string };

    // Fetch the token hash before deleting so we can revoke it on the worker
    const tokenRecord = await app.db('api_tokens')
      .where({ id: tokenId, project_id: projectId })
      .select('token_hash')
      .first();

    await tokensService.delete(tokenId, projectId);

    if (tokenRecord) {
      await syncTokenToWorker(proxyService, projectId, 'revoke', tokenRecord.token_hash, app.log);
    }

    return reply.status(204).send();
  });
}
