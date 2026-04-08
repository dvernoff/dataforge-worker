import type { Knex } from 'knex';
import type { Redis } from 'ioredis';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { ProxyService } from '../proxy/proxy.service.js';

const BACKUP_DIR = path.join(process.cwd(), 'backups');
const MANUAL_DAILY_LIMIT = 2;

export class BackupsService {
  private proxyService: ProxyService;

  constructor(private db: Knex, redis: Redis) {
    this.proxyService = new ProxyService(db, redis);
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  async listBackups(projectId: string) {
    return this.db('backups')
      .where({ project_id: projectId })
      .orderBy('created_at', 'desc');
  }

  async getStats(projectId: string) {
    const stats = await this.db('backups')
      .where({ project_id: projectId, status: 'completed' })
      .select(
        this.db.raw('COUNT(*)::int as count'),
        this.db.raw('COALESCE(SUM(file_size), 0)::bigint as total_size'),
      )
      .first();

    const manualToday = await this.db('backups')
      .where({ project_id: projectId, type: 'manual' })
      .where('created_at', '>=', this.db.raw("NOW() - INTERVAL '24 hours'"))
      .where('status', '!=', 'failed')
      .count('id as count')
      .first();

    const schedule = await this.db('backup_schedules')
      .where({ project_id: projectId })
      .first();

    return {
      count: Number(stats?.count ?? 0),
      totalSize: Number(stats?.total_size ?? 0),
      manualToday: Number(manualToday?.count ?? 0),
      manualLimit: MANUAL_DAILY_LIMIT,
      maxBackups: schedule?.max_backups ?? 10,
    };
  }

  async createBackup(projectId: string, userId: string | null, type: 'manual' | 'scheduled' = 'manual') {
    if (type === 'manual') {
      const todayCount = await this.db('backups')
        .where({ project_id: projectId, type: 'manual' })
        .where('created_at', '>=', this.db.raw("NOW() - INTERVAL '24 hours'"))
        .where('status', '!=', 'failed')
        .count('id as count')
        .first();
      if (Number(todayCount?.count ?? 0) >= MANUAL_DAILY_LIMIT) {
        throw new Error('Daily manual backup limit reached (max 2 per day)');
      }
    }

    const [backup] = await this.db('backups')
      .insert({
        project_id: projectId,
        type,
        status: 'running',
        created_by: userId,
        started_at: this.db.fn.now(),
      })
      .returning('*');

    try {
      const worker = await this.proxyService.getWorkerForProject(projectId);
      const workerPath = `/api/projects/${projectId}/backups/export-data`;

      const result = await this.proxyService.forwardToWorker(
        worker.url,
        worker.apiKey,
        'GET',
        workerPath,
        { 'x-user-role': 'admin' },
        null,
        projectId,
        worker.schema,
      );

      if (result.status !== 200) {
        throw new Error(`Worker returned ${result.status}: ${JSON.stringify(result.body)}`);
      }

      const exportData = result.body as { tables: string[]; data: Record<string, unknown[]>; exportedAt: string };

      const jsonStr = JSON.stringify(exportData);
      const compressed = zlib.gzipSync(jsonStr);

      const filename = `backup_${projectId}_${backup.id}.json.gz`;
      const filePath = path.join(BACKUP_DIR, filename);
      fs.writeFileSync(filePath, compressed);

      const fileSize = compressed.length;

      await this.db('backups')
        .where({ id: backup.id })
        .update({
          status: 'completed',
          file_path: filePath,
          file_size: fileSize,
          metadata: JSON.stringify({ tables: exportData.tables }),
          completed_at: this.db.fn.now(),
        });

      return { ...backup, status: 'completed', file_path: filePath, file_size: fileSize, metadata: JSON.stringify({ tables: exportData.tables }) };
    } catch (err: any) {
      await this.db('backups')
        .where({ id: backup.id })
        .update({ status: 'failed', error: err.message ?? 'Unknown error' });
      throw err;
    }
  }

  async rotateBackups(projectId: string, maxBackups: number) {
    const completed = await this.db('backups')
      .where({ project_id: projectId, status: 'completed' })
      .orderBy('created_at', 'desc');

    if (completed.length > maxBackups) {
      const toDelete = completed.slice(maxBackups);
      for (const b of toDelete) {
        await this.deleteBackup(b.id, projectId);
      }
    }
  }

  async importBackup(projectId: string, userId: string, base64Data: string, filename?: string) {
    const MAX_DECOMPRESSED = 500 * 1024 * 1024;
    const buffer = Buffer.from(base64Data, 'base64');

    let jsonStr: string;
    try {
      const decompressed = zlib.gunzipSync(buffer);
      if (decompressed.length > MAX_DECOMPRESSED) throw new Error('Decompressed backup exceeds 500 MB limit');
      jsonStr = decompressed.toString('utf-8');
    } catch (e: any) {
      if (e.message?.includes('limit')) throw e;
      jsonStr = buffer.toString('utf-8');
    }

    if (jsonStr.length > MAX_DECOMPRESSED) throw new Error('Backup file exceeds 500 MB limit');

    const parsed = JSON.parse(jsonStr);
    if (!parsed.data || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) {
      throw new Error('Invalid backup file format: expected { data: { tableName: [...rows] } }');
    }

    const safeNameRe = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
    const tables: string[] = (parsed.tables ?? Object.keys(parsed.data)).filter((t: string) => safeNameRe.test(t));
    const safeFilename = (filename ?? 'import').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
    const compressed = zlib.gzipSync(jsonStr);

    const backupDir = path.join(process.cwd(), 'backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

    const [backup] = await this.db('backups')
      .insert({
        project_id: projectId,
        type: 'manual',
        status: 'completed',
        created_by: userId,
        started_at: this.db.fn.now(),
        completed_at: this.db.fn.now(),
        file_size: compressed.length,
        metadata: JSON.stringify({ tables, imported: true, originalFilename: safeFilename }),
      })
      .returning('*');

    const filePath = path.join(backupDir, `backup_${projectId}_${backup.id}.json.gz`);
    fs.writeFileSync(filePath, compressed);

    await this.db('backups')
      .where({ id: backup.id })
      .update({ file_path: filePath });

    return { ...backup, file_path: filePath };
  }

  async restoreBackup(backupId: string, projectId: string) {
    const backup = await this.db('backups')
      .where({ id: backupId, project_id: projectId })
      .first();
    if (!backup) throw new Error('Backup not found');
    if (backup.status !== 'completed') throw new Error('Backup is not completed');
    if (!backup.file_path) throw new Error('Backup file not found');
    if (!fs.existsSync(backup.file_path)) throw new Error('Backup file missing from disk');

    const raw = fs.readFileSync(backup.file_path);
    let jsonStr: string;
    try {
      jsonStr = zlib.gunzipSync(raw).toString('utf-8');
    } catch {
      jsonStr = raw.toString('utf-8');
    }

    const parsed = JSON.parse(jsonStr);
    const data: Record<string, any[]> = parsed.data ?? parsed;
    const schema = parsed.schema ?? undefined;

    const worker = await this.proxyService.getWorkerForProject(projectId);
    const workerPath = `/api/projects/${projectId}/backups/restore-data`;

    const result = await this.proxyService.forwardToWorker(
      worker.url,
      worker.apiKey,
      'POST',
      workerPath,
      { 'content-type': 'application/json', 'x-user-role': 'admin' },
      { data, schema },
      projectId,
      worker.schema,
    );

    if (result.status !== 200) {
      throw new Error(`Worker restore failed: ${JSON.stringify(result.body)}`);
    }

    return { success: true };
  }

  async getBackupFilePath(backupId: string, projectId: string) {
    const backup = await this.db('backups')
      .where({ id: backupId, project_id: projectId })
      .first();
    if (!backup) throw new Error('Backup not found');
    if (backup.status !== 'completed') throw new Error('Backup is not completed');
    if (!backup.file_path) throw new Error('Backup file not found');
    if (!fs.existsSync(backup.file_path)) throw new Error('Backup file missing from disk');
    return { filePath: backup.file_path, filename: path.basename(backup.file_path) };
  }

  async deleteBackup(id: string, projectId: string) {
    const backup = await this.db('backups')
      .where({ id, project_id: projectId })
      .first();
    if (backup?.file_path && fs.existsSync(backup.file_path)) {
      fs.unlinkSync(backup.file_path);
    }
    const deleted = await this.db('backups')
      .where({ id, project_id: projectId })
      .delete();
    return deleted > 0;
  }

  async getSchedule(projectId: string) {
    return (await this.db('backup_schedules').where({ project_id: projectId }).first()) ?? null;
  }

  async updateSchedule(projectId: string, input: {
    interval?: string;
    is_active?: boolean;
    max_backups?: number;
  }) {
    const validIntervals = ['12h', '24h', '48h', '7d'];
    if (input.interval && !validIntervals.includes(input.interval)) {
      throw new Error('Invalid interval. Allowed: 12h, 24h, 48h, 7d');
    }

    const updateData: Record<string, unknown> = {};
    if (input.interval !== undefined) updateData.cron_expression = input.interval;
    if (input.is_active !== undefined) updateData.is_active = input.is_active;
    if (input.max_backups !== undefined) updateData.max_backups = Math.max(2, Math.min(input.max_backups, 20));

    const existing = await this.db('backup_schedules').where({ project_id: projectId }).first();
    if (existing) {
      const [schedule] = await this.db('backup_schedules')
        .where({ project_id: projectId })
        .update(updateData)
        .returning('*');
      return schedule;
    } else {
      const [schedule] = await this.db('backup_schedules')
        .insert({ project_id: projectId, ...updateData })
        .returning('*');
      return schedule;
    }
  }
}
