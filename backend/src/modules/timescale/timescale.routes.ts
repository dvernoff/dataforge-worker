import type { FastifyInstance } from 'fastify';
import { TimescaleService } from './timescale.service.js';
import { nodeAuthMiddleware } from '../../middleware/node-auth.middleware.js';
import { requireWorkerRole } from '../../middleware/worker-rbac.middleware.js';
import { AppError } from '../../middleware/error-handler.js';
import { z } from 'zod';

function resolveSchema(request: any): string {
  const schema = request.projectSchema;
  if (!schema) throw new AppError(400, 'Missing project schema');
  return schema;
}

export async function timescaleRoutes(app: FastifyInstance) {
  const service = new TimescaleService(app.db);

  app.addHook('preHandler', nodeAuthMiddleware);
  app.addHook('preHandler', requireWorkerRole('editor'));

  app.get('/:projectId/timescale/status', async (request) => {
    resolveSchema(request);
    return { available: await service.isAvailable() };
  });

  app.get('/:projectId/timescale/hypertables', async (request) => {
    const schema = resolveSchema(request);
    return { hypertables: await service.listHypertables(schema) };
  });

  app.get('/:projectId/timescale/continuous-aggregates', async (request) => {
    const schema = resolveSchema(request);
    return { aggregates: await service.listContinuousAggregates(schema) };
  });

  app.get('/:projectId/timescale/jobs', async (request) => {
    const schema = resolveSchema(request);
    return { jobs: await service.listJobs(schema) };
  });

  app.post('/:projectId/timescale/hypertables', async (request) => {
    const schema = resolveSchema(request);
    const body = z.object({
      table: z.string().min(1),
      time_column: z.string().min(1),
      chunk_time_interval: z.string().optional(),
    }).parse(request.body);
    return service.createHypertable(schema, body);
  });

  app.post('/:projectId/timescale/continuous-aggregates', async (request) => {
    const schema = resolveSchema(request);
    const body = z.object({
      view_name: z.string().min(1),
      source_table: z.string().min(1),
      time_column: z.string().min(1),
      time_bucket: z.string().min(1),
      aggregations: z.array(z.object({
        column: z.string(),
        function: z.string(),
        alias: z.string().optional(),
      })).min(1),
      group_by: z.array(z.string()).optional(),
      refresh_policy: z.object({
        start_offset: z.string(),
        end_offset: z.string(),
        schedule_interval: z.string(),
      }).optional(),
    }).parse(request.body);
    return service.addContinuousAggregate(schema, body);
  });

  app.post('/:projectId/timescale/compression-policies', async (request) => {
    const schema = resolveSchema(request);
    const body = z.object({
      table: z.string().min(1),
      compress_after: z.string().min(1),
      segment_by: z.array(z.string()).optional(),
      order_by: z.string().optional(),
    }).parse(request.body);
    return service.addCompressionPolicy(schema, body);
  });

  app.post('/:projectId/timescale/retention-policies', async (request) => {
    const schema = resolveSchema(request);
    const body = z.object({
      table: z.string().min(1),
      drop_after: z.string().min(1),
    }).parse(request.body);
    return service.addRetentionPolicy(schema, body);
  });
}
