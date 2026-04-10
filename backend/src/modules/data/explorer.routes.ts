import type { FastifyInstance } from 'fastify';
import { ExplorerService } from './explorer.service.js';
import { nodeAuthMiddleware } from '../../middleware/node-auth.middleware.js';
import { requireWorkerRole } from '../../middleware/worker-rbac.middleware.js';
import { AppError } from '../../middleware/error-handler.js';
import { z } from 'zod';

function resolveProjectSchema(request: any): string {
  const schema = request.projectSchema;
  if (!schema) throw new AppError(400, 'Missing project schema header');
  return schema;
}

const pivotSchema = z.object({
  table: z.string().min(1),
  rows: z.array(z.string()).min(1),
  columns: z.string().optional(),
  values: z.string().min(1),
  aggregation: z.enum(['count', 'sum', 'avg', 'min', 'max']),
});

export async function explorerRoutes(app: FastifyInstance) {
  const explorerService = new ExplorerService();

  app.addHook('preHandler', nodeAuthMiddleware);
  app.addHook('preHandler', requireWorkerRole('viewer'));

  app.post('/:projectId/explorer/pivot', async (request) => {
    const dbSchema = resolveProjectSchema(request);
    const config = pivotSchema.parse(request.body);

    const result = await explorerService.executePivot(app.db, dbSchema, config);
    return result;
  });

  app.get('/:projectId/explorer/tables', async (request) => {
    const dbSchema = resolveProjectSchema(request);
    const tables = await explorerService.listTables(app.db, dbSchema);
    return { tables };
  });
}
