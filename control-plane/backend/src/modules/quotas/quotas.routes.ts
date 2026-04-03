import type { FastifyInstance } from 'fastify';
import { QuotasService } from './quotas.service.js';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { requireSuperadmin } from '../../middleware/rbac.middleware.js';
import { z } from 'zod';

const quotaSchema = z.object({
  max_projects: z.coerce.number().int().min(1).optional(),
  max_tables: z.coerce.number().int().min(1).optional(),
  max_records: z.coerce.number().int().min(1).optional(),
  max_api_requests: z.coerce.number().int().min(1).optional(),
  max_storage_mb: z.coerce.number().int().min(1).optional(),
  max_endpoints: z.coerce.number().int().min(1).optional(),
  max_webhooks: z.coerce.number().int().min(1).optional(),
  max_files: z.coerce.number().int().min(1).optional(),
  max_backups: z.coerce.number().int().min(1).optional(),
  max_cron: z.coerce.number().int().min(1).optional(),
  max_ai_requests_per_day: z.coerce.number().int().min(0).optional(),
  max_ai_tokens_per_day: z.coerce.number().int().min(0).optional(),
});

export async function quotasRoutes(app: FastifyInstance) {
  const quotasService = new QuotasService(app.db, app.redis);

  // GET /api/quotas/defaults — get defaults (superadmin)
  app.get('/defaults', {
    preHandler: [authMiddleware, requireSuperadmin()],
  }, async () => {
    const quotas = await quotasService.getDefaults();
    return { quotas };
  });

  // PUT /api/quotas/defaults — update defaults (superadmin)
  app.put('/defaults', {
    preHandler: [authMiddleware, requireSuperadmin()],
  }, async (request) => {
    const body = quotaSchema.parse(request.body);
    const quotas = await quotasService.updateDefaults(body);
    return { quotas };
  });

  // GET /api/quotas/me — get current user's quota + usage
  app.get('/me', {
    preHandler: [authMiddleware],
  }, async (request) => {
    const userId = request.user.id;
    const [effective, usage] = await Promise.all([
      quotasService.getEffectiveQuota(userId),
      quotasService.getUserUsage(userId),
    ]);
    return {
      quota: effective.quota,
      usage,
      source: effective.source,
      role_name: 'role_name' in effective ? effective.role_name : undefined,
      role_color: 'role_color' in effective ? effective.role_color : undefined,
    };
  });

  // GET /api/quotas/users/:userId — get user quota + usage (superadmin)
  app.get('/users/:userId', {
    preHandler: [authMiddleware, requireSuperadmin()],
  }, async (request) => {
    const { userId } = request.params as { userId: string };
    const [effective, usage] = await Promise.all([
      quotasService.getEffectiveQuota(userId),
      quotasService.getUserUsage(userId),
    ]);
    return {
      quota: effective.quota,
      usage,
      source: effective.source,
      role_name: 'role_name' in effective ? effective.role_name : undefined,
      role_color: 'role_color' in effective ? effective.role_color : undefined,
    };
  });

  // PUT /api/quotas/users/:userId — set user quota (superadmin)
  app.put('/users/:userId', {
    preHandler: [authMiddleware, requireSuperadmin()],
  }, async (request) => {
    const { userId } = request.params as { userId: string };
    const body = quotaSchema.parse(request.body);
    const quota = await quotasService.setUserQuota(userId, body);
    return { quota };
  });

  // DELETE /api/quotas/users/:userId — reset to defaults (superadmin)
  app.delete('/users/:userId', {
    preHandler: [authMiddleware, requireSuperadmin()],
  }, async (request, reply) => {
    const { userId } = request.params as { userId: string };
    await quotasService.deleteUserQuota(userId);
    return reply.status(204).send();
  });
}
