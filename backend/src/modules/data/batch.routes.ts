import type { FastifyInstance } from 'fastify';
import { BatchService } from './batch.service.js';
import { nodeAuthMiddleware } from '../../middleware/node-auth.middleware.js';
import { requireWorkerRole } from '../../middleware/worker-rbac.middleware.js';
import { AppError } from '../../middleware/error-handler.js';
import { z } from 'zod';

function resolveProjectSchema(request: any): string {
  const schema = request.projectSchema;
  if (!schema) throw new AppError(400, 'Missing project schema header');
  return schema;
}

const batchBodySchema = z.object({
  operations: z.array(z.object({
    method: z.enum(['insert', 'update', 'delete']),
    table: z.string().min(1),
    id: z.string().optional(),
    data: z.record(z.unknown()).optional(),
  })).min(1).max(500),
  transaction: z.boolean().default(false),
});

export async function batchRoutes(app: FastifyInstance) {
  const batchService = new BatchService(app.db);

  app.addHook('preHandler', nodeAuthMiddleware);
  app.addHook('preHandler', requireWorkerRole('viewer'));

  app.post('/:projectId/batch', async (request) => {
    const dbSchema = resolveProjectSchema(request);
    const body = batchBodySchema.parse(request.body);

    const results = await batchService.executeBatch(
      dbSchema,
      body.operations,
      body.transaction
    );

    return { results };
  });
}
