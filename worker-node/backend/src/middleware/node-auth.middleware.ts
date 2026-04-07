import type { FastifyRequest, FastifyReply } from 'fastify';
import { env } from '../config/env.js';

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
  };

  const urlProjectId = (request.params as Record<string, string>)?.projectId;
  if (urlProjectId && projectId && urlProjectId !== projectId) {
    return reply.status(403).send({ error: 'Forbidden: project ID mismatch' });
  }

  if (projectId) {
    const db = request.server.db;
    const project = await db('projects').where({ id: projectId }).select('id', 'db_schema').first();
    if (!project) {
      return reply.status(404).send({ error: 'Project not found on this worker' });
    }
    request.projectSchema = project.db_schema;
  }
}
