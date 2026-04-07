import type { FastifyInstance } from 'fastify';
import { GraphQLService } from './graphql.service.js';
import { AppError } from '../../middleware/error-handler.js';
import crypto from 'crypto';

export async function graphqlRoutes(app: FastifyInstance) {
  const graphqlService = new GraphQLService(app.db);

  app.all('/api/v1/:projectSlug/graphql', async (request, reply) => {
    const { projectSlug } = request.params as { projectSlug: string };

    const project = await app.db('projects').where({ slug: projectSlug }).first();
    if (!project) return reply.status(404).send({ error: 'Project not found' });

    const apiKey = request.headers['x-api-key'] as string | undefined;
    if (!apiKey) {
      return reply.status(401).send({ error: 'API key required. Pass X-API-Key header.' });
    }

    const tokenHash = crypto.createHash('sha256').update(apiKey).digest('hex');
    const cached = await app.redis.get(`api_token:${tokenHash}`);
    if (!cached) {
      return reply.status(401).send({ error: 'Invalid API key' });
    }

    const tokenData = JSON.parse(cached);
    if (tokenData.project_id !== project.id) {
      return reply.status(401).send({ error: 'API key does not belong to this project' });
    }

    if (tokenData.expires_at && new Date(tokenData.expires_at) < new Date()) {
      return reply.status(401).send({ error: 'API key expired' });
    }

    if (tokenData.allowed_ips && Array.isArray(tokenData.allowed_ips) && tokenData.allowed_ips.length > 0) {
      const clientIp = request.headers['x-forwarded-for']
        ? (request.headers['x-forwarded-for'] as string).split(',')[0].trim()
        : request.ip;
      if (!tokenData.allowed_ips.includes(clientIp)) {
        return reply.status(403).send({ error: 'IP address not allowed' });
      }
    }

    let query: string | undefined;
    let variables: Record<string, unknown> | undefined;

    if (request.method === 'POST') {
      const body = request.body as Record<string, unknown>;
      query = body.query as string;
      variables = body.variables as Record<string, unknown> | undefined;
    } else {
      const qs = request.query as Record<string, string>;
      query = qs.query;
      if (qs.variables) {
        try { variables = JSON.parse(qs.variables); } catch { }
      }
    }

    if (!query) {
      return reply.status(400).send({ error: 'Query is required' });
    }

    try {
      const result = await graphqlService.executeQuery(project.db_schema, query, variables, 30_000);
      return result;
    } catch (err) {
      const error = err as Error;
      return reply.status(400).send({ errors: [{ message: error.message }] });
    }
  });
}
