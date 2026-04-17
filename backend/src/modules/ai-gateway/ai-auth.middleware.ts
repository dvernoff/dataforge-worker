import type { FastifyRequest, FastifyReply } from 'fastify';
import type { Knex } from 'knex';
import type { Redis } from 'ioredis';
import crypto from 'crypto';
import { isModuleEnabled, moduleDisabledError } from '../../utils/module-check.js';

interface ProjectInfo {
  id: string;
  slug: string;
  db_schema: string;
}

interface TokenData {
  project_id: string;
  scopes?: string[];
  allowed_ips?: string[];
  expires_at?: string;
}

export interface AiAuthenticatedRequest extends FastifyRequest {
  aiProject: ProjectInfo;
  aiTokenData: TokenData;
}

export async function resolveProjectBySlug(db: Knex, slug: string): Promise<ProjectInfo | null> {
  let project = await db('_dataforge_projects').where({ slug }).first().catch(() => null);
  if (!project) project = await db('projects').where({ slug }).first().catch(() => null);
  return project ? { id: project.id, slug: project.slug, db_schema: project.db_schema } : null;
}

export async function authenticateAiRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  db: Knex,
  redis: Redis,
  pluginId: 'ai-rest-gateway' | 'ai-mcp-server' | 'ai-studio',
): Promise<{ project: ProjectInfo; tokenData: TokenData } | null> {
  const { projectSlug } = request.params as { projectSlug: string };

  const project = await resolveProjectBySlug(db, projectSlug);
  if (!project) {
    reply.status(404).send({ error: 'Project not found' });
    return null;
  }

  const isDisabled = await redis.get(`project_disabled:${project.id}`);
  if (isDisabled) {
    reply.status(503).send({ error: 'Project is disabled', errorCode: 'PROJECT_DISABLED' });
    return null;
  }

  const enabled = await isModuleEnabled(db, project.id, pluginId);
  if (!enabled) {
    reply.status(404).send(moduleDisabledError(pluginId === 'ai-rest-gateway' ? 'AI REST Gateway' : 'AI MCP Server'));
    return null;
  }

  const apiKey = request.headers['x-api-key'] as string | undefined;
  if (!apiKey) {
    reply.status(401).send({ error: 'API key required. Pass x-api-key header.' });
    return null;
  }

  const tokenHash = crypto.createHash('sha256').update(apiKey).digest('hex');
  const cached = await redis.get(`api_token:${tokenHash}`);
  if (!cached) {
    reply.status(401).send({ error: 'Invalid API key' });
    return null;
  }

  const tokenData: TokenData = JSON.parse(cached);

  if (tokenData.project_id !== project.id) {
    reply.status(401).send({ error: 'API key does not belong to this project' });
    return null;
  }

  if (tokenData.expires_at && new Date(tokenData.expires_at) < new Date()) {
    reply.status(401).send({ error: 'API key expired' });
    return null;
  }

  if (tokenData.allowed_ips && Array.isArray(tokenData.allowed_ips) && tokenData.allowed_ips.length > 0) {
    const clientIp = request.headers['x-forwarded-for']
      ? (request.headers['x-forwarded-for'] as string).split(',')[0].trim()
      : request.ip;
    if (!tokenData.allowed_ips.includes(clientIp)) {
      reply.status(403).send({ error: 'IP address not allowed' });
      return null;
    }
  }

  return { project, tokenData };
}
