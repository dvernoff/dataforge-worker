import type { FastifyInstance } from 'fastify';
import { BackupsService } from './backups.service.js';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { requireRole } from '../../middleware/rbac.middleware.js';
import * as fs from 'fs';

export async function backupsRoutes(app: FastifyInstance) {
  const backupsService = new BackupsService(app.db, app.redis);

  app.addHook('preHandler', authMiddleware);

  app.get('/:projectId/backups', {
    preHandler: [requireRole('viewer')],
  }, async (request) => {
    const { projectId } = request.params as { projectId: string };
    const backups = await backupsService.listBackups(projectId);
    return { backups };
  });

  app.get('/:projectId/backups/stats', {
    preHandler: [requireRole('viewer')],
  }, async (request) => {
    const { projectId } = request.params as { projectId: string };
    return backupsService.getStats(projectId);
  });

  app.post('/:projectId/backups', {
    preHandler: [requireRole('admin')],
  }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    try {
      const backup = await backupsService.createBackup(projectId, request.user.id, 'manual');
      const schedule = await backupsService.getSchedule(projectId);
      if (schedule?.max_backups) {
        await backupsService.rotateBackups(projectId, schedule.max_backups);
      }
      return { backup };
    } catch (err: any) {
      if (err.message?.includes('limit reached')) {
        return reply.status(429).send({ error: err.message });
      }
      throw err;
    }
  });

  app.get('/:projectId/backups/:backupId/download', {
    preHandler: [requireRole('admin')],
  }, async (request, reply) => {
    const { projectId, backupId } = request.params as { projectId: string; backupId: string };
    const { filePath, filename } = await backupsService.getBackupFilePath(backupId, projectId);

    const stream = fs.createReadStream(filePath);
    const contentType = filename.endsWith('.gz') ? 'application/gzip' : 'application/json';
    return reply
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .header('Content-Type', contentType)
      .send(stream);
  });

  app.post('/:projectId/backups/:backupId/restore', {
    preHandler: [requireRole('admin')],
  }, async (request) => {
    const { projectId, backupId } = request.params as { projectId: string; backupId: string };
    return backupsService.restoreBackup(backupId, projectId);
  });

  // Import backup from uploaded file (100MB limit)
  app.post('/:projectId/backups/import', {
    preHandler: [requireRole('admin')],
    config: { rawBody: false },
    bodyLimit: 100 * 1024 * 1024,
  }, async (request) => {
    const { projectId } = request.params as { projectId: string };
    const body = request.body as { data: string; filename?: string };
    if (!body.data) throw new Error('Missing backup data');
    const backup = await backupsService.importBackup(projectId, request.user.id, body.data, body.filename);
    return { backup };
  });

  app.delete('/:projectId/backups/:backupId', {
    preHandler: [requireRole('admin')],
  }, async (request, reply) => {
    const { projectId, backupId } = request.params as { projectId: string; backupId: string };
    await backupsService.deleteBackup(backupId, projectId);
    return reply.status(204).send();
  });

  app.get('/:projectId/backups/schedule', {
    preHandler: [requireRole('viewer')],
  }, async (request) => {
    const { projectId } = request.params as { projectId: string };
    const schedule = await backupsService.getSchedule(projectId);
    return { schedule };
  });

  app.put('/:projectId/backups/schedule', {
    preHandler: [requireRole('admin')],
  }, async (request) => {
    const { projectId } = request.params as { projectId: string };
    const body = request.body as {
      interval?: string;
      is_active?: boolean;
      max_backups?: number;
    };
    const schedule = await backupsService.updateSchedule(projectId, body);
    return { schedule };
  });
}
