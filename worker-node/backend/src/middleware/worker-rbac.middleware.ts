import type { FastifyRequest, FastifyReply } from 'fastify';
import { env } from '../config/env.js';

type WorkerRole = 'admin' | 'editor' | 'viewer';

const roleHierarchy: Record<WorkerRole, number> = {
  admin: 3,
  editor: 2,
  viewer: 1,
};

/**
 * Worker-side RBAC guard. Checks the `x-user-role` header (set by nodeAuthMiddleware)
 * against the minimum required role. This is defense-in-depth: even if someone
 * reaches the worker directly with a valid NODE_API_KEY, they still need the
 * correct role header to access protected routes.
 */
export function requireWorkerRole(minRole: WorkerRole) {
  const minLevel = roleHierarchy[minRole];

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const userRole = request.userRole as WorkerRole | undefined;

    if (!userRole) {
      reply.status(403).send({ error: 'Forbidden: missing user role' });
      return;
    }

    const userLevel = roleHierarchy[userRole];
    if (userLevel === undefined || userLevel < minLevel) {
      reply.status(403).send({ error: 'Forbidden: insufficient permissions' });
      return;
    }
  };
}

/**
 * Guard for /internal/* routes. Only allows requests from the Control Plane.
 * Validates INTERNAL_SECRET header in addition to NODE_API_KEY.
 */
export function requireInternalCaller() {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const internalSecret = request.headers['x-internal-secret'] as string;
    const expectedSecret = env.INTERNAL_SECRET;

    // If INTERNAL_SECRET is configured, enforce it
    if (expectedSecret && internalSecret !== expectedSecret) {
      reply.status(403).send({ error: 'Forbidden: internal access only' });
      return;
    }
  };
}
