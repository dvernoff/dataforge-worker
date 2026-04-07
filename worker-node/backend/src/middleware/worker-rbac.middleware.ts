import type { FastifyRequest, FastifyReply } from 'fastify';
import { env } from '../config/env.js';

type WorkerRole = 'admin' | 'editor' | 'viewer';

const roleHierarchy: Record<WorkerRole, number> = {
  admin: 3,
  editor: 2,
  viewer: 1,
};

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

export function requireInternalCaller() {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const internalSecret = request.headers['x-internal-secret'] as string;
    const expectedSecret = env.INTERNAL_SECRET;

    if (expectedSecret && internalSecret !== expectedSecret) {
      reply.status(403).send({ error: 'Forbidden: internal access only' });
      return;
    }
  };
}
