import type { FastifyInstance } from 'fastify';
import { UsersService } from './users.service.js';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { requireSuperadmin } from '../../middleware/rbac.middleware.js';
import { AppError } from '../../middleware/error-handler.js';
import { logAudit } from '../audit/audit.middleware.js';
import { z } from 'zod';

export async function usersRoutes(app: FastifyInstance) {
  const usersService = new UsersService(app.db);

  app.addHook('preHandler', authMiddleware);

  // GET /api/users — superadmin only
  app.get('/', { preHandler: [requireSuperadmin()] }, async () => {
    const users = await usersService.findAll();
    return { users };
  });

  // POST /api/users — superadmin creates user directly (no invite key)
  app.post('/', { preHandler: [requireSuperadmin()] }, async (request) => {
    const body = z.object({
      email: z.string().email(),
      password: z.string().min(6),
      name: z.string().min(1).max(255),
      is_superadmin: z.boolean().optional(),
    }).parse(request.body);

    const user = await usersService.create(body);
    logAudit(request, 'user.create', 'user', user.id, { email: body.email });
    return { user };
  });

  // GET /api/users/:userId
  app.get('/:userId', async (request) => {
    const { userId } = request.params as { userId: string };

    // Users can view their own profile, superadmins can view any
    if (userId !== request.user.id && !request.user.is_superadmin) {
      throw new AppError(403, 'Forbidden');
    }

    const user = await usersService.findById(userId);
    return { user };
  });

  // PUT /api/users/:userId — superadmin only
  app.put('/:userId', { preHandler: [requireSuperadmin()] }, async (request) => {
    const { userId } = request.params as { userId: string };
    const body = z.object({
      name: z.string().min(1).max(255).optional(),
      email: z.string().email().optional(),
      is_active: z.boolean().optional(),
      role_id: z.string().uuid().nullable().optional(),
    }).parse(request.body);

    const user = await usersService.update(userId, body);
    return { user };
  });

  // POST /api/users/:userId/assign-role — superadmin only
  app.post('/:userId/assign-role', { preHandler: [requireSuperadmin()] }, async (request) => {
    const { userId } = request.params as { userId: string };
    const body = z.object({
      role_id: z.string().uuid().nullable(),
    }).parse(request.body);

    const user = await usersService.assignRole(userId, body.role_id);
    logAudit(request, 'user.assign_role', 'user', userId, { role_id: body.role_id });
    return { user };
  });

  // GET /api/users/:userId/projects — superadmin or self
  app.get('/:userId/projects', async (request) => {
    const { userId } = request.params as { userId: string };

    if (userId !== request.user.id && !request.user.is_superadmin) {
      throw new AppError(403, 'Forbidden');
    }

    const projects = await usersService.getUserProjects(userId);
    return { projects };
  });

  // POST /api/users/:userId/promote — superadmin only
  app.post('/:userId/promote', { preHandler: [requireSuperadmin()] }, async (request) => {
    const { userId } = request.params as { userId: string };
    const user = await usersService.promoteSuperadmin(userId);
    logAudit(request, 'user.promote', 'user', userId);
    return { user };
  });

  // POST /api/users/:userId/demote — superadmin only
  app.post('/:userId/demote', { preHandler: [requireSuperadmin()] }, async (request) => {
    const { userId } = request.params as { userId: string };

    // Cannot demote yourself
    if (userId === request.user.id) {
      throw new AppError(400, 'Cannot demote yourself');
    }

    const user = await usersService.demoteSuperadmin(userId);
    logAudit(request, 'user.demote', 'user', userId);
    return { user };
  });

  // POST /api/users/:userId/deactivate — superadmin only
  app.post('/:userId/deactivate', { preHandler: [requireSuperadmin()] }, async (request) => {
    const { userId } = request.params as { userId: string };

    if (userId === request.user.id) {
      throw new AppError(400, 'Cannot deactivate yourself');
    }

    const user = await usersService.deactivate(userId);
    logAudit(request, 'user.deactivate', 'user', userId);
    return { user };
  });

  // POST /api/users/:userId/block — superadmin only
  app.post('/:userId/block', { preHandler: [requireSuperadmin()] }, async (request) => {
    const { userId } = request.params as { userId: string };

    if (userId === request.user.id) {
      throw new AppError(400, 'Cannot block yourself');
    }

    const body = z.object({
      reason: z.string().max(500).optional(),
    }).parse(request.body ?? {});

    // Ensure columns exist
    const hasBlockedAt = await app.db.schema.hasColumn('users', 'blocked_at');
    if (!hasBlockedAt) {
      await app.db.schema.alterTable('users', (t) => {
        t.timestamp('blocked_at').nullable();
        t.uuid('blocked_by').nullable();
      });
    }
    const hasBlockReason = await app.db.schema.hasColumn('users', 'block_reason');
    if (!hasBlockReason) {
      await app.db.schema.alterTable('users', (t) => {
        t.text('block_reason').nullable();
      });
    }

    const updateData: Record<string, unknown> = {
      blocked_at: new Date(),
      blocked_by: request.user.id,
      is_active: false,
      updated_at: new Date(),
    };
    if (body.reason) updateData.block_reason = body.reason;

    const [user] = await app.db('users')
      .where({ id: userId })
      .update(updateData)
      .returning(['id', 'email', 'name', 'is_superadmin', 'is_active', 'blocked_at']);

    if (!user) throw new AppError(404, 'User not found');
    logAudit(request, 'user.block', 'user', userId, { reason: body.reason });
    return { user };
  });

  // POST /api/users/:userId/unblock — superadmin only
  app.post('/:userId/unblock', { preHandler: [requireSuperadmin()] }, async (request) => {
    const { userId } = request.params as { userId: string };

    const [user] = await app.db('users')
      .where({ id: userId })
      .update({
        blocked_at: null,
        blocked_by: null,
        block_reason: null,
        is_active: true,
        updated_at: new Date(),
      })
      .returning(['id', 'email', 'name', 'is_superadmin', 'is_active', 'blocked_at']);

    if (!user) throw new AppError(404, 'User not found');
    logAudit(request, 'user.unblock', 'user', userId);
    return { user };
  });

  // POST /api/users/:userId/reset-password — superadmin only
  app.post('/:userId/reset-password', {
    preHandler: [requireSuperadmin()],
  }, async (request) => {
    const { userId } = request.params as { userId: string };
    const crypto = await import('crypto');
    const bcrypt = await import('bcrypt');

    const newPassword = crypto.default.randomBytes(8).toString('base64url').slice(0, 12);
    const hash = await bcrypt.default.hash(newPassword, 10);

    const updated = await app.db('users').where({ id: userId }).update({ password_hash: hash });
    if (!updated) throw new AppError(404, 'User not found');

    logAudit(request, 'user.reset_password', 'user', userId);

    return { password: newPassword };
  });

  // DELETE /api/users/:userId — superadmin only
  app.delete('/:userId', { preHandler: [requireSuperadmin()] }, async (request) => {
    const { userId } = request.params as { userId: string };

    if (userId === request.user.id) {
      throw new AppError(400, 'Cannot delete yourself');
    }

    const user = await app.db('users').where({ id: userId }).select('id', 'email', 'name').first();
    if (!user) throw new AppError(404, 'User not found');

    const cleanupTables = [
      'project_members', 'api_tokens', 'refresh_tokens', 'audit_logs',
    ];
    for (const table of cleanupTables) {
      try { await app.db(table).where({ user_id: userId }).del(); } catch {}
    }

    try {
      let cursor = '0';
      do {
        const [next, keys] = await app.redis.scan(cursor, 'MATCH', `rbac:${userId}:*`, 'COUNT', 200);
        cursor = next;
        if (keys.length) await app.redis.del(...keys);
      } while (cursor !== '0');
    } catch {}

    await app.db('users').where({ id: userId }).del();

    logAudit(request, 'user.delete', 'user', userId, { email: user.email, name: user.name });
    return { success: true };
  });
}
