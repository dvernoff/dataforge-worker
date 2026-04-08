import type { Knex } from 'knex';
import type { Redis } from 'ioredis';
import { BackupsService } from './backups.service.js';

const INTERVAL_MS: Record<string, number> = {
  '12h': 12 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '48h': 48 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

const CHECK_INTERVAL = 5 * 60 * 1000;

export class BackupScheduler {
  private timer: NodeJS.Timeout | null = null;
  private service: BackupsService;

  constructor(private db: Knex, redis: Redis) {
    this.service = new BackupsService(db, redis);
  }

  start() {
    this.timer = setInterval(() => this.tick(), CHECK_INTERVAL);
    setTimeout(() => this.tick(), 10_000);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick() {
    try {
      const schedules = await this.db('backup_schedules')
        .where({ is_active: true })
        .whereNotNull('cron_expression');

      for (const schedule of schedules) {
        try {
          await this.processSchedule(schedule);
        } catch (err) {
          console.error(`[BackupScheduler] Error processing schedule ${schedule.id}:`, err);
        }
      }

      await this.cleanupExpiredBackups();
    } catch (err) {
      console.error('[BackupScheduler] Tick error:', err);
    }
  }

  private async cleanupExpiredBackups() {
    try {
      let retentionDays = 14;
      try {
        const setting = await this.db('system_settings').where({ key: 'backup_retention_days' }).first();
        if (setting?.value) retentionDays = Math.max(1, Number(setting.value));
      } catch {}

      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - retentionDays);

      const expired = await this.db('backups')
        .where('created_at', '<', cutoff.toISOString())
        .where('status', 'completed')
        .select('id', 'file_path');

      if (expired.length === 0) return;

      const fs = await import('fs');
      for (const backup of expired) {
        try {
          if (backup.file_path && fs.existsSync(backup.file_path)) {
            fs.unlinkSync(backup.file_path);
          }
        } catch {}
      }

      await this.db('backups')
        .whereIn('id', expired.map((b: { id: string }) => b.id))
        .delete();

      if (expired.length > 0) {
        console.log(`[BackupScheduler] Cleaned up ${expired.length} expired backups (older than ${retentionDays} days)`);
      }
    } catch (err) {
      console.error('[BackupScheduler] Backup cleanup error:', err);
    }
  }

  private async processSchedule(schedule: any) {
    const intervalKey = schedule.cron_expression;
    const intervalMs = INTERVAL_MS[intervalKey];
    if (!intervalMs) return;

    const lastRun = schedule.last_run_at ? new Date(schedule.last_run_at).getTime() : 0;
    const now = Date.now();

    if (now - lastRun < intervalMs) return;

    console.log(`[BackupScheduler] Running scheduled backup for project ${schedule.project_id}`);

    await this.service.createBackup(schedule.project_id, null, 'scheduled');

    await this.db('backup_schedules')
      .where({ id: schedule.id })
      .update({ last_run_at: new Date() });

    await this.service.rotateBackups(schedule.project_id, schedule.max_backups ?? 5);
  }
}
