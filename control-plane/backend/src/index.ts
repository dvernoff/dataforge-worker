import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import compress from '@fastify/compress';
import cookie from '@fastify/cookie';
import { env } from './config/env.js';
import databasePlugin from './plugins/database.plugin.js';
import redisPlugin from './plugins/redis.plugin.js';
import swaggerPlugin from './plugins/swagger.plugin.js';
import { errorHandler } from './middleware/error-handler.js';
import rateLimitPlugin from './middleware/rate-limit.middleware.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { projectRoutes } from './modules/projects/projects.routes.js';
import { usersRoutes } from './modules/users/users.routes.js';
import { inviteRoutes } from './modules/auth/invite.routes.js';
import { auditRoutes } from './modules/audit/audit.routes.js';
import { tokensRoutes } from './modules/api-tokens/tokens.routes.js';
import { nodesRoutes } from './modules/nodes/nodes.routes.js';
import { heartbeatRoutes } from './modules/nodes/heartbeat.routes.js';
import { proxyRoutes } from './modules/proxy/proxy.routes.js';
import { quotasRoutes } from './modules/quotas/quotas.routes.js';
import { securityRoutes } from './modules/security/security.routes.js';
import { backupsRoutes } from './modules/backups/backups.routes.js';
import { BackupScheduler } from './modules/backups/backup-scheduler.js';
import { sdkRoutes } from './modules/sdk/sdk.routes.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { errorsRoutes } from './modules/errors/errors.routes.js';
import { settingsRoutes } from './modules/settings/settings.routes.js';
import { cpPluginsRoutes } from './modules/plugins/cp-plugins.routes.js';
import { rolesRoutes } from './modules/roles/roles.routes.js';
import { projectPlansRoutes, projectQuotasRoutes } from './modules/project-quotas/project-quotas.routes.js';

const app = Fastify({
  trustProxy: true,
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
await app.register(compress, { global: true });

await app.register(cookie, {
  secret: env.JWT_REFRESH_SECRET,
  parseOptions: {},
});

await app.register(databasePlugin);
await app.register(redisPlugin);
await app.register(swaggerPlugin);
await app.register(rateLimitPlugin);

// Routes — Control Plane modules only
await app.register(authRoutes, { prefix: '/api/auth' });
await app.register(projectRoutes, { prefix: '/api/projects' });
await app.register(usersRoutes, { prefix: '/api/users' });
await app.register(inviteRoutes, { prefix: '/api/projects' });
await app.register(auditRoutes, { prefix: '/api/projects' });
await app.register(tokensRoutes, { prefix: '/api/projects' });
await app.register(nodesRoutes, { prefix: '/api/nodes' });
await app.register(heartbeatRoutes, { prefix: '/internal' });
await app.register(proxyRoutes, { prefix: '/api/projects' });
await app.register(quotasRoutes, { prefix: '/api/quotas' });
await app.register(securityRoutes, { prefix: '/api/projects' });
await app.register(backupsRoutes, { prefix: '/api/projects' });
await app.register(sdkRoutes, { prefix: '/api/projects' });
await app.register(healthRoutes, { prefix: '/api/health' });
await app.register(errorsRoutes, { prefix: '/api/errors' });
await app.register(settingsRoutes, { prefix: '/api/system' });
await app.register(cpPluginsRoutes, { prefix: '/api/cp-plugins' });
await app.register(rolesRoutes, { prefix: '/api/system/roles' });
await app.register(projectPlansRoutes, { prefix: '/api/system/project-plans' });
await app.register(projectQuotasRoutes, { prefix: '/api/projects' });

// Public scripts (install-worker.sh, docker-compose.worker.yml, etc.)
app.get('/api/scripts/:filename', async (request, reply) => {
  const { filename } = request.params as { filename: string };
  const allowedFiles: Record<string, { contentType: string }> = {
    'install-worker.sh': { contentType: 'text/x-shellscript' },
    'install-worker.ps1': { contentType: 'text/plain' },
    'docker-compose.worker.yml': { contentType: 'text/yaml' },
    'setup-firewall.sh': { contentType: 'text/x-shellscript' },
  };

  const file = allowedFiles[filename];
  if (!file) {
    return reply.status(404).send({ error: 'Script not found' });
  }

  try {
    const fs = await import('fs');
    const path = await import('path');
    const filePath = path.resolve('/scripts', filename);
    if (!fs.existsSync(filePath)) {
      const fallback = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../scripts', filename);
      const content = fs.readFileSync(fallback, 'utf-8');
      return reply.type(file.contentType).send(content);
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return reply.type(file.contentType).send(content);
  } catch {
    return reply.status(404).send({ error: 'Script file not found on server' });
  }
});

// Also serve scripts at /scripts/* for direct URL access
app.get('/scripts/:filename', async (request, reply) => {
  const { filename } = request.params as { filename: string };
  // Redirect to API route
  return reply.redirect(`/api/scripts/${filename}`);
});

// Public registration settings (no auth required)
app.get('/api/system/settings/public', async () => {
  // Ensure system_settings table exists
  const exists = await app.db.schema.hasTable('system_settings');
  if (!exists) {
    return { settings: { registration_enabled: 'true', require_invite: 'true', default_role: 'viewer' } };
  }
  const keys = ['registration_enabled', 'require_invite', 'default_role', 'request_retention_days', 'audit_retention_days', 'backup_retention_days'];
  const rows = await app.db('system_settings').whereIn('key', keys).select('key', 'value');
  const settings: Record<string, string> = { registration_enabled: 'true', require_invite: 'true', default_role: 'viewer' };
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  return { settings };
});

// Start
try {
  await app.listen({ port: env.PORT, host: env.HOST });
  app.log.info(`DataForge Control Plane running on http://${env.HOST}:${env.PORT}`);

  const backupScheduler = new BackupScheduler(app.db, app.redis);
  backupScheduler.start();
  app.log.info('Backup scheduler started');

  setInterval(async () => {
    try {
      let auditDays = 30;
      try {
        const setting = await app.db('system_settings').where({ key: 'audit_retention_days' }).first();
        if (setting?.value) auditDays = Math.max(1, Number(setting.value));
      } catch {}
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - auditDays);
      const cutoffISO = cutoff.toISOString();
      const nowISO = new Date().toISOString();

      try { await app.db('audit_logs').where('created_at', '<', cutoffISO).del(); } catch {}
      try { await app.db('tracked_errors').where('created_at', '<', cutoffISO).del(); } catch {}
      try { await app.db('webhook_logs').where('sent_at', '<', cutoffISO).del(); } catch {}
      try { await app.db('refresh_tokens').where('expires_at', '<', nowISO).del(); } catch {}
      try { await app.db('api_tokens').whereNotNull('expires_at').where('expires_at', '<', nowISO).del(); } catch {}
      try { await app.db('api_tokens').where({ is_active: false }).where('updated_at', '<', cutoffISO).del(); } catch {}
      try { await app.db('invite_keys').where('expires_at', '<', nowISO).del(); } catch {}
      try { await app.db('invite_keys').where({ is_active: false }).where('created_at', '<', cutoffISO).del(); } catch {}
    } catch {}
  }, 60 * 60 * 1000);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
