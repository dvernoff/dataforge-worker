import type { FastifyInstance } from 'fastify';
import { BuilderService } from './builder.service.js';
import { Executor } from './executor.js';
import { CacheService } from './cache.service.js';
import { nodeAuthMiddleware } from '../../middleware/node-auth.middleware.js';
import { requireWorkerRole } from '../../middleware/worker-rbac.middleware.js';
import { AppError } from '../../middleware/error-handler.js';
import { z } from 'zod';

async function resolveProject(app: FastifyInstance, projectId: string) {
  const project = await app.db('projects').where({ id: projectId }).first();
  if (!project) throw new AppError(404, 'Project not found');
  return project;
}

export async function apiBuilderRoutes(app: FastifyInstance) {
  const builderService = new BuilderService(app.db);
  const executor = new Executor(app.db);
  const cacheService = new CacheService(app.redis);

  app.register(async (protectedRoutes) => {
    protectedRoutes.addHook('preHandler', nodeAuthMiddleware);
    protectedRoutes.addHook('preHandler', requireWorkerRole('viewer'));

    protectedRoutes.get('/:projectId/endpoints', async (request) => {
      const { projectId } = request.params as { projectId: string };
      const endpoints = await builderService.findAll(projectId);
      return { endpoints };
    });

    protectedRoutes.get('/:projectId/endpoints/:endpointId', async (request) => {
      const { projectId, endpointId } = request.params as { projectId: string; endpointId: string };
      const endpoint = await builderService.findById(endpointId, projectId);
      return { endpoint };
    });

    protectedRoutes.post('/:projectId/endpoints', async (request) => {
      const { projectId } = request.params as { projectId: string };
      const userId = request.userId;
      const body = z.object({
        method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
        path: z.string().min(1).max(500),
        description: z.string().optional(),
        tags: z.array(z.string()).optional(),
        source_type: z.enum(['table', 'custom_sql', 'composite']),
        source_config: z.record(z.unknown()),
        validation_schema: z.record(z.unknown()).optional(),
        response_config: z.record(z.unknown()).optional(),
        cache_enabled: z.boolean().optional(),
        cache_ttl: z.number().int().min(1).optional(),
        cache_key_template: z.string().optional(),
        rate_limit: z.record(z.unknown()).optional(),
        auth_type: z.enum(['public', 'api_token']).optional(),
        is_active: z.boolean().optional(),
      }).parse(request.body);

      const endpoint = await builderService.create(projectId, userId, body);
      return { endpoint };
    });

    protectedRoutes.put('/:projectId/endpoints/:endpointId', async (request) => {
      const { projectId, endpointId } = request.params as { projectId: string; endpointId: string };
      const body = request.body as Record<string, unknown>;

      const project = await app.db('projects').where({ id: projectId }).select('slug').first();
      if (project) {
        await cacheService.invalidateByEndpoint(project.slug, endpointId);
      }

      if (body.rate_limit !== undefined) {
        const rlKeys = await app.redis.keys(`rl:ep:${endpointId}:*`);
        if (rlKeys.length) await app.redis.del(...rlKeys);
      }

      const endpoint = await builderService.update(endpointId, projectId, body);
      return { endpoint };
    });

    protectedRoutes.delete('/:projectId/endpoints/:endpointId', async (request, reply) => {
      const { projectId, endpointId } = request.params as { projectId: string; endpointId: string };

      const rlKeys = await app.redis.keys(`rl:ep:${endpointId}:*`);
      if (rlKeys.length) await app.redis.del(...rlKeys);
      const project = await app.db('projects').where({ id: projectId }).select('slug').first();
      if (project) {
        await cacheService.invalidateByEndpoint(project.slug, endpointId);
      }

      await builderService.delete(endpointId, projectId);
      return reply.status(204).send();
    });

    protectedRoutes.post('/:projectId/endpoints/:endpointId/toggle', async (request) => {
      const { projectId, endpointId } = request.params as { projectId: string; endpointId: string };
      const endpoint = await builderService.toggleActive(endpointId, projectId);
      return { endpoint };
    });

    protectedRoutes.post('/:projectId/endpoints/:endpointId/version', async (request) => {
      const { projectId, endpointId } = request.params as { projectId: string; endpointId: string };
      const endpoint = await builderService.createNewVersion(endpointId, projectId);
      return { endpoint };
    });

    protectedRoutes.post('/:projectId/endpoints/:endpointId/test', async (request) => {
      const { projectId, endpointId } = request.params as { projectId: string; endpointId: string };
      const { params: testParams, query: testQuery, body: testBody } = (request.body as Record<string, unknown>) ?? {};

      const project = await resolveProject(app, projectId);
      const endpoint = await builderService.findById(endpointId, projectId);

      const start = Date.now();
      try {
        const timeout = request.quotas?.queryTimeout || 30_000;
        const result = await executor.execute(
          endpoint,
          project.db_schema,
          (testParams as Record<string, string>) ?? {},
          (testQuery as Record<string, string>) ?? {},
          (testBody as Record<string, unknown>) ?? null,
          timeout,
        );
        const duration = Date.now() - start;
        return { status: 200, data: result, duration_ms: duration };
      } catch (err) {
        const duration = Date.now() - start;
        const error = err as AppError;
        return {
          status: error.statusCode ?? 500,
          error: error.message,
          duration_ms: duration,
        };
      }
    });
  });
}

export async function apiDynamicRoutes(app: FastifyInstance) {
  const executor = new Executor(app.db);
  const cacheService = new CacheService(app.redis);

  async function handleDynamicApi(request: any, reply: any, apiVersion: number) {
    const { projectSlug } = request.params as { projectSlug: string; '*': string };
    const wildcardPath = (request.params as Record<string, string>)['*'];
    const path = '/' + wildcardPath;

    const project = await app.db('projects').where({ slug: projectSlug }).first();
    if (!project) return reply.status(404).send({ error: 'Project not found' });

    const endpointExact = await app.db('api_endpoints')
      .where({
        project_id: project.id,
        method: request.method,
        path,
        is_active: true,
        version: apiVersion,
      })
      .first();

    const endpointFinal = endpointExact ?? await app.db('api_endpoints')
      .where({
        project_id: project.id,
        method: request.method,
        is_active: true,
        version: apiVersion,
      })
      .whereRaw('? LIKE regexp_replace(path, \'/:([^/]+)\', \'/%\', \'g\')', [path])
      .first();

    if (!endpointFinal) {
      return reply.status(404).send({ error: 'Endpoint not found' });
    }

    const extractedParams: Record<string, string> = {};
    const patternParts = (endpointFinal.path as string).split('/');
    const actualParts = path.split('/');
    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i].startsWith(':')) {
        extractedParams[patternParts[i].slice(1)] = decodeURIComponent(actualParts[i] ?? '');
      }
    }

    if (endpointFinal.auth_type === 'api_token') {
      const apiKey = request.headers['x-api-key'] as string;
      if (!apiKey) {
        return reply.status(401).send({ error: 'API key required' });
      }

      const crypto = await import('crypto');
      const tokenHash = crypto.createHash('sha256').update(apiKey).digest('hex');
      const cached = await app.redis.get(`api_token:${tokenHash}`);

      if (!cached) {
        return reply.status(401).send({ error: 'Invalid API key' });
      }

      const tokenData = JSON.parse(cached);

      if (tokenData.project_id !== project.id) {
        return reply.status(401).send({ error: 'Invalid API key' });
      }

      if (tokenData.expires_at && new Date(tokenData.expires_at) < new Date()) {
        return reply.status(401).send({ error: 'API key expired' });
      }

      if (tokenData.allowed_ips && Array.isArray(tokenData.allowed_ips) && tokenData.allowed_ips.length > 0) {
        const clientIp = request.headers['x-forwarded-for']
          ? (request.headers['x-forwarded-for'] as string).split(',')[0].trim()
          : request.ip;
        if (!tokenData.allowed_ips.includes(clientIp)) {
          return reply.status(403).send({ error: 'IP address not allowed' });
        }
      }
    }

    const rl = endpointFinal.rate_limit
      ? (typeof endpointFinal.rate_limit === 'string' ? JSON.parse(endpointFinal.rate_limit) : endpointFinal.rate_limit)
      : null;
    if (rl && rl.max) {
      const windowMs = rl.window ?? 60000;
      const windowSec = Math.ceil(windowMs / 1000);
      const rlKey = `rl:ep:${endpointFinal.id}:${request.ip}`;

      const current = await app.redis.incr(rlKey);
      if (current === 1) {
        await app.redis.expire(rlKey, windowSec);
      }
      const ttl = await app.redis.ttl(rlKey);

      reply.header('X-EP-RateLimit-Limit', rl.max);
      reply.header('X-EP-RateLimit-Remaining', Math.max(0, rl.max - current));
      reply.header('X-EP-RateLimit-Reset', ttl > 0 ? ttl : windowSec);

      if (current > rl.max) {
        return reply.status(429).send({ error: 'Too many requests' });
      }
    }

    if (endpointFinal.cache_enabled && request.method === 'GET') {
      const cached = await cacheService.get(
        projectSlug,
        endpointFinal.id,
        { path, query: request.query }
      );
      if (cached) {
        reply.header('X-Cache', 'HIT');
        return cached;
      }
    }

    try {
      const result = await executor.execute(
        endpointFinal,
        project.db_schema,
        extractedParams,
        request.query as Record<string, string>,
        request.body as Record<string, unknown> | null,
        30_000,
      );

      if (endpointFinal.cache_enabled && request.method === 'GET') {
        await cacheService.set(
          projectSlug,
          endpointFinal.id,
          { path, query: request.query },
          result,
          endpointFinal.cache_ttl
        );
        reply.header('X-Cache', 'MISS');
      }

      if (endpointFinal.deprecated_at) {
        reply.header('X-Deprecated', 'true');
        reply.header('X-Deprecated-At', endpointFinal.deprecated_at);
      }

      return result;
    } catch (err: any) {
      const pgDataErrors = new Set(['22P02', '22003', '22007', '22008', '23502', '23505', '23503']);
      if (err.code && pgDataErrors.has(err.code)) {
        const msg = (err.message as string).split(' - ').pop() ?? err.message;
        return reply.status(422).send({ error: msg });
      }
      const error = err as AppError;
      return reply.status(error.statusCode ?? 500).send({ error: error.message });
    }
  }

  app.all('/api/v1/:projectSlug/*', async (request, reply) => {
    return handleDynamicApi(request, reply, 1);
  });

  app.all('/api/v2/:projectSlug/*', async (request, reply) => {
    return handleDynamicApi(request, reply, 2);
  });
}
