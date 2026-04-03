import type { FastifyInstance } from 'fastify';
import { nodeAuthMiddleware } from '../../middleware/node-auth.middleware.js';
import { z } from 'zod';
import os from 'os';
import * as fs from 'fs';
import * as path from 'path';

export async function internalRoutes(app: FastifyInstance) {
  app.addHook('preHandler', nodeAuthMiddleware);

  // POST /internal/projects — create project schema on worker DB
  app.post('/projects', async (request, reply) => {
    const body = z.object({
      id: z.string().uuid(),
      slug: z.string().min(1).max(255),
      db_schema: z.string().min(1).max(255),
      settings: z.record(z.unknown()).default({}),
    }).parse(request.body);

    // Validate schema name to prevent SQL injection
    const schemaRegex = /^[a-z_][a-z0-9_]*$/;
    if (!schemaRegex.test(body.db_schema)) {
      return reply.status(400).send({ error: 'Invalid schema name' });
    }

    // Create the schema in the database
    await app.db.raw(`CREATE SCHEMA IF NOT EXISTS "${body.db_schema}"`);

    // Insert into local projects table
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

  // DELETE /internal/projects/:projectId — drop project schema + full cleanup
  app.delete('/projects/:projectId', async (request, reply) => {
    const { projectId } = request.params as { projectId: string };

    const project = await app.db('projects').where({ id: projectId }).first();
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    // Validate schema name to prevent SQL injection
    const schemaRegex = /^[a-z_][a-z0-9_]*$/;
    if (!schemaRegex.test(project.db_schema)) {
      return reply.status(400).send({ error: 'Invalid schema name' });
    }

    // 1. Delete uploaded files from disk
    try {
      const hasFiles = await app.db.schema.hasTable('files');
      if (hasFiles) {
        const files = await app.db('files').where({ project_id: projectId }).select('storage_path');
        for (const f of files) {
          try { if (fs.existsSync(f.storage_path)) fs.unlinkSync(f.storage_path); } catch { /* ignore */ }
        }
        await app.db('files').where({ project_id: projectId }).del();
      }
    } catch { /* table may not exist */ }

    // 2. Delete plugin instances
    try { await app.db('plugin_instances').where({ project_id: projectId }).del(); } catch { /* ignore */ }

    // 3. Delete schema versions
    try { await app.db('schema_versions').where({ project_id: projectId }).del(); } catch { /* ignore */ }

    // 4. Delete validation rules
    try { await app.db('validation_rules').where({ project_id: projectId }).del(); } catch { /* ignore */ }

    // 5. Delete RLS rules
    try { await app.db('rls_rules').where({ project_id: projectId }).del(); } catch { /* ignore */ }

    // 6. Delete API request logs
    try { await app.db('api_request_logs').where({ project_id: projectId }).del(); } catch { /* ignore */ }

    // 7. Delete data history
    try { await app.db('data_history').where({ project_id: projectId }).del(); } catch { /* ignore */ }

    // 8. Delete cron jobs + runs (may not cascade)
    try {
      const cronIds = await app.db('cron_jobs').where({ project_id: projectId }).pluck('id');
      if (cronIds.length) await app.db('cron_job_runs').whereIn('cron_job_id', cronIds).del();
      await app.db('cron_jobs').where({ project_id: projectId }).del();
    } catch { /* ignore */ }

    // 9. Delete flows + runs
    try {
      const flowIds = await app.db('flows').where({ project_id: projectId }).pluck('id');
      if (flowIds.length) await app.db('flow_runs').whereIn('flow_id', flowIds).del();
      await app.db('flows').where({ project_id: projectId }).del();
    } catch { /* ignore */ }

    // 10. Delete dashboards
    try { await app.db('custom_dashboards').where({ project_id: projectId }).del(); } catch { /* ignore */ }

    // 11. Delete webhooks + logs
    try { await app.db('webhook_logs').where({ project_id: projectId }).del(); } catch { /* ignore */ }
    try { await app.db('webhooks').where({ project_id: projectId }).del(); } catch { /* ignore */ }

    // 12. Delete endpoints
    try { await app.db('api_endpoints').where({ project_id: projectId }).del(); } catch { /* ignore */ }

    // 13. Delete saved queries
    try { await app.db('saved_queries').where({ project_id: projectId }).del(); } catch { /* ignore */ }

    // 14. Drop the PostgreSQL schema (user tables + data)
    await app.db.raw(`DROP SCHEMA IF EXISTS "${project.db_schema}" CASCADE`);

    // 15. Delete project record
    await app.db('projects').where({ id: projectId }).delete();

    // 16. Clean up uploads directory for this project
    try {
      const uploadsDir = path.resolve('./uploads', projectId);
      if (fs.existsSync(uploadsDir)) {
        fs.rmSync(uploadsDir, { recursive: true, force: true });
      }
    } catch { /* ignore */ }

    return reply.status(204).send();
  });

  // GET /internal/projects/:projectId/usage — usage stats for a project
  app.get('/projects/:projectId/usage', async (request) => {
    const { projectId } = request.params as { projectId: string };

    const project = await app.db('projects').where({ id: projectId }).first();
    if (!project) {
      return { tables: 0, records: 0, storage_mb: 0, files: 0, cron: 0, endpoints: 0, webhooks: 0 };
    }

    // Count tables in project schema
    let tablesCount = 0;
    let recordsCount = 0;
    let schemaSizeMb = 0;
    try {
      const tables = await app.db.raw(
        `SELECT tablename FROM pg_tables WHERE schemaname = ?`, [project.db_schema]
      );
      tablesCount = tables.rows?.length ?? 0;

      // Count total records across all tables
      if (tablesCount > 0) {
        const countQueries = tables.rows.map((t: { tablename: string }) =>
          `SELECT COUNT(*)::bigint AS c FROM "${project.db_schema}"."${t.tablename}"`
        );
        const result = await app.db.raw(countQueries.join(' UNION ALL '));
        recordsCount = (result.rows ?? []).reduce((sum: number, r: { c: string }) => sum + Number(r.c), 0);
      }

      // Get schema size in MB
      const sizeResult = await app.db.raw(
        `SELECT COALESCE(SUM(pg_total_relation_size('"' || ? || '"."' || tablename || '"')), 0)::bigint AS size_bytes
         FROM pg_tables WHERE schemaname = ?`,
        [project.db_schema, project.db_schema]
      );
      schemaSizeMb = Math.round(Number(sizeResult.rows?.[0]?.size_bytes ?? 0) / 1024 / 1024 * 100) / 100;
    } catch { /* schema may not exist */ }

    // Files size
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
    } catch { /* ignore */ }

    // Cron jobs count
    let cronCount = 0;
    try { cronCount = Number((await app.db('cron_jobs').where({ project_id: projectId }).count('id as count').first())?.count ?? 0); } catch { /* ignore */ }

    // Endpoints count
    let endpointsCount = 0;
    try { endpointsCount = Number((await app.db('api_endpoints').where({ project_id: projectId }).count('id as count').first())?.count ?? 0); } catch { /* ignore */ }

    // Webhooks count
    let webhooksCount = 0;
    try { webhooksCount = Number((await app.db('webhooks').where({ project_id: projectId }).count('id as count').first())?.count ?? 0); } catch { /* ignore */ }

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

  // POST /internal/tokens/sync — sync API token (create/revoke)
  app.post('/tokens/sync', async (request) => {
    const body = z.object({
      action: z.enum(['create', 'revoke']),
      token_hash: z.string(),
      project_id: z.string().uuid(),
      scopes: z.array(z.string()).optional(),
      allowed_ips: z.array(z.string()).optional(),
      expires_at: z.string().optional(),
    }).parse(request.body);

    const cacheKey = `api_token:${body.token_hash}`;

    if (body.action === 'create') {
      const tokenData = {
        project_id: body.project_id,
        scopes: body.scopes ?? ['read'],
        allowed_ips: body.allowed_ips ?? [],
        expires_at: body.expires_at ?? null,
      };
      // Store in Redis with optional TTL
      if (body.expires_at) {
        const ttl = Math.max(1, Math.floor((new Date(body.expires_at).getTime() - Date.now()) / 1000));
        await app.redis.set(cacheKey, JSON.stringify(tokenData), 'EX', ttl);
      } else {
        await app.redis.set(cacheKey, JSON.stringify(tokenData));
      }
      return { success: true, action: 'created' };
    } else {
      // Revoke: remove from cache
      await app.redis.del(cacheKey);
      return { success: true, action: 'revoked' };
    }
  });

  // GET /internal/health — detailed health info
  app.get('/health', async () => {
    let dbOk = false;
    try {
      await app.db.raw('SELECT 1');
      dbOk = true;
    } catch { /* ignore */ }

    let redisOk = false;
    try {
      await app.redis.ping();
      redisOk = true;
    } catch { /* ignore */ }

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
