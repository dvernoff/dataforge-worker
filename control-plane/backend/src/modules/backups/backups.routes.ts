import type { FastifyInstance } from 'fastify';
import { BackupsService } from './backups.service.js';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { requireRole } from '../../middleware/rbac.middleware.js';
import * as fs from 'fs';

export async function backupsRoutes(app: FastifyInstance) {
  const backupsService = new BackupsService(app.db);

  app.addHook('preHandler', authMiddleware);

  // GET /api/projects/:projectId/backups — list backups
  app.get('/:projectId/backups', {
    preHandler: [requireRole('viewer')],
  }, async (request) => {
    const { projectId } = request.params as { projectId: string };
    const backups = await backupsService.listBackups(projectId);
    return { backups };
  });

  // POST /api/projects/:projectId/backups — trigger backup (admin)
  app.post('/:projectId/backups', {
    preHandler: [requireRole('admin')],
  }, async (request) => {
    const { projectId } = request.params as { projectId: string };
    const { tables } = (request.body as { tables?: string[] }) ?? {};
    const backup = await backupsService.createBackup(projectId, request.user.id, tables);
    return { backup };
  });

  // GET /api/projects/:projectId/backups/:backupId/download — download backup file
  app.get('/:projectId/backups/:backupId/download', {
    preHandler: [requireRole('admin')],
  }, async (request, reply) => {
    const { projectId, backupId } = request.params as { projectId: string; backupId: string };
    const { filePath, filename } = await backupsService.getBackupFilePath(backupId, projectId);

    const stream = fs.createReadStream(filePath);
    return reply
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .header('Content-Type', 'application/json')
      .send(stream);
  });

  // POST /api/projects/:projectId/backups/:backupId/restore — restore from backup (admin)
  app.post('/:projectId/backups/:backupId/restore', {
    preHandler: [requireRole('admin')],
  }, async (request) => {
    const { projectId, backupId } = request.params as { projectId: string; backupId: string };
    const result = await backupsService.restoreBackup(backupId, projectId);
    return result;
  });

  // DELETE /api/projects/:projectId/backups/:backupId — delete (admin)
  app.delete('/:projectId/backups/:backupId', {
    preHandler: [requireRole('admin')],
  }, async (request, reply) => {
    const { projectId, backupId } = request.params as { projectId: string; backupId: string };
    await backupsService.deleteBackup(backupId, projectId);
    return reply.status(204).send();
  });

  // GET /api/projects/:projectId/backups/schedule — get schedule
  app.get('/:projectId/backups/schedule', {
    preHandler: [requireRole('viewer')],
  }, async (request) => {
    const { projectId } = request.params as { projectId: string };
    const schedule = await backupsService.getSchedule(projectId);
    return { schedule };
  });

  // PUT /api/projects/:projectId/backups/schedule — update schedule (admin)
  app.put('/:projectId/backups/schedule', {
    preHandler: [requireRole('admin')],
  }, async (request) => {
    const { projectId } = request.params as { projectId: string };
    const body = request.body as {
      cron_expression?: string;
      is_active?: boolean;
      max_backups?: number;
    };
    const schedule = await backupsService.updateSchedule(projectId, body);
    return { schedule };
  });
}
