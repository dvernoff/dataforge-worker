import type { FastifyInstance } from 'fastify';
import { GraphQLService } from './graphql.service.js';
import { nodeAuthMiddleware } from '../../middleware/node-auth.middleware.js';
import { requireWorkerRole } from '../../middleware/worker-rbac.middleware.js';
import { AppError } from '../../middleware/error-handler.js';
import { isModuleEnabled, moduleDisabledError } from '../../utils/module-check.js';

function resolveProjectSchema(request: any): string {
  const schema = request.projectSchema;
  if (!schema) throw new AppError(400, 'Missing project schema header');
  return schema;
}

export async function graphqlProxyRoutes(app: FastifyInstance) {
  const graphqlService = new GraphQLService(app.db);

  app.addHook('preHandler', nodeAuthMiddleware);
  app.addHook('preHandler', requireWorkerRole('viewer'));

  app.post('/:projectId/graphql', async (request, reply) => {
    const { projectId } = request.params as { projectId: string };

    const graphqlEnabled = await isModuleEnabled(app.db, projectId, 'feature-graphql');
    if (!graphqlEnabled) {
      return reply.status(404).send(moduleDisabledError('GraphQL'));
    }

    const dbSchema = resolveProjectSchema(request);
    const body = request.body as Record<string, unknown>;
    const query = body.query as string;
    const variables = body.variables as Record<string, unknown> | undefined;

    if (!query) {
      return reply.status(400).send({ error: 'Query is required' });
    }

    try {
      const timeout = request.quotas?.queryTimeout || 30_000;
      const result = await graphqlService.executeQuery(dbSchema, query, variables, timeout);
      return result;
    } catch (err) {
      const error = err as Error;
      return reply.status(400).send({ errors: [{ message: error.message }] });
    }
  });
}
