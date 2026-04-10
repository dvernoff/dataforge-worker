import type { FastifyRequest, FastifyReply } from 'fastify';
import { env } from '../config/env.js';

const projectCache = new Map<string, { db_schema: string; expiry: number }>();
const PROJECT_CACHE_TTL = 300_000;

export async function nodeAuthMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const apiKey = request.headers['x-node-api-key'] as string;
  if (!apiKey || apiKey !== env.NODE_API_KEY) {
    return reply.status(401).send({ error: 'Unauthorized: invalid node API key' });
  }

  const projectId = request.headers['x-project-id'] as string;
  const projectSchema = request.headers['x-project-schema'] as string;
  request.projectId = projectId;
  request.projectSchema = projectSchema;
  request.userId = request.headers['x-user-id'] as string;
  request.userRole = request.headers['x-user-role'] as string;

  const validRoles = ['admin', 'editor', 'viewer'];
  if (request.userRole && !validRoles.includes(request.userRole)) {
    return reply.status(403).send({ error: 'Forbidden: invalid user role' });
  }

  const isSharedNode = request.headers['x-node-shared'] === '1';
  request.isSharedNode = isSharedNode;
  request.quotas = {
    queryTimeout: isSharedNode ? Number(request.headers['x-quota-query-timeout'] || 30000) : 0,
    concurrent: isSharedNode ? Number(request.headers['x-quota-concurrent'] || 10) : 0,
    maxRows: isSharedNode ? Number(request.headers['x-quota-max-rows'] || 1000) : 0,
    maxExport: isSharedNode ? Number(request.headers['x-quota-max-export'] || 10000) : 0,
    maxRecords: isSharedNode ? Number(request.headers['x-quota-max-records'] || 0) : 0,
    maxStorageMb: isSharedNode ? Number(request.headers['x-quota-max-storage-mb'] || 0) : 0,
    maxApiRequests: isSharedNode ? Number(request.headers['x-quota-max-api-requests'] || 0) : 0,
    backupsSizeMb: isSharedNode ? Number(request.headers['x-quota-backups-size-mb'] || 0) : 0,
  };

  const urlProjectId = (request.params as Record<string, string>)?.projectId;
  if (urlProjectId && projectId && urlProjectId !== projectId) {
    return reply.status(403).send({ error: 'Forbidden: project ID mismatch' });
  }

  if (projectId) {
    const cached = projectCache.get(projectId);
    if (cached && cached.expiry > Date.now()) {
      request.projectSchema = cached.db_schema;
    } else {
      const db = request.server.db;
      const project = await db('projects').where({ id: projectId }).select('id', 'db_schema').first();
      if (!project) {
        return reply.status(404).send({ error: 'Project not found on this worker' });
      }
      request.projectSchema = project.db_schema;
      projectCache.set(projectId, { db_schema: project.db_schema, expiry: Date.now() + PROJECT_CACHE_TTL });
    }
  }
}

export function invalidateProjectCache(projectId: string) {
  projectCache.delete(projectId);
}
