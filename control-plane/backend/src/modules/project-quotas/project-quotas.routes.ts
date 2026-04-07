import type { FastifyInstance } from 'fastify';
import { ProjectQuotasService } from './project-quotas.service.js';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { requireSuperadmin, requireRole } from '../../middleware/rbac.middleware.js';
import { logAudit } from '../audit/audit.middleware.js';
import { z } from 'zod';

const quotaFieldSchema: Record<string, z.ZodTypeAny> = {
  max_tables: z.coerce.number().int().min(1).optional(),
  max_records: z.coerce.number().int().min(1).optional(),
  max_api_requests: z.coerce.number().int().min(1).optional(),
  max_storage_mb: z.coerce.number().int().min(1).optional(),
  max_endpoints: z.coerce.number().int().min(1).optional(),
  max_webhooks: z.coerce.number().int().min(1).optional(),
  max_files: z.coerce.number().int().min(1).optional(),
  max_backups: z.coerce.number().int().min(1).optional(),
  max_cron: z.coerce.number().int().min(1).optional(),
  max_query_timeout_ms: z.coerce.number().int().min(1000).optional(),
  max_concurrent_requests: z.coerce.number().int().min(1).optional(),
  max_rows_per_query: z.coerce.number().int().min(1).optional(),
  max_export_rows: z.coerce.number().int().min(1).optional(),
};

const createPlanSchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().max(7).optional(),
  description: z.string().max(500).optional(),
  ...quotaFieldSchema,
});

const updatePlanSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  color: z.string().max(7).optional(),
  description: z.string().max(500).optional(),
  ...quotaFieldSchema,
});

const projectQuotaSchema = z.object(quotaFieldSchema);

const assignPlanSchema = z.object({
  plan_id: z.string().uuid().nullable(),
});

export async function projectPlansRoutes(app: FastifyInstance) {
  const service = new ProjectQuotasService(app.db, app.redis);

  app.addHook('preHandler', authMiddleware);

  app.get('/', { preHandler: [requireSuperadmin()] }, async () => {
    const plans = await service.getAllPlans();
    return { plans };
  });

  app.post('/', { preHandler: [requireSuperadmin()] }, async (request) => {
    const body = createPlanSchema.parse(request.body);
    const plan = await service.createPlan(body);
    logAudit(request, 'plan.create', 'project_plan', plan.id, { name: body.name });
    return { plan };
  });

  app.put('/:id', { preHandler: [requireSuperadmin()] }, async (request) => {
    const { id } = request.params as { id: string };
    const body = updatePlanSchema.parse(request.body);
    const plan = await service.updatePlan(id, body);
    logAudit(request, 'plan.update', 'project_plan', id, { name: body.name });
    return { plan };
  });

  app.delete('/:id', { preHandler: [requireSuperadmin()] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await service.deletePlan(id);
    logAudit(request, 'plan.delete', 'project_plan', id);
    return reply.status(204).send();
  });
}

export async function projectQuotasRoutes(app: FastifyInstance) {
  const service = new ProjectQuotasService(app.db, app.redis);

  app.addHook('preHandler', authMiddleware);

  app.get('/:projectId/quotas', { preHandler: [requireRole('viewer')] }, async (request) => {
    const { projectId } = request.params as { projectId: string };
    const [effective, usage] = await Promise.all([
      service.getEffectiveProjectQuota(projectId),
      service.getProjectUsage(projectId),
    ]);
    return {
      quota: effective.quota,
      usage,
      source: effective.source,
      plan_name: 'plan_name' in effective ? effective.plan_name : undefined,
      plan_color: 'plan_color' in effective ? effective.plan_color : undefined,
    };
  });

  app.put('/:projectId/quotas', { preHandler: [requireSuperadmin()] }, async (request) => {
    const { projectId } = request.params as { projectId: string };
    const body = projectQuotaSchema.parse(request.body);
    const quota = await service.setProjectQuota(projectId, body);
    logAudit(request, 'project_quota.set', 'project', projectId);
    return { quota };
  });

  app.delete('/:projectId/quotas', { preHandler: [requireSuperadmin()] }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    await service.deleteProjectQuota(projectId);
    logAudit(request, 'project_quota.delete', 'project', projectId);
    return reply.status(204).send();
  });

  app.put('/:projectId/plan', { preHandler: [requireSuperadmin()] }, async (request) => {
    const { projectId } = request.params as { projectId: string };
    const body = assignPlanSchema.parse(request.body);
    await service.assignPlan(projectId, body.plan_id);
    logAudit(request, 'project_plan.assign', 'project', projectId, { plan_id: body.plan_id });
    return { success: true };
  });
}
