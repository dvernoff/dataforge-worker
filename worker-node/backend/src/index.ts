import os from 'os';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { env } from './config/env.js';
import databasePlugin from './plugins/database.plugin.js';
import redisPlugin from './plugins/redis.plugin.js';
import swaggerPlugin from './plugins/swagger.plugin.js';
import { errorHandler } from './middleware/error-handler.js';
import rateLimitPlugin from './middleware/rate-limit.middleware.js';
import { schemaRoutes } from './modules/schema/schema.routes.js';
import { dataRoutes } from './modules/data/data.routes.js';
import { apiBuilderRoutes, apiDynamicRoutes } from './modules/api-builder/builder.routes.js';
import { webhookRoutes } from './modules/webhooks/webhooks.routes.js';
import { sqlConsoleRoutes } from './modules/sql-console/console.routes.js';
import { filesRoutes } from './modules/files/files.routes.js';
import { batchRoutes } from './modules/data/batch.routes.js';
import { graphqlRoutes } from './modules/api-executor/graphql.routes.js';
import { graphqlProxyRoutes } from './modules/api-executor/graphql.proxy.routes.js';
import { internalRoutes } from './modules/internal/internal.routes.js';
import { analyticsRoutes } from './modules/analytics/analytics.routes.js';
import { explorerRoutes } from './modules/data/explorer.routes.js';
import { registerRequestLogger } from './modules/analytics/request-logger.js';
import { HeartbeatService } from './modules/heartbeat/heartbeat.service.js';
import { cronRoutes } from './modules/cron/cron.routes.js';
import { pluginRoutes } from './modules/plugins/plugin.routes.js';
import { openapiRoutes } from './modules/api-executor/openapi.routes.js';
import { sboxAuthRoutes, sboxAuthManagementRoutes } from './modules/plugins/built-in/sbox-auth/sbox-auth.routes.js';
import { dashboardsRoutes } from './modules/dashboards/dashboards.routes.js';
import { dbMapRoutes } from './modules/db-map/db-map.routes.js';
import { backupExportRoutes } from './modules/backups/backup-export.routes.js';
import { discordWebhookRoutes } from './modules/plugins/built-in/discord-webhook/discord-webhook.routes.js';
import { telegramBotRoutes } from './modules/plugins/built-in/telegram-bot/telegram-bot.routes.js';
import { uptimeMonitorRoutes } from './modules/plugins/built-in/uptime-ping/uptime-ping.routes.js';
import { UptimeScheduler } from './modules/plugins/built-in/uptime-ping/uptime-scheduler.js';

import fastifyWebsocket from '@fastify/websocket';
import { websocketRoutes } from './modules/realtime/websocket.service.js';
import { CronService } from './modules/cron/cron.service.js';
import { quotaConcurrencyGuard } from './middleware/quota-enforcement.middleware.js';

const app = Fastify({
  logger: {
    level: env.NODE_ENV === 'development' ? 'info' : 'warn',
    transport: env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
  },
});

app.setErrorHandler(errorHandler);

await app.register(cors, {
  origin: env.CORS_ORIGIN,
  credentials: true,
});

await app.register(helmet, { global: true, hidePoweredBy: true });

await app.register(databasePlugin);
await app.register(redisPlugin);
await app.register(swaggerPlugin);
await app.register(rateLimitPlugin);
await app.register(fastifyWebsocket);

await app.register(websocketRoutes);

app.addHook('preHandler', async (request, reply) => {
  if (request.projectId && request.isSharedNode) {
    await quotaConcurrencyGuard(request, reply);
  }
});

await app.register(schemaRoutes, { prefix: '/api/projects' });
await app.register(dataRoutes, { prefix: '/api/projects' });
await app.register(apiBuilderRoutes, { prefix: '/api/projects' });
await app.register(webhookRoutes, { prefix: '/api/projects' });
await app.register(sqlConsoleRoutes, { prefix: '/api/projects' });
await app.register(filesRoutes, { prefix: '/api/projects' });
await app.register(batchRoutes, { prefix: '/api/projects' });
await app.register(graphqlRoutes);
await app.register(graphqlProxyRoutes, { prefix: '/api/projects' });

await app.register(analyticsRoutes, { prefix: '/api/projects' });
await app.register(explorerRoutes, { prefix: '/api/projects' });

await app.register(cronRoutes, { prefix: '/api/projects' });
await app.register(backupExportRoutes, { prefix: '/api/projects' });
await app.register(pluginRoutes, { prefix: '/api/projects' });
await app.register(dashboardsRoutes, { prefix: '/api/projects' });
await app.register(dbMapRoutes, { prefix: '/api/projects' });
await app.register(discordWebhookRoutes, { prefix: '/api/projects' });
await app.register(telegramBotRoutes, { prefix: '/api/projects' });
await app.register(uptimeMonitorRoutes, { prefix: '/api/projects' });
await app.register(apiDynamicRoutes);

await app.register(openapiRoutes);

await app.register(sboxAuthRoutes, { prefix: '/api/v1' });
await app.register(sboxAuthManagementRoutes, { prefix: '/api/projects' });


registerRequestLogger(app);

await app.register(internalRoutes, { prefix: '/internal' });

app.get('/api/health', async () => {
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
  };
});

const heartbeat = new HeartbeatService();

const cronService = new CronService(app.db);
const uptimeScheduler = new UptimeScheduler(app.db);
(app as unknown as Record<string, unknown>).uptimeScheduler = uptimeScheduler;

const cleanupInterval = setInterval(async () => {
  try {
    let requestRetentionDays = 30;
    let auditRetentionDays = 30;
    try {
      const res = await fetch(`${env.CONTROL_PLANE_URL}/api/system/settings/public`);
      if (res.ok) {
        const data = await res.json() as { settings: Record<string, string> };
        requestRetentionDays = Math.max(1, Number(data.settings?.request_retention_days ?? '30'));
        auditRetentionDays = Math.max(1, Number(data.settings?.audit_retention_days ?? '30'));
      }
    } catch {}

    const requestCutoff = new Date();
    requestCutoff.setDate(requestCutoff.getDate() - requestRetentionDays);
    const requestCutoffISO = requestCutoff.toISOString();

    const auditCutoff = new Date();
    auditCutoff.setDate(auditCutoff.getDate() - auditRetentionDays);
    const auditCutoffISO = auditCutoff.toISOString();

    try { await app.db('api_request_logs').where('created_at', '<', requestCutoffISO).del(); } catch {}
    try { await app.db('webhook_logs').where('sent_at', '<', requestCutoffISO).del(); } catch {}
    try { await app.db('cron_job_runs').where('started_at', '<', requestCutoffISO).del(); } catch {}
    try { await app.db('flow_runs').where('started_at', '<', requestCutoffISO).del(); } catch {}

    try {
      const hasAudit = await app.db.schema.hasTable('audit_logs');
      if (hasAudit) {
        await app.db('audit_logs').where('created_at', '<', auditCutoffISO).del();
      }
    } catch {}

    try { await app.db('data_history').where('created_at', '<', auditCutoffISO).del(); } catch {}
    try { await app.db('comments').where('created_at', '<', auditCutoffISO).del(); } catch {}
  } catch {}
}, 60 * 60 * 1000);

try {
  await app.listen({ port: env.PORT, host: env.HOST });
  app.log.info(`DataForge Worker Node ${process.env.APP_VERSION || 'dev'} running on http://${env.HOST}:${env.PORT}`);

  heartbeat.start(env.CONTROL_PLANE_URL, env.NODE_API_KEY);

  cronService.startAll().catch((err) => app.log.error(err, 'Failed to restore cron jobs'));
  uptimeScheduler.startAll().catch((err) => app.log.error(err, 'Failed to start uptime scheduler'));

  (async () => {
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
      if (restored > 0) app.log.info(`Restored ${restored} API tokens from database to Redis`);
    } catch (err) {
      app.log.warn(err, 'Failed to restore API tokens from database');
    }
  })();
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

const shutdown = async () => {
  cronService.stopAll();
  uptimeScheduler.stopAll();
  clearInterval(cleanupInterval);
  heartbeat.stop();
  await app.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
