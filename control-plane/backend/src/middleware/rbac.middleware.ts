import type { FastifyRequest, FastifyReply } from 'fastify';
import type { ProjectRole } from '../../../../shared/types/project.types.js';

declare module 'fastify' {
  interface FastifyRequest {
    projectRole?: ProjectRole;
  }
}

const roleHierarchy: Record<ProjectRole, number> = {
  admin: 3,
  editor: 2,
  viewer: 1,
};

const MEMBERSHIP_CACHE_TTL = 60;

export function requireRole(...roles: ProjectRole[]) {
  const minLevel = Math.min(...roles.map((r) => roleHierarchy[r]));

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const user = request.user;

    if (!user) {
      reply.status(401).send({ error: 'Authentication required' });
      return;
    }

    // Superadmin bypass — allow all, assign admin role for downstream use
    if (user.is_superadmin) {
      request.projectRole = 'admin';
      return;
    }

    const projectId = (request.params as Record<string, string>).projectId;
    if (!projectId) {
      reply.status(400).send({ error: 'Project ID required' });
      return;
    }

    // Check Redis cache first (avoids DB roundtrip on repeated requests)
    const { db, redis } = request.server;
    const cacheKey = `rbac:${user.id}:${projectId}`;
    const cached = await redis.get(cacheKey);

    let role: ProjectRole | null = null;

    if (cached) {
      role = cached as ProjectRole;
    } else {
      const member = await db('project_members')
        .where({ project_id: projectId, user_id: user.id })
        .select('role')
        .first();

      if (member) {
        role = member.role as ProjectRole;
        // Cache for 10s — short enough that role changes propagate quickly
        await redis.set(cacheKey, role, 'EX', MEMBERSHIP_CACHE_TTL);
      }
    }

    if (!role) {
      reply.status(403).send({ error: 'Not a member of this project' });
      return;
    }

    const userLevel = roleHierarchy[role];
    if (userLevel < minLevel) {
      reply.status(403).send({ error: 'Insufficient permissions' });
      return;
    }

    // Attach project role to request for downstream use
    request.projectRole = role;
  };
}

export function requireSuperadmin() {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user?.is_superadmin) {
      return reply.status(403).send({ error: 'Superadmin access required' });
    }
  };
}
