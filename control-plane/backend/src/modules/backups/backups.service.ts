import type { Knex } from 'knex';
import * as fs from 'fs';
import * as path from 'path';

export class BackupsService {
  constructor(private db: Knex) {}

  async listBackups(projectId: string) {
    const backups = await this.db('backups')
      .where({ project_id: projectId })
      .orderBy('created_at', 'desc');
    return backups;
  }

  async createBackup(projectId: string, userId: string, tables?: string[]) {
    const project = await this.db('projects').where({ id: projectId }).first();
    if (!project) throw new Error('Project not found');

    const [backup] = await this.db('backups')
      .insert({
        project_id: projectId,
        type: 'manual',
        status: 'running',
        created_by: userId,
        started_at: this.db.fn.now(),
        metadata: JSON.stringify({ tables: tables ?? [] }),
      })
      .returning('*');

    try {
      let tablesToBackup: string[] = tables ?? [];
      if (tablesToBackup.length === 0) {
        const allTables = await this.db.raw(
          `SELECT table_name FROM information_schema.tables
           WHERE table_schema = ? AND table_type = 'BASE TABLE'
           ORDER BY table_name`,
          [project.db_schema]
        );
        tablesToBackup = allTables.rows.map((r: { table_name: string }) => r.table_name);
      }

      // Export each table's data
      const safeNameRe = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
      const data: Record<string, unknown[]> = {};
      for (const table of tablesToBackup) {
        if (!safeNameRe.test(table) || !safeNameRe.test(project.db_schema)) continue;
        const rows = await this.db.raw(`SELECT * FROM "${project.db_schema}"."${table}"`);
        data[table] = rows.rows;
      }

      // Save to file
      const backupDir = path.join(process.cwd(), 'backups');
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

      const filename = `backup_${projectId}_${backup.id}.json`;
      const filePath = path.join(backupDir, filename);
      const content = JSON.stringify(data, null, 2);
      fs.writeFileSync(filePath, content);

      const fileSize = fs.statSync(filePath).size;

      await this.db('backups')
        .where({ id: backup.id })
        .update({
          status: 'completed',
          file_path: filePath,
          file_size: fileSize,
          completed_at: this.db.fn.now(),
        });

      return { ...backup, status: 'completed', file_path: filePath, file_size: fileSize };
    } catch (err) {
      await this.db('backups')
        .where({ id: backup.id })
        .update({ status: 'failed' });
      throw err;
    }
  }

  async restoreBackup(backupId: string, projectId: string) {
    const backup = await this.db('backups')
      .where({ id: backupId, project_id: projectId })
      .first();
    if (!backup) throw new Error('Backup not found');
    if (backup.status !== 'completed') throw new Error('Backup is not completed');
    if (!backup.file_path) throw new Error('Backup file not found');

    const project = await this.db('projects').where({ id: projectId }).first();
    if (!project) throw new Error('Project not found');

    if (!fs.existsSync(backup.file_path)) {
      throw new Error('Backup file missing from disk');
    }

    const content = fs.readFileSync(backup.file_path, 'utf-8');
    const data: Record<string, any[]> = JSON.parse(content);

    // Restore each table inside a transaction
    await this.db.transaction(async (trx) => {
      for (const [table, rows] of Object.entries(data)) {
        // Clear existing data
        await trx.raw(`DELETE FROM "${project.db_schema}"."${table}"`);

        // Insert rows in batches
        if (rows.length > 0) {
          const batchSize = 500;
          for (let i = 0; i < rows.length; i += batchSize) {
            const batch = rows.slice(i, i + batchSize);
            await trx(`${project.db_schema}.${table}`).insert(batch);
          }
        }
      }
    });

    return { success: true };
  }

  async getBackupFilePath(backupId: string, projectId: string) {
    const backup = await this.db('backups')
      .where({ id: backupId, project_id: projectId })
      .first();
    if (!backup) throw new Error('Backup not found');
    if (backup.status !== 'completed') throw new Error('Backup is not completed');
    if (!backup.file_path) throw new Error('Backup file not found');
    if (!fs.existsSync(backup.file_path)) {
      throw new Error('Backup file missing from disk');
    }
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
    const schedule = await this.db('backup_schedules')
      .where({ project_id: projectId })
      .first();
    return schedule ?? null;
  }

  async updateSchedule(projectId: string, input: {
    cron_expression?: string;
    is_active?: boolean;
    max_backups?: number;
  }) {
    const existing = await this.db('backup_schedules')
      .where({ project_id: projectId })
      .first();

    if (existing) {
      const [schedule] = await this.db('backup_schedules')
        .where({ project_id: projectId })
        .update(input)
        .returning('*');
      return schedule;
    } else {
      const [schedule] = await this.db('backup_schedules')
        .insert({
          project_id: projectId,
          ...input,
        })
        .returning('*');
      return schedule;
    }
  }
}
