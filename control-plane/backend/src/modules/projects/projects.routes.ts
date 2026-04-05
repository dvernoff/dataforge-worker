import type { FastifyInstance } from 'fastify';
import { ProjectsService } from './projects.service.js';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { requireRole, requireSuperadmin } from '../../middleware/rbac.middleware.js';
import { createProjectSchema, updateProjectSchema } from '../../../../../shared/types/project.types.js';
import { AppError } from '../../middleware/error-handler.js';
import { logAudit } from '../audit/audit.middleware.js';
import { ProxyService } from '../proxy/proxy.service.js';
import { QuotasService } from '../quotas/quotas.service.js';
import { env } from '../../config/env.js';
import { z } from 'zod';

export async function projectRoutes(app: FastifyInstance) {
  const projectsService = new ProjectsService(app.db);
  const proxyService = new ProxyService(app.db, app.redis);
  const quotasService = new QuotasService(app.db, app.redis);

  /**
   * Sync project to Worker Node — creates schema + local record on Worker DB.
   * Called after project creation and can be retried.
   */
  async function syncProjectToWorker(project: { id: string; slug: string; db_schema: string }) {
    try {
      const worker = await proxyService.getWorkerForProject(project.id);
      await fetch(`${worker.url.replace(/\/$/, '')}/internal/projects`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Node-Api-Key': worker.apiKey,
          ...(env.INTERNAL_SECRET ? { 'X-Internal-Secret': env.INTERNAL_SECRET } : {}),
        },
        body: JSON.stringify({
          id: project.id,
          slug: project.slug,
          db_schema: project.db_schema,
          settings: {},
        }),
      });
    } catch (err) {
      // Log but don't fail — Worker might be offline, will sync on next restart
      app.log.warn({ err, projectId: project.id }, 'Failed to sync project to Worker Node');
    }
  }

  // All routes require auth
  app.addHook('preHandler', authMiddleware);

  // keyPrefix 'cp:' is auto-applied by ioredis to GET/SET/DEL but NOT to KEYS.
  // So cache keys must NOT include the 'cp:' prefix manually.
  app.get('/', async (request) => {
    const cacheKey = `projects:list:${request.user.id}:${request.user.is_superadmin}`;
    const cached = await app.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const projects = await projectsService.findAll(request.user.id, request.user.is_superadmin);
    const result = { projects };
    await app.redis.set(cacheKey, JSON.stringify(result), 'EX', 30);
    return result;
  });

  app.post('/', async (request, reply) => {
    // Quota enforcement: check max_projects (superadmins bypass)
    if (!request.user.is_superadmin) {
      const blocked = await quotasService.checkCreateQuota(request.user.id, 'projects');
      if (blocked) {
        return reply.status(429).send({ error: blocked, errorCode: 'QUOTA_EXCEEDED' });
      }
    }
    const body = createProjectSchema.parse(request.body);
    const project = await projectsService.create(body, request.user.id);
    logAudit(request, 'project.create', 'project', project.id, { name: project.name });

    // Sync project to Worker Node (create schema + local record)
    await syncProjectToWorker(project);

    // Invalidate projects cache
    // KEYS ignores ioredis keyPrefix, so use full prefix; DEL auto-prepends it, so strip
    const keys = await app.redis.keys('cp:projects:*');
    if (keys.length) await app.redis.del(...keys.map(k => k.replace(/^cp:/, '')));
    return { project };
  });

  app.get('/:projectId', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const project = await projectsService.findById(projectId);

    if (!request.user.is_superadmin) {
      const member = await app.db('project_members')
        .where({ project_id: projectId, user_id: request.user.id })
        .first();
      if (!member) {
        throw new AppError(403, 'Not a member of this project');
      }
    }

    // Attach worker node URL for frontend use
    try {
      const worker = await proxyService.getWorkerForProject(projectId);
      project.node_url = worker.url;
    } catch { /* node not available */ }

    return { project };
  });

  app.get('/by-slug/:slug', async (request) => {
    const { slug } = request.params as { slug: string };
    const cacheKey = `cp:projects:slug:${slug}:${request.user.id}`;
    const cached = await app.redis.get(cacheKey);
    if (cached) {
      const data = JSON.parse(cached);
      return data;
    }

    const project = await projectsService.findBySlug(slug);

    if (!request.user.is_superadmin) {
      const member = await app.db('project_members')
        .where({ project_id: project.id, user_id: request.user.id })
        .first();
      if (!member) {
        // Return 404 (not 403) to prevent slug enumeration
        throw new AppError(404, 'Project not found');
      }
    }

    // Attach worker node URL for frontend use
    try {
      const worker = await proxyService.getWorkerForProject(project.id);
      project.node_url = worker.url;
    } catch { /* node not available */ }

    const result = { project };
    await app.redis.set(cacheKey, JSON.stringify(result), 'EX', 30);
    return result;
  });

  app.put('/:projectId', {
    preHandler: [requireRole('admin')],
  }, async (request) => {
    const { projectId } = request.params as { projectId: string };
    const body = updateProjectSchema.parse(request.body);
    const project = await projectsService.update(projectId, body);
    logAudit(request, 'project.update', 'project', projectId, body);
    // Invalidate projects cache
    // KEYS ignores ioredis keyPrefix, so use full prefix; DEL auto-prepends it, so strip
    const keys = await app.redis.keys('cp:projects:*');
    if (keys.length) await app.redis.del(...keys.map(k => k.replace(/^cp:/, '')));
    return { project };
  });

  app.delete('/:projectId', {
    preHandler: [requireRole('admin')],
  }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };

    const project = await projectsService.findById(projectId);

    // Delete project schema on Worker
    try {
      const worker = await proxyService.getWorkerForProject(projectId);
      await fetch(`${worker.url.replace(/\/$/, '')}/internal/projects/${projectId}`, {
        method: 'DELETE',
        headers: {
          'X-Node-Api-Key': worker.apiKey,
          ...(env.INTERNAL_SECRET ? { 'X-Internal-Secret': env.INTERNAL_SECRET } : {}),
        },
      });
    } catch (err) {
      app.log.warn({ err, projectId }, 'Failed to delete project on Worker Node');
    }

    await projectsService.delete(projectId);
    logAudit(request, 'project.delete', 'project', projectId, { name: project.name, slug: project.slug });
    // Invalidate projects cache
    // KEYS ignores ioredis keyPrefix, so use full prefix; DEL auto-prepends it, so strip
    const keys = await app.redis.keys('cp:projects:*');
    if (keys.length) await app.redis.del(...keys.map(k => k.replace(/^cp:/, '')));
    return reply.status(204).send();
  });

  app.get('/:projectId/members', {
    preHandler: [requireRole('viewer')],
  }, async (request) => {
    const { projectId } = request.params as { projectId: string };
    const members = await projectsService.getMembers(projectId);
    return { members };
  });

  app.post('/:projectId/members', {
    preHandler: [requireRole('admin')],
  }, async (request) => {
    const { projectId } = request.params as { projectId: string };
    const body = z.object({
      userId: z.string().uuid(),
      role: z.enum(['admin', 'editor', 'viewer']),
    }).parse(request.body);
    const member = await projectsService.addMember(projectId, body.userId, body.role);
    // Invalidate RBAC cache for the affected user
    await app.redis.del(`rbac:${body.userId}:${projectId}`);
    return { member };
  });

  app.put('/:projectId/members/:userId', {
    preHandler: [requireRole('admin')],
  }, async (request) => {
    const { projectId, userId } = request.params as { projectId: string; userId: string };
    const body = z.object({ role: z.enum(['admin', 'editor', 'viewer']) }).parse(request.body);
    const member = await projectsService.updateMemberRole(projectId, userId, body.role);
    // Invalidate RBAC cache — role changed
    await app.redis.del(`rbac:${userId}:${projectId}`);
    return { member };
  });

  app.delete('/:projectId/members/:userId', {
    preHandler: [requireRole('admin')],
  }, async (request, reply) => {
    const { projectId, userId } = request.params as { projectId: string; userId: string };
    await projectsService.removeMember(projectId, userId);
    // Invalidate RBAC cache — member removed
    await app.redis.del(`rbac:${userId}:${projectId}`);
    return reply.status(204).send();
  });
}
