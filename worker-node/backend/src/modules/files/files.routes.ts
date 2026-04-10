import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { FilesService } from './files.service.js';
import { nodeAuthMiddleware } from '../../middleware/node-auth.middleware.js';
import { requireWorkerRole } from '../../middleware/worker-rbac.middleware.js';
import { AppError } from '../../middleware/error-handler.js';
import { checkStorageQuota, reportQuotaViolation } from '../../middleware/quota-enforcement.middleware.js';

export async function filesRoutes(app: FastifyInstance) {
  await app.register(multipart, {
    limits: {
      fileSize: 50 * 1024 * 1024,
    },
  });

  const filesService = new FilesService(app.db);

  app.addHook('preHandler', nodeAuthMiddleware);
  app.addHook('preHandler', requireWorkerRole('viewer'));

  app.post('/:projectId/files/upload', async (request, reply) => {
    const { projectId } = request.params as { projectId: string };

    if (request.isSharedNode && request.quotas?.maxStorageMb > 0) {
      const dbSchema = request.projectSchema;
      const blocked = await checkStorageQuota(app.redis, app.db, projectId, dbSchema, request.quotas.maxStorageMb, request.quotas.backupsSizeMb);
      if (blocked) {
        reportQuotaViolation(projectId, request.userId, 'quota.storage_exceeded', { limit: request.quotas.maxStorageMb });
        return reply.status(429).send({ error: blocked, errorCode: 'QUOTA_EXCEEDED' });
      }
    }

    const data = await request.file();
    if (!data) {
      throw new AppError(400, 'No file uploaded');
    }

    const tableName = (data.fields.table_name as any)?.value as string;
    const recordId = (data.fields.record_id as any)?.value as string;
    const columnName = (data.fields.column_name as any)?.value as string;

    if (!tableName || !recordId || !columnName) {
      throw new AppError(400, 'table_name, record_id, and column_name are required');
    }

    const buffer = await data.toBuffer();

    const file = await filesService.upload(projectId, tableName, recordId, columnName, {
      filename: data.filename,
      mimetype: data.mimetype,
      data: buffer,
    });

    return { file };
  });

  app.get('/:projectId/files/:fileId', async (request, reply) => {
    const { projectId, fileId } = request.params as { projectId: string; fileId: string };

    const { record, data } = await filesService.download(projectId, fileId);

    reply
      .header('Content-Type', record.mime_type)
      .header('Content-Disposition', `attachment; filename="${record.original_name.replace(/[^\w.\-]/g, '_')}"`)
      .header('Content-Length', data.length)
      .header('X-Content-Type-Options', 'nosniff');

    return reply.send(data);
  });

  app.delete('/:projectId/files/:fileId', async (request, reply) => {
    const { projectId, fileId } = request.params as { projectId: string; fileId: string };
    await filesService.delete(projectId, fileId);
    return reply.status(204).send();
  });

  app.get('/:projectId/files', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const query = request.query as Record<string, string>;

    if (!query.table || !query.record) {
      throw new AppError(400, 'table and record query params are required');
    }

    const files = await filesService.listForRecord(projectId, query.table, query.record);
    return { files };
  });
}
