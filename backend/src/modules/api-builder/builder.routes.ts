import type { FastifyInstance } from 'fastify';
import type Redis from 'ioredis';
import { BuilderService } from './builder.service.js';
import { Executor } from './executor.js';
import { CacheService } from './cache.service.js';
import { nodeAuthMiddleware } from '../../middleware/node-auth.middleware.js';
import { requireWorkerRole } from '../../middleware/worker-rbac.middleware.js';
import { AppError } from '../../middleware/error-handler.js';
import { checkApiRequestQuota, reportQuotaViolation } from '../../middleware/quota-enforcement.middleware.js';
import { env } from '../../config/env.js';
import { z } from 'zod';
import { hasRequiredScopes } from '../../utils/scope-matcher.js';

async function resolveProject(app: FastifyInstance, projectId: string) {
  const project = await app.db('projects').where({ id: projectId }).first();
  if (!project) throw new AppError(404, 'Project not found');
  return project;
}

// Endpoint resolve cache: avoids one or two `api_endpoints` SELECTs per dynamic
// API request when the same (project, method, path) is hit repeatedly. TTL is
// short enough that propagation lag from missed invalidations is bounded; every
// mutation handler also calls clearEndpointResolveCache for instant fan-out.
const ENDPOINT_RESOLVE_TTL = 10;

async function clearEndpointResolveCache(redis: Redis, projectId: string): Promise<void> {
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', `endpoint_resolve:${projectId}:*`, 'COUNT', 200);
    cursor = next;
    if (keys.length) await redis.del(...keys);
  } while (cursor !== '0');
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
        auth_type: z.enum(['public', 'api_token', 'sbox_session']).optional(),
        is_active: z.boolean().optional(),
        version: z.number().int().min(1).max(99).optional(),
        rollout: z.object({
          strategy: z.enum(['full', 'canary']),
          percentage: z.number().min(0).max(100).optional(),
          sticky_by: z.enum(['api_token', 'ip']).optional(),
        }).optional(),
        deprecates: z.object({
          replaces_version: z.number().int().optional(),
          sunset_date: z.string().optional(),
        }).optional(),
        required_scopes: z.array(z.string()).optional(),
      }).parse(request.body);

      const endpoint = await builderService.create(projectId, userId, body);
      await clearEndpointResolveCache(app.redis, projectId);
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
      await clearEndpointResolveCache(app.redis, projectId);
      return { endpoint };
    });

    protectedRoutes.post('/:projectId/endpoints/bulk', async (request) => {
      const { projectId } = request.params as { projectId: string };
      const body = z.object({
        updates: z.array(z.object({ endpoint_id: z.string().uuid() }).passthrough()).min(1).max(100),
      }).parse(request.body);

      const result = await builderService.bulkUpdate(projectId, body.updates as Array<{ endpoint_id: string } & Record<string, unknown>>);

      // On commit, invalidate response cache for every successfully-updated endpoint
      // and the global endpoint resolve cache once. Skip cache work entirely on rollback —
      // nothing actually changed in the DB so the cache is still correct.
      if (result.committed) {
        const project = await app.db('projects').where({ id: projectId }).select('slug').first();
        if (project) {
          for (const r of result.results) {
            if (r.status === 'ok') {
              await cacheService.invalidateByEndpoint(project.slug, r.endpoint_id);
            }
          }
        }
        await clearEndpointResolveCache(app.redis, projectId);
      }

      return result;
    });

    protectedRoutes.delete('/:projectId/endpoints/:endpointId', async (request, reply) => {
      const { projectId, endpointId } = request.params as { projectId: string; endpointId: string };

      let rlCursor = '0';
      do {
        const [next, keys] = await app.redis.scan(rlCursor, 'MATCH', `rl:ep:${endpointId}:*`, 'COUNT', 200);
        rlCursor = next;
        if (keys.length) await app.redis.del(...keys);
      } while (rlCursor !== '0');
      const project = await app.db('projects').where({ id: projectId }).select('slug').first();
      if (project) {
        await cacheService.invalidateByEndpoint(project.slug, endpointId);
      }

      await builderService.delete(endpointId, projectId);
      await clearEndpointResolveCache(app.redis, projectId);
      return reply.status(204).send();
    });

    protectedRoutes.post('/:projectId/endpoints/:endpointId/toggle', async (request) => {
      const { projectId, endpointId } = request.params as { projectId: string; endpointId: string };
      const endpoint = await builderService.toggleActive(endpointId, projectId);
      await clearEndpointResolveCache(app.redis, projectId);
      return { endpoint };
    });

    protectedRoutes.post('/:projectId/endpoints/:endpointId/version', async (request) => {
      const { projectId, endpointId } = request.params as { projectId: string; endpointId: string };
      const endpoint = await builderService.createNewVersion(endpointId, projectId);
      await clearEndpointResolveCache(app.redis, projectId);
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
  // Response compression scoped to public dynamic API only. Admin routes
  // (/api/projects/...) and streaming endpoints (MCP SSE, backup export NDJSON)
  // live in other plugins/scopes and stay uncompressed — internal CP→worker
  // fetches don't all auto-decompress, and streaming flows would break.
  const compress = (await import('@fastify/compress')).default;
  await app.register(compress, {
    global: true,
    threshold: 1024,
    encodings: ['br', 'gzip', 'deflate'],
  });

  const executor = new Executor(app.db);
  const cacheService = new CacheService(app.redis);

  const { WebhookDispatcher } = await import('../webhooks/dispatcher.js');
  const { WebSocketService } = await import('../realtime/websocket.service.js');
  const webhookDispatcher = new WebhookDispatcher(app.db);

  const slugCache = new Map<string, { project: any; expiry: number }>();
  const SLUG_CACHE_TTL = 30 * 60_000; // 30 min — slug almost never changes

  async function resolveProjectBySlug(slug: string) {
    const cached = slugCache.get(slug);
    if (cached && cached.expiry > Date.now()) return cached.project;
    const project = await app.db('projects').where({ slug }).first();
    if (project) slugCache.set(slug, { project, expiry: Date.now() + SLUG_CACHE_TTL });
    return project;
  }

  // Quota cache: stale-while-revalidate
  //   HARD_TTL    — absolute lifetime. After this, cold fetch is synchronous.
  //   SOFT_TTL    — "fresh" window. Beyond it, value is still served, refresh kicks off in background.
  //   CP_TIMEOUT  — short timeout for CP fetch. If CP is slow we don't pay for it on the hot path.
  const QUOTA_HARD_TTL = 3600;             // 1 hour
  const QUOTA_SOFT_TTL_MS = 50 * 60_000;   // 50 minutes (kick refresh after this age)
  const QUOTA_CP_TIMEOUT_MS = 800;
  const QUOTA_NEG_TTL = 60;                // If CP fails on cold start, cache 'unknown' briefly to avoid hammering

  async function fetchQuotaFromCP(projectId: string): Promise<Record<string, number> | null> {
    const cpUrl = env.CONTROL_PLANE_URL;
    if (!cpUrl) return null;
    try {
      const res = await fetch(`${cpUrl}/internal/project-quotas/${projectId}`, {
        headers: { 'x-node-api-key': env.NODE_API_KEY },
        signal: AbortSignal.timeout(QUOTA_CP_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const data = await res.json() as { quota: Record<string, number> };
      return data.quota ?? null;
    } catch {
      return null;
    }
  }

  // Singleflight: in-flight cold fetches per project inside this worker process.
  // Prevents N concurrent requests for the same project from all hitting CP simultaneously.
  const inFlightQuotaFetch = new Map<string, Promise<Record<string, number>>>();

  async function getProjectQuota(projectId: string): Promise<Record<string, number>> {
    const key = `project_quotas:${projectId}`;
    const cached = await app.redis.get(key);

    if (cached) {
      try {
        const parsed = JSON.parse(cached) as { quota?: Record<string, number>; fetched_at?: number; fallback?: boolean };
        // Legacy format (just the quota object) — treat as fresh, migrate silently
        const quota = parsed.quota ?? (parsed as unknown as Record<string, number>);
        const age = parsed.fetched_at ? Date.now() - parsed.fetched_at : 0;

        // Stale but usable — trigger background refresh (guarded by Redis lock across workers), return current value
        if (!parsed.fallback && age > QUOTA_SOFT_TTL_MS) {
          const lockKey = `project_quotas_refresh:${projectId}`;
          app.redis.set(lockKey, '1', 'EX', 30, 'NX').then(async (locked) => {
            if (locked !== 'OK') return;
            const fresh = await fetchQuotaFromCP(projectId);
            if (fresh) {
              await app.redis.set(key, JSON.stringify({ quota: fresh, fetched_at: Date.now() }), 'EX', QUOTA_HARD_TTL);
            }
          }).catch(() => {});
        }
        return quota;
      } catch {}
    }

    // Cold path — coalesce concurrent fetches so only one request actually hits CP
    const existing = inFlightQuotaFetch.get(projectId);
    if (existing) return existing;

    const promise = (async (): Promise<Record<string, number>> => {
      try {
        const fresh = await fetchQuotaFromCP(projectId);
        if (fresh) {
          await app.redis.set(key, JSON.stringify({ quota: fresh, fetched_at: Date.now() }), 'EX', QUOTA_HARD_TTL);
          return fresh;
        }
        // CP unreachable — cache empty for a short window so we don't re-hit every request
        const empty: Record<string, number> = {};
        await app.redis.set(key, JSON.stringify({ quota: empty, fetched_at: Date.now(), fallback: true }), 'EX', QUOTA_NEG_TTL);
        return empty;
      } finally {
        inFlightQuotaFetch.delete(projectId);
      }
    })();

    inFlightQuotaFetch.set(projectId, promise);
    return promise;
  }

  function invalidateQuotaCache(projectId: string) {
    app.redis.del(`project_quotas:${projectId}`).catch(() => {});
    inFlightQuotaFetch.delete(projectId);
  }
  (app as any).invalidateQuotaCache = invalidateQuotaCache;

  const RATE_LIMIT_LUA = `
    local key = KEYS[1]
    local limit = tonumber(ARGV[1])
    local window = tonumber(ARGV[2])
    local current = redis.call('incr', key)
    if current == 1 then redis.call('expire', key, window) end
    local ttl = redis.call('ttl', key)
    return {current, ttl}
  `;

  async function resolveEndpointCandidates(
    projectId: string,
    method: string,
    path: string,
  ): Promise<Array<Record<string, unknown>>> {
    const cacheKey = `endpoint_resolve:${projectId}:${method}:${path}`;
    const cached = await app.redis.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached) as Array<Record<string, unknown>>;
      } catch {}
    }
    const baseQuery = app.db('api_endpoints')
      .where({ project_id: projectId, method, is_active: true })
      .whereNull('deprecated_at');
    const exactCandidates = await baseQuery.clone().where({ path }).select('*');
    const candidates = exactCandidates.length === 0
      ? await baseQuery.clone().whereRaw('? LIKE regexp_replace(path, \'/:([^/]+)\', \'/%\', \'g\')', [path]).select('*')
      : exactCandidates;
    try {
      await app.redis.set(cacheKey, JSON.stringify(candidates), 'EX', ENDPOINT_RESOLVE_TTL);
    } catch {}
    return candidates as Array<Record<string, unknown>>;
  }

  async function handleDynamicApi(request: any, reply: any, apiVersion: number) {
    const tStart = Date.now();
    const { projectSlug } = request.params as { projectSlug: string; '*': string };
    const wildcardPath = (request.params as Record<string, string>)['*'];
    const path = '/' + wildcardPath;

    const project = await resolveProjectBySlug(projectSlug);
    if (!project) return reply.status(404).send({ error: 'Project not found' });

    const isDisabled = await app.redis.get(`project_disabled:${project.id}`);
    if (isDisabled) {
      return reply.status(503).send({ error: 'Project is disabled', errorCode: 'PROJECT_DISABLED' });
    }

    request.projectId = project.id;
    request.projectSchema = project.db_schema;

    try {
      const quota = await getProjectQuota(project.id);
      const maxApiRequests = quota.max_api_requests ?? 0;
      if (maxApiRequests > 0) {
        const blocked = await checkApiRequestQuota(app.redis, project.id, maxApiRequests);
        if (blocked) {
          reportQuotaViolation(project.id, '', 'quota.api_requests_exceeded', { limit: maxApiRequests, path: request.url });
          return reply.status(429).send({ error: blocked, errorCode: 'QUOTA_API_REQUESTS' });
        }
      }
    } catch {}

    try {
      const secRaw = await app.redis.get(`security:${project.id}`);
      if (secRaw) {
        const sec = JSON.parse(secRaw);
        const clientIp = (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? request.ip;
        if (sec.ip_mode === 'whitelist' && sec.ip_whitelist.length > 0) {
          if (!sec.ip_whitelist.some((ip: string) => clientIp === ip || clientIp.startsWith(ip.replace(/\/\d+$/, '').replace(/\.\d+$/, '.')))) {
            return reply.status(403).send({ error: 'IP address not allowed' });
          }
        }
        if (sec.ip_mode === 'blacklist' && sec.ip_blacklist.length > 0) {
          if (sec.ip_blacklist.some((ip: string) => clientIp === ip || clientIp.startsWith(ip.replace(/\/\d+$/, '').replace(/\.\d+$/, '.')))) {
            return reply.status(403).send({ error: 'IP address blocked' });
          }
        }
      }
    } catch {}

    executor.setMutationHook((event, tableName, record) => {
      const ws = WebSocketService.getInstance();
      ws.broadcastDataChange(project.id, tableName, event, record);

      app.db('plugin_instances')
        .where({ project_id: project.id, plugin_id: 'feature-webhooks', is_enabled: true })
        .first()
        .then((plugin) => {
          if (!plugin) return;
          return app.db('webhooks')
            .where({ project_id: project.id, is_active: true })
            .whereRaw('? = ANY(table_names)', [tableName])
            .whereRaw('? = ANY(events)', [event]);
        })
        .then((webhooks) => {
          if (!webhooks) return;
          for (const wh of webhooks) {
            webhookDispatcher.dispatch(wh, event, { table: tableName, event, record, timestamp: new Date().toISOString() }).catch(() => {});
          }
        })
        .catch(() => {});
    });

    const explicitVersion = (() => {
      const h = request.headers['x-api-version'];
      if (h) return Number(Array.isArray(h) ? h[0] : h);
      const q = (request.query as Record<string, string>)?.v;
      if (q) return Number(q);
      return null;
    })();

    const candidates = await resolveEndpointCandidates(project.id, request.method, path);

    const parseRollout = (c: Record<string, unknown>) => {
      const raw = c.rollout;
      if (!raw) return null;
      return typeof raw === 'string' ? JSON.parse(raw) as Record<string, unknown> : raw as Record<string, unknown>;
    };
    const isCanary = (c: Record<string, unknown>) => {
      const r = parseRollout(c);
      return r?.strategy === 'canary' && Number(r.percentage ?? 0) > 0 && Number(r.percentage ?? 0) < 100;
    };

    const explicit = explicitVersion ?? (apiVersion > 1 ? apiVersion : null);

    let endpointFinal: Record<string, unknown> | null = null;

    if (explicit !== null) {
      endpointFinal = candidates.find(c => Number(c.version ?? 1) === explicit) ?? null;
    } else {
      const stableSorted = candidates.filter(c => !isCanary(c))
        .sort((a, b) => Number(b.version ?? 1) - Number(a.version ?? 1));
      const canary = candidates.find(c => isCanary(c));
      if (canary && stableSorted.length > 0) {
        const rollout = parseRollout(canary)!;
        const stickyBy = (rollout.sticky_by as string) ?? 'ip';
        const stickyVal = stickyBy === 'api_token'
          ? String(request.headers['x-api-key'] ?? '')
          : String(request.ip ?? '');
        const crypto = await import('crypto');
        const hash = parseInt(crypto.createHash('md5').update(stickyVal + ':' + canary.id).digest('hex').slice(0, 8), 16);
        const bucket = hash % 100;
        if (bucket < Number(rollout.percentage)) {
          endpointFinal = canary;
          reply.header('X-Rollout-Bucket', `canary/${rollout.percentage}`);
        } else {
          endpointFinal = stableSorted[0];
          reply.header('X-Rollout-Bucket', 'stable');
        }
      } else if (stableSorted.length > 0) {
        endpointFinal = stableSorted[0];
      } else if (candidates.length > 0) {
        endpointFinal = candidates[0];
      }
    }

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

      const requiredScopes = typeof endpointFinal.required_scopes === 'string'
        ? JSON.parse(endpointFinal.required_scopes)
        : (endpointFinal.required_scopes ?? []);
      if (!hasRequiredScopes(tokenData.scopes, requiredScopes)) {
        return reply.status(403).send({
          error: 'Insufficient token scopes',
          errorCode: 'DF_SCOPE_DENIED',
          required_scopes: requiredScopes,
          token_scopes: tokenData.scopes ?? [],
        });
      }
    } else if (endpointFinal.auth_type === 'sbox_session') {
      const pluginManager = (app as any).pluginManager;
      if (!pluginManager) {
        return reply.status(503).send({ error: 'Game auth is not configured' });
      }

      const pluginInstance = await pluginManager.getEnabledPluginInstance(project.id, 'sbox-auth');
      if (!pluginInstance) {
        return reply.status(503).send({ error: 'S&box Auth plugin is not enabled' });
      }

      const sessionKey = request.headers['x-session-key'] as string;
      if (!sessionKey) {
        return reply.status(401).send({ error: 'Session key required (x-session-key header)' });
      }

      const settings = typeof pluginInstance.settings === 'string'
        ? JSON.parse(pluginInstance.settings)
        : pluginInstance.settings;

      const sessionTable = settings.session_table || 'players';
      const sessionKeyColumn = settings.session_key_column || 'session_key';
      const steamIdColumn = settings.steam_id_column || 'steam_id';
      const sessionTtl = Number(settings.session_ttl_minutes) || 0;

      const fullTable = `${project.db_schema}.${sessionTable}`;
      const player = await app.db(fullTable).where(sessionKeyColumn, sessionKey).first();

      if (!player) {
        return reply.status(401).send({ error: 'Invalid session key' });
      }

      if (sessionTtl > 0 && player.last_active_at) {
        const lastActive = new Date(player.last_active_at).getTime();
        const expiry = lastActive + sessionTtl * 60 * 1000;
        if (Date.now() > expiry) {
          await app.db(fullTable).where(sessionKeyColumn, sessionKey).update({ [sessionKeyColumn]: null });
          return reply.status(401).send({ error: 'Session expired' });
        }
      }

      const debounceKey = `sbox_active:${sessionKey}`;
      const alreadyUpdated = await app.redis.get(debounceKey);
      if (!alreadyUpdated) {
        app.db(fullTable).where(sessionKeyColumn, sessionKey).update({ last_active_at: new Date() }).catch(() => {});
        app.redis.set(debounceKey, '1', 'EX', 300).catch(() => {});
      }

      (request as any).playerSteamId = String(player[steamIdColumn] ?? '');
      (request as any).playerData = player;
    }

    const rl = endpointFinal.rate_limit
      ? (typeof endpointFinal.rate_limit === 'string' ? JSON.parse(endpointFinal.rate_limit) : endpointFinal.rate_limit)
      : null;
    if (rl && rl.max) {
      const windowMs = rl.window ?? 60000;
      const windowSec = Math.ceil(windowMs / 1000);
      const rlKey = `rl:ep:${endpointFinal.id}:${request.ip}`;

      const [current, ttl] = await app.redis.eval(RATE_LIMIT_LUA, 1, rlKey, rl.max, windowSec) as [number, number];

      reply.header('X-EP-RateLimit-Limit', rl.max);
      reply.header('X-EP-RateLimit-Remaining', Math.max(0, rl.max - current));
      reply.header('X-EP-RateLimit-Reset', ttl > 0 ? ttl : windowSec);

      if (current > rl.max) {
        return reply.status(429).send({ error: 'Too many requests' });
      }
    }

    // Cache key takes into account method + path + query + extracted path params +
    // body (for POST/PUT with cache_enabled, uncommon but supported).
    // If cache_key_template is set on the endpoint, it overrides the default
    // "include everything" behaviour and resolves placeholders against this object.
    const cacheParamsCtx: Record<string, unknown> = {
      method: request.method,
      path,
      query: request.query,
      params: extractedParams,
    };

    let cacheGetMs = 0;
    if (endpointFinal.cache_enabled && request.method === 'GET') {
      const tCacheStart = Date.now();
      const cached = await cacheService.getWithTtl(
        projectSlug,
        endpointFinal.id as string,
        cacheParamsCtx,
        endpointFinal.cache_key_template as string | null | undefined,
      );
      cacheGetMs = Date.now() - tCacheStart;
      if (cached) {
        const ttlConfigured = Number(endpointFinal.cache_ttl ?? 60);
        const age = Math.max(0, ttlConfigured - cached.ttl_seconds);
        reply.header('X-Cache', 'HIT');
        reply.header('Age', String(age));
        reply.header('Cache-Control', `public, max-age=${Math.max(0, cached.ttl_seconds)}`);
        reply.header('Server-Timing', `cache-get;dur=${cacheGetMs}, total;dur=${Date.now() - tStart};desc="HIT"`);
        return cached.data;
      }
    }

    if ((request as any).playerSteamId) {
      extractedParams.player_steam_id = (request as any).playerSteamId;
      cacheParamsCtx.params = extractedParams;
    }

    try {
      const tDbStart = Date.now();
      const result = await executor.execute(
        endpointFinal,
        project.db_schema,
        extractedParams,
        request.query as Record<string, string>,
        request.body as unknown,
        30_000,
        project.id,
      );
      const dbMs = Date.now() - tDbStart;

      let cacheSetMs = 0;
      let cacheStatus: 'HIT' | 'MISS' | 'BYPASS' = 'BYPASS';
      if (endpointFinal.cache_enabled && request.method === 'GET') {
        const tCacheSetStart = Date.now();
        await cacheService.set(
          projectSlug,
          endpointFinal.id as string,
          cacheParamsCtx,
          result,
          endpointFinal.cache_ttl as number,
          endpointFinal.cache_key_template as string | null | undefined,
        );
        cacheSetMs = Date.now() - tCacheSetStart;
        cacheStatus = 'MISS';
        reply.header('X-Cache', 'MISS');
      }

      const timingParts: string[] = [];
      if (cacheGetMs > 0) timingParts.push(`cache-get;dur=${cacheGetMs}`);
      timingParts.push(`db;dur=${dbMs}`);
      if (cacheSetMs > 0) timingParts.push(`cache-set;dur=${cacheSetMs}`);
      timingParts.push(`total;dur=${Date.now() - tStart};desc="${cacheStatus}"`);
      reply.header('Server-Timing', timingParts.join(', '));

      reply.header('X-API-Version', String(endpointFinal.version ?? 1));
      if (endpointFinal.deprecated_at) {
        reply.header('X-Deprecated', 'true');
        reply.header('X-Deprecated-At', endpointFinal.deprecated_at);
        reply.header('Deprecation', 'true');
      }
      if (endpointFinal.sunset_at) {
        reply.header('Sunset', new Date(endpointFinal.sunset_at as string | Date).toUTCString());
      } else if (endpointFinal.deprecates) {
        const dep = typeof endpointFinal.deprecates === 'string' ? JSON.parse(endpointFinal.deprecates as string) : endpointFinal.deprecates as Record<string, unknown>;
        if (dep?.sunset_date) reply.header('Sunset', new Date(dep.sunset_date as string).toUTCString());
      }

      if (result && typeof result === 'object' && Array.isArray((result as { errors?: unknown }).errors)
          && ((result as { errors: unknown[] }).errors.length > 0)) {
        return reply.status(207).send(result);
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
