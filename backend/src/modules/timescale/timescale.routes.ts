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
        initial_start: z.string().optional(),
      }).optional(),
      materialized_only: z.boolean().optional(),
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
      dry_run: z.boolean().optional(),
    }).parse(request.body);
    return service.addCompressionPolicy(schema, body);
  });

  app.post('/:projectId/timescale/retention-policies', async (request) => {
    const schema = resolveSchema(request);
    const body = z.object({
      table: z.string().min(1),
      drop_after: z.string().min(1),
      dry_run: z.boolean().optional(),
    }).parse(request.body);
    return service.addRetentionPolicy(schema, body);
  });

  app.get('/:projectId/timescale/retention-policies', async (request) => {
    const schema = resolveSchema(request);
    return { policies: await service.listRetentionPolicies(schema) };
  });

  app.get('/:projectId/timescale/compression-policies', async (request) => {
    const schema = resolveSchema(request);
    return { policies: await service.listCompressionPolicies(schema) };
  });

  app.post('/:projectId/timescale/continuous-aggregates/refresh', async (request) => {
    const schema = resolveSchema(request);
    const body = z.object({
      view_name: z.string().min(1),
      window_start: z.string().nullable().optional(),
      window_end: z.string().nullable().optional(),
      wait: z.boolean().optional(),
      statement_timeout_ms: z.number().int().min(5_000).max(1_800_000).optional(),
    }).parse(request.body);
    return service.refreshContinuousAggregate(schema, body);
  });

  app.delete('/:projectId/timescale/retention-policies/:table', async (request) => {
    const schema = resolveSchema(request);
    const { table } = request.params as { table: string };
    return service.removeRetentionPolicy(schema, table);
  });

  app.delete('/:projectId/timescale/compression-policies/:table', async (request) => {
    const schema = resolveSchema(request);
    const { table } = request.params as { table: string };
    return service.removeCompressionPolicy(schema, table);
  });

  app.delete('/:projectId/timescale/continuous-aggregates/:viewName/policy', async (request) => {
    const schema = resolveSchema(request);
    const { viewName } = request.params as { viewName: string };
    return service.removeContinuousAggregatePolicy(schema, viewName);
  });

  app.put('/:projectId/timescale/retention-policies', async (request) => {
    const schema = resolveSchema(request);
    const body = z.object({
      table: z.string().min(1),
      drop_after: z.string().min(1),
    }).parse(request.body);
    return service.updateRetentionPolicy(schema, body);
  });

  app.put('/:projectId/timescale/compression-policies', async (request) => {
    const schema = resolveSchema(request);
    const body = z.object({
      table: z.string().min(1),
      compress_after: z.string().min(1),
    }).parse(request.body);
    return service.updateCompressionPolicy(schema, body);
  });

  app.put('/:projectId/timescale/continuous-aggregates/:viewName/policy', async (request) => {
    const schema = resolveSchema(request);
    const { viewName } = request.params as { viewName: string };
    const body = z.object({
      start_offset: z.string().min(1),
      end_offset: z.string().min(1),
      schedule_interval: z.string().min(1),
    }).parse(request.body);
    return service.updateContinuousAggregatePolicy(schema, { view_name: viewName, ...body });
  });

  app.delete('/:projectId/timescale/continuous-aggregates/:viewName', async (request) => {
    const schema = resolveSchema(request);
    const { viewName } = request.params as { viewName: string };
    const cascade = (request.query as Record<string, string>)?.cascade === 'true';
    return service.dropContinuousAggregate(schema, viewName, cascade);
  });

  app.delete('/:projectId/timescale/hypertables/:table', async (request) => {
    const schema = resolveSchema(request);
    const { table } = request.params as { table: string };
    const cascade = (request.query as Record<string, string>)?.cascade === 'true';
    return service.dropHypertable(schema, table, cascade);
  });

  app.post('/:projectId/timescale/hypertables/:hypertable/drop-chunks', async (request) => {
    const schema = resolveSchema(request);
    const { hypertable } = request.params as { hypertable: string };
    const body = z.object({ older_than: z.string().min(1) }).parse(request.body);
    return service.dropChunks(schema, { hypertable, older_than: body.older_than });
  });

  app.put('/:projectId/timescale/jobs/:jobId', async (request) => {
    const schema = resolveSchema(request);
    const { jobId } = request.params as { jobId: string };
    const body = z.object({
      schedule_interval: z.string().optional(),
      next_start: z.string().optional(),
    }).parse(request.body);
    return service.alterTimescaleJob(schema, { job_id: Number(jobId), ...body });
  });

  app.post('/:projectId/timescale/jobs/:jobId/run', async (request) => {
    const schema = resolveSchema(request);
    const { jobId } = request.params as { jobId: string };
    return service.runTimescaleJob(schema, { job_id: Number(jobId) });
  });

  app.post('/:projectId/timescale/chunks/:chunkName/compress', async (request) => {
    const schema = resolveSchema(request);
    const { chunkName } = request.params as { chunkName: string };
    const body = z.object({ if_not_compressed: z.boolean().optional() }).parse(request.body ?? {});
    return service.compressChunk(schema, { chunk_name: chunkName, ...body });
  });

  app.post('/:projectId/timescale/chunks/:chunkName/decompress', async (request) => {
    const schema = resolveSchema(request);
    const { chunkName } = request.params as { chunkName: string };
    const body = z.object({ if_compressed: z.boolean().optional() }).parse(request.body ?? {});
    return service.decompressChunk(schema, { chunk_name: chunkName, ...body });
  });

  app.post('/:projectId/timescale/chunks/:chunkName/recompress', async (request) => {
    const schema = resolveSchema(request);
    const { chunkName } = request.params as { chunkName: string };
    return service.recompressChunk(schema, { chunk_name: chunkName });
  });

  app.put('/:projectId/timescale/hypertables/:hypertable/chunk-interval', async (request) => {
    const schema = resolveSchema(request);
    const { hypertable } = request.params as { hypertable: string };
    const body = z.object({ new_interval: z.string().min(1) }).parse(request.body);
    return service.setChunkTimeInterval(schema, { hypertable, new_interval: body.new_interval });
  });
}
