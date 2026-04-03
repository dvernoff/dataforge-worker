import type { FastifyRequest, FastifyReply } from 'fastify';
import { env } from '../config/env.js';

// Cache of schemas and projects we've already verified exist in this process lifetime
const verifiedSchemas = new Set<string>();
const verifiedProjects = new Set<string>();

export async function nodeAuthMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const apiKey = request.headers['x-node-api-key'] as string;
  if (!apiKey || apiKey !== env.NODE_API_KEY) {
    return reply.status(401).send({ error: 'Unauthorized: invalid node API key' });
  }

  // Attach project context from CP proxy headers
  const projectId = request.headers['x-project-id'] as string;
  const projectSchema = request.headers['x-project-schema'] as string;
  const projectSlug = request.headers['x-project-slug'] as string;
  request.projectId = projectId;
  request.projectSchema = projectSchema;
  request.userId = request.headers['x-user-id'] as string;
  request.userRole = request.headers['x-user-role'] as string;

  // Attach quota limits from CP proxy (only enforced on shared nodes)
  const isSharedNode = request.headers['x-node-shared'] === '1';
  request.isSharedNode = isSharedNode;
  request.quotas = {
    queryTimeout: isSharedNode ? Number(request.headers['x-quota-query-timeout'] || 30000) : 0,
    concurrent: isSharedNode ? Number(request.headers['x-quota-concurrent'] || 10) : 0,
    maxRows: isSharedNode ? Number(request.headers['x-quota-max-rows'] || 1000) : 0,
    maxExport: isSharedNode ? Number(request.headers['x-quota-max-export'] || 10000) : 0,
  };

  const db = request.server.db;
  const schemaRegex = /^[a-z_][a-z0-9_]*$/;

  // Auto-provision: ensure the project schema exists in PostgreSQL
  if (projectSchema && !verifiedSchemas.has(projectSchema)) {
    if (schemaRegex.test(projectSchema)) {
      await db.raw(`CREATE SCHEMA IF NOT EXISTS "${projectSchema}"`);
      verifiedSchemas.add(projectSchema);
    }
  }

  // Auto-provision: ensure the project record exists in the worker's projects table
  if (projectId && projectSlug && projectSchema && !verifiedProjects.has(projectId)) {
    await db('projects')
      .insert({ id: projectId, slug: projectSlug, db_schema: projectSchema, settings: '{}' })
      .onConflict('id')
      .ignore();
    verifiedProjects.add(projectId);
  }
}
