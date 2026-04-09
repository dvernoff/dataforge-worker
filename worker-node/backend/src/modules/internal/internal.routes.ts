import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { env } from '../../config/env.js';
import { z } from 'zod';
import os from 'os';
import * as fs from 'fs';
import * as path from 'path';

async function internalAuthMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const apiKey = request.headers['x-node-api-key'] as string;
  if (!apiKey || apiKey !== env.NODE_API_KEY) {
    return reply.status(401).send({ error: 'Unauthorized: invalid node API key' });
  }

  if (env.INTERNAL_SECRET) {
    const internalSecret = request.headers['x-internal-secret'] as string;
    if (!internalSecret || internalSecret !== env.INTERNAL_SECRET) {
      return reply.status(403).send({ error: 'Forbidden: internal access only' });
    }
  }
}

export async function internalRoutes(app: FastifyInstance) {
  app.addHook('preHandler', internalAuthMiddleware);

  app.post('/projects', async (request, reply) => {
    const body = z.object({
      id: z.string().uuid(),
      slug: z.string().min(1).max(255),
      db_schema: z.string().min(1).max(255),
      settings: z.record(z.unknown()).default({}),
    }).parse(request.body);

    const schemaRegex = /^[a-z_][a-z0-9_]*$/;
    if (!schemaRegex.test(body.db_schema)) {
      return reply.status(400).send({ error: 'Invalid schema name' });
    }

    await app.db.raw(`CREATE SCHEMA IF NOT EXISTS "${body.db_schema}"`);

    const [project] = await app.db('projects')
      .insert({
        id: body.id,
        slug: body.slug,
        db_schema: body.db_schema,
        settings: JSON.stringify(body.settings),
      })
      .onConflict('id')
      .merge()
      .returning('*');

    return { project };
  });

  app.delete('/projects/:projectId', async (request, reply) => {
    const { projectId } = request.params as { projectId: string };

    const project = await app.db('projects').where({ id: projectId }).first();
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const schemaRegex = /^[a-z_][a-z0-9_]*$/;
    if (!schemaRegex.test(project.db_schema)) {
      return reply.status(400).send({ error: 'Invalid schema name' });
    }

    try {
      const hasFiles = await app.db.schema.hasTable('files');
      if (hasFiles) {
        const files = await app.db('files').where({ project_id: projectId }).select('storage_path');
        for (const f of files) {
          try { if (fs.existsSync(f.storage_path)) fs.unlinkSync(f.storage_path); } catch {}
        }
        await app.db('files').where({ project_id: projectId }).del();
      }
    } catch {}

    try { await app.db('plugin_instances').where({ project_id: projectId }).del(); } catch {}

    try { await app.db('schema_versions').where({ project_id: projectId }).del(); } catch {}

    try { await app.db('validation_rules').where({ project_id: projectId }).del(); } catch {}

    try { await app.db('rls_rules').where({ project_id: projectId }).del(); } catch {}

    try { await app.db('api_request_logs').where({ project_id: projectId }).del(); } catch {}

    try { await app.db('data_history').where({ project_id: projectId }).del(); } catch {}

    try {
      const cronIds = await app.db('cron_jobs').where({ project_id: projectId }).pluck('id');
      if (cronIds.length) await app.db('cron_job_runs').whereIn('cron_job_id', cronIds).del();
      await app.db('cron_jobs').where({ project_id: projectId }).del();
    } catch {}

    try {
      const flowIds = await app.db('flows').where({ project_id: projectId }).pluck('id');
      if (flowIds.length) await app.db('flow_runs').whereIn('flow_id', flowIds).del();
      await app.db('flows').where({ project_id: projectId }).del();
    } catch {}

    try { await app.db('custom_dashboards').where({ project_id: projectId }).del(); } catch {}

    try { await app.db('webhook_logs').where({ project_id: projectId }).del(); } catch {}
    try { await app.db('webhooks').where({ project_id: projectId }).del(); } catch {}

    try { await app.db('api_endpoints').where({ project_id: projectId }).del(); } catch {}

    try { await app.db('saved_queries').where({ project_id: projectId }).del(); } catch {}

    try { await app.db('comments').where({ project_id: projectId }).del(); } catch {}

    try { await app.db('api_tokens_cache').where({ project_id: projectId }).del(); } catch {}

    try {
      const tokenHashes = await app.db('api_tokens_cache').where({ project_id: projectId }).pluck('token_hash');
      for (const hash of tokenHashes) {
        await app.redis.del(`api_token:${hash}`);
      }
    } catch {}

    try {
      let cursor = '0';
      do {
        const [next, keys] = await app.redis.scan(cursor, 'MATCH', `cache:${project.slug}:*`, 'COUNT', 200);
        cursor = next;
        if (keys.length) await app.redis.del(...keys);
      } while (cursor !== '0');
    } catch {}

    try {
      let cursor = '0';
      do {
        const [next, keys] = await app.redis.scan(cursor, 'MATCH', `security:${projectId}`, 'COUNT', 10);
        cursor = next;
        if (keys.length) await app.redis.del(...keys);
      } while (cursor !== '0');
    } catch {}

    await app.db.raw(`DROP SCHEMA IF EXISTS "${project.db_schema}" CASCADE`);

    await app.db('projects').where({ id: projectId }).delete();

    try {
      const uploadsDir = path.resolve('./uploads', projectId);
      if (fs.existsSync(uploadsDir)) {
        fs.rmSync(uploadsDir, { recursive: true, force: true });
      }
    } catch {}

    return reply.status(204).send();
  });

  app.get('/projects/:projectId/usage', async (request) => {
    const { projectId } = request.params as { projectId: string };

    const project = await app.db('projects').where({ id: projectId }).first();
    if (!project) {
      return { tables: 0, records: 0, storage_mb: 0, files: 0, cron: 0, endpoints: 0, webhooks: 0 };
    }

    let tablesCount = 0;
    let recordsCount = 0;
    let schemaSizeMb = 0;
    try {
      const tables = await app.db.raw(
        `SELECT tablename FROM pg_tables WHERE schemaname = ?`, [project.db_schema]
      );
      tablesCount = tables.rows?.length ?? 0;

      if (tablesCount > 0) {
        const countQueries = tables.rows.map((t: { tablename: string }) =>
          `SELECT COUNT(*)::bigint AS c FROM "${project.db_schema}"."${t.tablename}"`
        );
        const result = await app.db.raw(countQueries.join(' UNION ALL '));
        recordsCount = (result.rows ?? []).reduce((sum: number, r: { c: string }) => sum + Number(r.c), 0);
      }

      const sizeResult = await app.db.raw(
        `SELECT COALESCE(SUM(pg_total_relation_size('"' || ? || '"."' || tablename || '"')), 0)::bigint AS size_bytes
         FROM pg_tables WHERE schemaname = ?`,
        [project.db_schema, project.db_schema]
      );
      schemaSizeMb = Math.round(Number(sizeResult.rows?.[0]?.size_bytes ?? 0) / 1024 / 1024 * 100) / 100;
    } catch {}

    let filesSizeMb = 0;
    let filesCount = 0;
    try {
      const hasFiles = await app.db.schema.hasTable('files');
      if (hasFiles) {
        const fileStats = await app.db('files')
          .where({ project_id: projectId })
          .select(
            app.db.raw('COUNT(*)::int as count'),
            app.db.raw('COALESCE(SUM(size), 0)::bigint as total_bytes')
          )
          .first();
        filesCount = fileStats?.count ?? 0;
        filesSizeMb = Math.round(Number(fileStats?.total_bytes ?? 0) / 1024 / 1024 * 100) / 100;
      }
    } catch {}

    let cronCount = 0;
    try { cronCount = Number((await app.db('cron_jobs').where({ project_id: projectId }).count('id as count').first())?.count ?? 0); } catch {}

    let endpointsCount = 0;
    try { endpointsCount = Number((await app.db('api_endpoints').where({ project_id: projectId }).count('id as count').first())?.count ?? 0); } catch {}

    let webhooksCount = 0;
    try { webhooksCount = Number((await app.db('webhooks').where({ project_id: projectId }).count('id as count').first())?.count ?? 0); } catch {}

    return {
      tables: tablesCount,
      records: recordsCount,
      storage_mb: Math.round((schemaSizeMb + filesSizeMb) * 100) / 100,
      files: filesCount,
      cron: cronCount,
      endpoints: endpointsCount,
      webhooks: webhooksCount,
    };
  });

  app.post('/tokens/sync', async (request) => {
    const body = z.object({
      action: z.enum(['create', 'revoke']),
      token_hash: z.string(),
      project_id: z.string().uuid(),
      scopes: z.array(z.string()).optional(),
      allowed_ips: z.array(z.string()).optional(),
      expires_at: z.string().nullable().optional(),
    }).parse(request.body);

    const cacheKey = `api_token:${body.token_hash}`;

    if (body.action === 'create') {
      const tokenData = {
        project_id: body.project_id,
        scopes: body.scopes ?? ['read'],
        allowed_ips: body.allowed_ips ?? [],
        expires_at: body.expires_at ?? null,
      };
      if (body.expires_at) {
        const ttl = Math.max(1, Math.floor((new Date(body.expires_at).getTime() - Date.now()) / 1000));
        await app.redis.set(cacheKey, JSON.stringify(tokenData), 'EX', ttl);
      } else {
        await app.redis.set(cacheKey, JSON.stringify(tokenData));
      }
      try {
        await app.db('api_tokens_cache')
          .insert({
            token_hash: body.token_hash,
            project_id: body.project_id,
            scopes: JSON.stringify(tokenData.scopes),
            allowed_ips: JSON.stringify(tokenData.allowed_ips),
            expires_at: body.expires_at ?? null,
          })
          .onConflict('token_hash')
          .merge();
      } catch {}
      return { success: true, action: 'created' };
    } else {
      await app.redis.del(cacheKey);
      try { await app.db('api_tokens_cache').where({ token_hash: body.token_hash }).delete(); } catch {}
      return { success: true, action: 'revoked' };
    }
  });

  app.post('/tokens/restore', async () => {
    try {
      const tokens = await app.db('api_tokens_cache').select('*');
      let restored = 0;
      for (const token of tokens) {
        if (token.expires_at && new Date(token.expires_at) < new Date()) {
          await app.db('api_tokens_cache').where({ token_hash: token.token_hash }).delete();
          continue;
        }
        const cacheKey = `api_token:${token.token_hash}`;
        const existing = await app.redis.get(cacheKey);
        if (existing) continue;
        const tokenData = {
          project_id: token.project_id,
          scopes: typeof token.scopes === 'string' ? JSON.parse(token.scopes) : token.scopes,
          allowed_ips: typeof token.allowed_ips === 'string' ? JSON.parse(token.allowed_ips) : token.allowed_ips,
          expires_at: token.expires_at,
        };
        if (token.expires_at) {
          const ttl = Math.max(1, Math.floor((new Date(token.expires_at).getTime() - Date.now()) / 1000));
          await app.redis.set(cacheKey, JSON.stringify(tokenData), 'EX', ttl);
        } else {
          await app.redis.set(cacheKey, JSON.stringify(tokenData));
        }
        restored++;
      }
      return { success: true, restored };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  app.post('/update', async (_request, reply) => {
    const watchtowerUrl = env.WATCHTOWER_URL || 'http://watchtower:8080';
    const watchtowerToken = env.WATCHTOWER_TOKEN;

    if (!watchtowerToken) {
      return reply.status(503).send({
        error: 'Watchtower not configured',
        detail: 'WATCHTOWER_TOKEN environment variable is not set',
      });
    }

    try {
      const res = await fetch(`${watchtowerUrl}/v1/update`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${watchtowerToken}`,
        },
      });

      if (!res.ok) {
        const text = await res.text();
        return reply.status(502).send({
          error: 'Watchtower update request failed',
          status: res.status,
          detail: text,
        });
      }

      return { status: 'update_triggered', version: process.env.APP_VERSION || 'dev' };
    } catch (err) {
      return reply.status(502).send({
        error: 'Failed to reach Watchtower',
        detail: (err as Error).message,
      });
    }
  });

  app.post('/shutdown', async (_request, reply) => {
    reply.send({ status: 'shutting_down' });

    setTimeout(async () => {
      try {
        const { execFile } = await import('child_process');
        const { promisify } = await import('util');
        const execFileAsync = promisify(execFile);
        await execFileAsync('docker', ['compose', 'down', '--remove-orphans', '--volumes']);
        try {
          const installDir = path.resolve(process.cwd(), '..');
          if (fs.existsSync(path.join(installDir, 'docker-compose.yml'))) {
            fs.rmSync(installDir, { recursive: true, force: true });
          }
        } catch {}
      } catch {
        process.exit(0);
      }
    }, 500);
  });

  app.post('/security/sync', async (request) => {
    const body = z.object({
      project_id: z.string().uuid(),
      ip_mode: z.enum(['disabled', 'whitelist', 'blacklist']),
      ip_whitelist: z.array(z.string()).default([]),
      ip_blacklist: z.array(z.string()).default([]),
    }).parse(request.body);

    const cacheKey = `security:${body.project_id}`;
    await app.redis.set(cacheKey, JSON.stringify({
      ip_mode: body.ip_mode,
      ip_whitelist: body.ip_whitelist,
      ip_blacklist: body.ip_blacklist,
    }), 'EX', 3600);

    return { success: true };
  });

  app.get('/health', async () => {
    let dbOk = false;
    try {
      await app.db.raw('SELECT 1');
      dbOk = true;
    } catch {}

    let redisOk = false;
    try {
      await app.redis.ping();
      redisOk = true;
    } catch {}

    return {
      status: dbOk && redisOk ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      hostname: os.hostname(),
      uptime: process.uptime(),
      database: dbOk ? 'connected' : 'disconnected',
      redis: redisOk ? 'connected' : 'disconnected',
      memory: {
        rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
        heap_used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      },
      cpu_usage: Math.round(os.loadavg()[0] * 100) / 100,
      ram_usage: Math.round((1 - os.freemem() / os.totalmem()) * 10000) / 100,
    };
  });
}
