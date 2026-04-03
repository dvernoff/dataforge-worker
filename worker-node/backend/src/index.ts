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
import { flowsRoutes } from './modules/flows/flows.routes.js';
import { pluginRoutes } from './modules/plugins/plugin.routes.js';
import { openapiRoutes } from './modules/api-executor/openapi.routes.js';
import { sboxAuthRoutes } from './modules/plugins/built-in/sbox-auth/sbox-auth.routes.js';
import { dashboardsRoutes } from './modules/dashboards/dashboards.routes.js';
import { dbMapRoutes } from './modules/db-map/db-map.routes.js';
import { aiRoutes } from './modules/ai/ai.routes.js';
import { naturalPublicRoutes } from './modules/ai/natural.public.routes.js';
import { pipelinesRoutes } from './modules/pipelines/pipelines.routes.js';
import fastifyWebsocket from '@fastify/websocket';
import { websocketRoutes } from './modules/realtime/websocket.service.js';
import { HistoryService } from './modules/data/history.service.js';
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

// Error handler
app.setErrorHandler(errorHandler);

// Plugins
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

// WebSocket routes
await app.register(websocketRoutes);

// Global quota enforcement — concurrency guard on all authenticated routes
app.addHook('preHandler', async (request, reply) => {
  if (request.projectId && request.isSharedNode) {
    await quotaConcurrencyGuard(request, reply);
  }
});

// Worker module routes (proxied from CP with node-auth)
await app.register(schemaRoutes, { prefix: '/api/projects' });
await app.register(dataRoutes, { prefix: '/api/projects' });
await app.register(apiBuilderRoutes, { prefix: '/api/projects' });
await app.register(webhookRoutes, { prefix: '/api/projects' });
await app.register(sqlConsoleRoutes, { prefix: '/api/projects' });
await app.register(filesRoutes, { prefix: '/api/projects' });
await app.register(batchRoutes, { prefix: '/api/projects' });
await app.register(graphqlRoutes);
await app.register(graphqlProxyRoutes, { prefix: '/api/projects' });

// Analytics & Explorer routes
await app.register(analyticsRoutes, { prefix: '/api/projects' });
await app.register(explorerRoutes, { prefix: '/api/projects' });

// Cron, Flows & Plugins
await app.register(cronRoutes, { prefix: '/api/projects' });
await app.register(flowsRoutes, { prefix: '/api/projects' });
await app.register(pluginRoutes, { prefix: '/api/projects' });
await app.register(dashboardsRoutes, { prefix: '/api/projects' });
await app.register(dbMapRoutes, { prefix: '/api/projects' });
await app.register(aiRoutes, { prefix: '/api/projects' });
await app.register(pipelinesRoutes, { prefix: '/api/projects' });

// Dynamic API execution (public, uses own auth per-endpoint)
await app.register(apiDynamicRoutes);

// OpenAPI / Swagger docs (public, no auth)
await app.register(openapiRoutes);

// S&box Auth public routes (no standard auth)
await app.register(sboxAuthRoutes, { prefix: '/api/v1' });

// Natural Language public API
await app.register(naturalPublicRoutes, { prefix: '/api/v1' });

// Request logger for API analytics
registerRequestLogger(app);

// Internal routes (CP <-> WN communication)
await app.register(internalRoutes, { prefix: '/internal' });

// Health check (no auth required)
app.get('/api/health', async () => {
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

  const mem = process.memoryUsage();
  const cpus = os.cpus();
  let totalIdle = 0, totalTick = 0;
  for (const cpu of cpus) {
    for (const type in cpu.times) {
      totalTick += (cpu.times as Record<string, number>)[type];
    }
    totalIdle += cpu.times.idle;
  }
  const cpuUsage = Math.round((1 - totalIdle / totalTick) * 10000) / 100;

  const { getDiskInfo } = await import('./modules/heartbeat/heartbeat.service.js');
  const disk = getDiskInfo();

  return {
    status: dbOk && redisOk ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    node_id: env.NODE_ID,
    hostname: os.hostname(),
    uptime: process.uptime(),
    database: dbOk ? 'connected' : 'disconnected',
    redis: redisOk ? 'connected' : 'disconnected',
    memory: {
      rss: Math.round(mem.rss / 1024 / 1024),
      heap_used: Math.round(mem.heapUsed / 1024 / 1024),
    },
    cpu_usage: cpuUsage,
    ram_usage: Math.round((1 - os.freemem() / os.totalmem()) * 10000) / 100,
    disk_usage: disk.disk_usage,
    disk_total_gb: disk.disk_total_gb,
    disk_free_gb: disk.disk_free_gb,
  };
});

// Start heartbeat service
const heartbeat = new HeartbeatService();

// Cron service — restore active jobs on startup
const cronService = new CronService(app.db);

// Periodic history cleanup (every hour)
const historyCleanupInterval = setInterval(async () => {
  try {
    // Fetch retention days from CP public settings
    let days = 7;
    try {
      const res = await fetch(`${env.CONTROL_PLANE_URL}/api/system/settings/public`);
      if (res.ok) {
        const data = await res.json() as { settings: Record<string, string> };
        days = Number(data.settings?.time_travel_days ?? '7');
      }
    } catch { /* use default */ }

    const historyService = new HistoryService(app.db);
    const projects = await app.db('projects').select('db_schema');
    for (const project of projects) {
      await historyService.purgeAllOldHistory(project.db_schema, days);
    }
  } catch { /* ignore cleanup errors */ }
}, 60 * 60 * 1000); // every hour

// Start
try {
  await app.listen({ port: env.PORT, host: env.HOST });
  app.log.info(`DataForge Worker Node running on http://${env.HOST}:${env.PORT}`);

  heartbeat.start(env.CONTROL_PLANE_URL, env.NODE_API_KEY);

  // Restore all active cron jobs from database
  cronService.startAll().catch((err) => app.log.error(err, 'Failed to restore cron jobs'));
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// Graceful shutdown
const shutdown = async () => {
  cronService.stopAll();
  clearInterval(historyCleanupInterval);
  heartbeat.stop();
  await app.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
