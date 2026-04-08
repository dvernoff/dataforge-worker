import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { logAudit } from '../audit/audit.middleware.js';
import { z } from 'zod';

export async function settingsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  // ---------- System Settings (key-value in system_settings table) ----------

  // Ensure system_settings table exists
  async function ensureSystemSettingsTable() {
    const exists = await app.db.schema.hasTable('system_settings');
    if (!exists) {
      await app.db.schema.createTable('system_settings', (t) => {
        t.string('key').primary();
        t.text('value');
        t.timestamp('updated_at').defaultTo(app.db.fn.now());
      });
    }
  }

  async function getSetting(key: string): Promise<string | null> {
    await ensureSystemSettingsTable();
    const row = await app.db('system_settings').where({ key }).first();
    return row ? row.value : null;
  }

  async function setSetting(key: string, value: string): Promise<void> {
    await ensureSystemSettingsTable();
    await app.db('system_settings')
      .insert({ key, value, updated_at: new Date() })
      .onConflict('key')
      .merge({ value, updated_at: new Date() });
  }

  // Registration settings defaults
  const REGISTRATION_DEFAULTS: Record<string, string> = {
    registration_enabled: 'true',
    require_invite: 'true',
    default_role: 'viewer',
    max_users: '0',
  };

  async function ensureRegistrationDefaults() {
    await ensureSystemSettingsTable();
    for (const [key, value] of Object.entries(REGISTRATION_DEFAULTS)) {
      const existing = await app.db('system_settings').where({ key }).first();
      if (!existing) {
        await setSetting(key, value);
      }
    }
  }

  // GET /api/system/settings — get all system settings
  app.get('/settings', async (request, reply) => {
    if (!request.user.is_superadmin) {
      return reply.status(403).send({ error: 'Superadmin required' });
    }

    await ensureRegistrationDefaults();
    const rows = await app.db('system_settings').select('key', 'value');
    const settings: Record<string, string> = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }

    return { settings };
  });

  // PUT /api/system/settings — update system settings (superadmin only)
  app.put('/settings', async (request, reply) => {
    if (!request.user.is_superadmin) {
      return reply.status(403).send({ error: 'Superadmin required' });
    }

    const body = z.object({
      settings: z.record(z.string(), z.string()),
    }).parse(request.body);

    for (const [key, value] of Object.entries(body.settings)) {
      await setSetting(key, value);
    }

    logAudit(request, 'settings.update', 'settings', undefined, { keys: Object.keys(body.settings) });
    return { success: true };
  });

  // POST /api/system/cache/flush — flush all Redis caches (superadmin only)
  app.post('/cache/flush', async (request, reply) => {
    if (!request.user.is_superadmin) {
      return reply.status(403).send({ error: 'Superadmin required' });
    }
    // KEYS ignores ioredis keyPrefix, DEL auto-prepends it — strip prefix before del()
    const keys = await app.redis.keys('cp:*');
    const endpointKeys = await app.redis.keys('cache:endpoint:*');
    const allKeys = [...keys, ...endpointKeys];
    if (allKeys.length) {
      await app.redis.del(...allKeys.map(k => k.replace(/^cp:/, '')));
    }
    logAudit(request, 'cache.flush', 'system', undefined, { keysCleared: allKeys.length });
    return { success: true, keysCleared: allKeys.length };
  });

  // POST /api/system/export — export all CP metadata as JSON
  app.post('/export', async (request, reply) => {
    if (!request.user.is_superadmin) {
      return reply.status(403).send({ error: 'Superadmin required' });
    }

    const [projects, users, apiTokens, inviteKeys, trackedErrors] = await Promise.all([
      app.db('projects').select('*'),
      app.db('users').select('id', 'email', 'name', 'is_superadmin', 'is_active', 'created_at'),
      app.db('api_tokens').select('*'),
      app.db('invite_keys').select('*'),
      app.db('tracked_errors').select('*').limit(1000),
    ]);

    // Optionally fetch project members and quotas
    let projectMembers: Record<string, unknown>[] = [];
    let quotas: Record<string, unknown>[] = [];

    try {
      projectMembers = await app.db('project_members').select('*');
    } catch { /* table may not exist */ }

    try {
      quotas = await app.db('quotas').select('*');
    } catch { /* table may not exist */ }

    const exportData = {
      version: '1.0.0',
      exported_at: new Date().toISOString(),
      exported_by: request.user.id,
      data: {
        projects,
        users,
        project_members: projectMembers,
        api_tokens: apiTokens,
        invite_keys: inviteKeys,
        quotas,
        tracked_errors: trackedErrors,
      },
    };

    return exportData;
  });

  // POST /api/system/import — import CP metadata from JSON
  app.post('/import', async (request, reply) => {
    if (!request.user.is_superadmin) {
      return reply.status(403).send({ error: 'Superadmin required' });
    }

    const body = z.object({
      version: z.string(),
      data: z.object({
        projects: z.array(z.record(z.unknown())).optional(),
        users: z.array(z.record(z.unknown())).optional(),
        project_members: z.array(z.record(z.unknown())).optional(),
        api_tokens: z.array(z.record(z.unknown())).optional(),
        invite_keys: z.array(z.record(z.unknown())).optional(),
        quotas: z.array(z.record(z.unknown())).optional(),
      }),
    }).parse(request.body);

    const stats: Record<string, number> = {};

    await app.db.transaction(async (trx) => {
      if (body.data.users?.length) {
        for (const user of body.data.users) {
          const existing = await trx('users').where({ email: user.email }).first();
          if (!existing) {
            await trx('users').insert(user).onConflict('id').ignore();
          }
        }
        stats.users = body.data.users.length;
      }

      if (body.data.projects?.length) {
        for (const project of body.data.projects) {
          await trx('projects').insert(project).onConflict('id').ignore();
        }
        stats.projects = body.data.projects.length;
      }

      // Import project members
      if (body.data.project_members?.length) {
        for (const member of body.data.project_members) {
          await trx('project_members').insert(member).onConflict(['project_id', 'user_id']).ignore();
        }
        stats.project_members = body.data.project_members.length;
      }

      // Import api tokens
      if (body.data.api_tokens?.length) {
        for (const token of body.data.api_tokens) {
          await trx('api_tokens').insert(token).onConflict('id').ignore();
        }
        stats.api_tokens = body.data.api_tokens.length;
      }

      // Import invite keys
      if (body.data.invite_keys?.length) {
        for (const key of body.data.invite_keys) {
          await trx('invite_keys').insert(key).onConflict('id').ignore();
        }
        stats.invite_keys = body.data.invite_keys.length;
      }

      // Import quotas
      if (body.data.quotas?.length) {
        for (const quota of body.data.quotas) {
          await trx('quotas').insert(quota).onConflict('id').ignore();
        }
        stats.quotas = body.data.quotas.length;
      }
    });

    return { success: true, stats };
  });
}
