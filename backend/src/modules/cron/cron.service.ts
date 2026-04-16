import type { Knex } from 'knex';
import cron from 'node-cron';
import { AppError } from '../../middleware/error-handler.js';
import { isModuleEnabled } from '../../utils/module-check.js';

import { validateSchema, validateSchemaAccess } from '../../utils/sql-guard.js';

const VALID_SCHEMA_RE = /^[a-z_][a-z0-9_]*$/;

interface CronJobRecord {
  id: string;
  project_id: string;
  name: string;
  cron_expression: string;
  action_type: string;
  action_config: Record<string, unknown>;
  is_active: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
  run_count: number;
  created_at: string;
}

export class CronService {
  private scheduledJobs = new Map<string, { stop(): void }>();

  constructor(private db: Knex) {}

  async create(projectId: string, input: {
    name: string;
    cron_expression: string;
    action_type: string;
    action_config: Record<string, unknown>;
    is_active?: boolean;
  }) {
    if (!cron.validate(input.cron_expression)) {
      throw new AppError(400, 'Invalid cron expression');
    }

    const [job] = await this.db('cron_jobs')
      .insert({
        project_id: projectId,
        name: input.name,
        cron_expression: input.cron_expression,
        action_type: input.action_type,
        action_config: JSON.stringify(input.action_config),
        is_active: input.is_active ?? true,
      })
      .returning('*');

    if (job.is_active) {
      this.scheduleJob(job);
    }

    return job;
  }

  async findAll(projectId: string) {
    return this.db('cron_jobs')
      .where({ project_id: projectId })
      .orderBy('created_at', 'desc');
  }

  async findById(jobId: string, projectId: string) {
    const job = await this.db('cron_jobs')
      .where({ id: jobId, project_id: projectId })
      .first();
    if (!job) throw new AppError(404, 'Cron job not found');

    const recentRuns = await this.db('cron_job_runs')
      .where({ cron_job_id: jobId })
      .orderBy('started_at', 'desc')
      .limit(20);

    return { ...job, recent_runs: recentRuns };
  }

  async update(jobId: string, projectId: string, input: Record<string, unknown>) {
    if (input.cron_expression && !cron.validate(input.cron_expression as string)) {
      throw new AppError(400, 'Invalid cron expression');
    }

    const updateData: Record<string, unknown> = {};
    if (input.name !== undefined) updateData.name = input.name;
    if (input.cron_expression !== undefined) updateData.cron_expression = input.cron_expression;
    if (input.action_type !== undefined) updateData.action_type = input.action_type;
    if (input.action_config !== undefined) updateData.action_config = JSON.stringify(input.action_config);
    if (input.is_active !== undefined) updateData.is_active = input.is_active;

    const [job] = await this.db('cron_jobs')
      .where({ id: jobId, project_id: projectId })
      .update(updateData)
      .returning('*');

    if (!job) throw new AppError(404, 'Cron job not found');

    this.stop(jobId);
    if (job.is_active) {
      this.scheduleJob(job);
    }

    return job;
  }

  async delete(jobId: string, projectId: string) {
    this.stop(jobId);
    const deleted = await this.db('cron_jobs')
      .where({ id: jobId, project_id: projectId })
      .delete();
    if (!deleted) throw new AppError(404, 'Cron job not found');
  }

  async toggle(jobId: string, projectId: string) {
    const job = await this.db('cron_jobs')
      .where({ id: jobId, project_id: projectId })
      .first();
    if (!job) throw new AppError(404, 'Cron job not found');

    const newActive = !job.is_active;
    const [updated] = await this.db('cron_jobs')
      .where({ id: jobId, project_id: projectId })
      .update({ is_active: newActive })
      .returning('*');

    if (newActive) {
      this.scheduleJob(updated);
    } else {
      this.stop(jobId);
    }

    return updated;
  }

  async runNow(jobId: string, projectId: string) {
    const job = await this.db('cron_jobs')
      .where({ id: jobId, project_id: projectId })
      .first();
    if (!job) throw new AppError(404, 'Cron job not found');

    return this.executeJob(job);
  }

  async getRuns(jobId: string, projectId: string, limit = 50) {
    const job = await this.db('cron_jobs')
      .where({ id: jobId, project_id: projectId })
      .select('id')
      .first();
    if (!job) throw new AppError(404, 'Cron job not found');

    return this.db('cron_job_runs')
      .where({ cron_job_id: jobId })
      .orderBy('started_at', 'desc')
      .limit(limit);
  }

  async startAll() {
    const activeJobs = await this.db('cron_jobs').where({ is_active: true });
    for (const job of activeJobs) {
      this.scheduleJob(job);
    }
    console.log(`[CronService] Started ${activeJobs.length} active cron jobs`);
  }

  async stopByProject(projectId: string) {
    const jobs = await this.db('cron_jobs').where({ project_id: projectId, is_active: true }).select('id');
    for (const job of jobs) {
      this.stop(job.id);
    }
  }

  async startByProject(projectId: string) {
    const jobs = await this.db('cron_jobs').where({ project_id: projectId, is_active: true });
    for (const job of jobs) {
      this.scheduleJob(job);
    }
  }

  stopAll() {
    for (const [id, task] of this.scheduledJobs) {
      task.stop();
    }
    this.scheduledJobs.clear();
  }

  stop(jobId: string) {
    const task = this.scheduledJobs.get(jobId);
    if (task) {
      task.stop();
      this.scheduledJobs.delete(jobId);
    }
  }

  private scheduleJob(job: CronJobRecord) {
    if (this.scheduledJobs.has(job.id)) {
      this.stop(job.id);
    }

    try {
      const task = cron.schedule(job.cron_expression, () => {
        this.executeJob(job).catch((err) => {
          console.error(`[CronService] Error executing job ${job.id}:`, err);
        });
      });
      this.scheduledJobs.set(job.id, task);
    } catch (err) {
      console.error(`[CronService] Failed to schedule job ${job.id}:`, err);
    }
  }

  async executeJob(job: CronJobRecord) {
    const enabled = await isModuleEnabled(this.db, job.project_id, 'feature-cron');
    if (!enabled) {
      return { status: 'skipped', reason: 'module_disabled' };
    }

    const [run] = await this.db('cron_job_runs')
      .insert({
        cron_job_id: job.id,
        status: 'running',
      })
      .returning('*');

    try {
      let result: unknown;

      const project = await this.db('projects').where({ id: job.project_id }).select('db_schema').first();
      if (!project?.db_schema) {
        throw new Error('Project has no database schema assigned');
      }
      const projectSchema: string = project.db_schema;

      switch (job.action_type) {
        case 'sql':
          result = await this.executeSql(job.action_config, projectSchema);
          break;
        default:
          throw new Error(`Unknown action type: ${job.action_type}`);
      }

      await this.db('cron_job_runs')
        .where({ id: run.id })
        .update({
          status: 'success',
          completed_at: new Date().toISOString(),
          result: JSON.stringify(result),
        });

      await this.db('cron_jobs')
        .where({ id: job.id })
        .update({
          last_run_at: new Date().toISOString(),
          last_status: 'success',
          last_error: null,
          run_count: this.db.raw('run_count + 1'),
        });

      return { status: 'success', result };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      await this.db('cron_job_runs')
        .where({ id: run.id })
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          error: errorMsg,
        });

      await this.db('cron_jobs')
        .where({ id: job.id })
        .update({
          last_run_at: new Date().toISOString(),
          last_status: 'failed',
          last_error: errorMsg,
          run_count: this.db.raw('run_count + 1'),
        });

      return { status: 'failed', error: errorMsg };
    }
  }

  private async executeSql(config: Record<string, unknown>, projectSchema: string, timeoutMs = 30_000) {
    const query = config.query as string;
    if (!query) throw new Error('SQL query is required');

    const cleaned = query
      .replace(/--[^\n]*/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/'[^']*'/g, "''");
    const normalized = cleaned.trim().toUpperCase();
    const blockedKeywords = ['DROP ', 'ALTER ', 'TRUNCATE ', 'CREATE ', 'GRANT ', 'REVOKE '];
    for (const keyword of blockedKeywords) {
      if (normalized.includes(keyword)) {
        throw new Error(`DDL statements (${keyword.trim()}) are not allowed in cron jobs`);
      }
    }
    if (normalized.startsWith('WITH')) {
      const mutationPattern = /\b(INSERT|UPDATE|DELETE)\b/i;
      if (mutationPattern.test(cleaned)) {
        throw new Error('WITH clause cannot contain mutations (INSERT/UPDATE/DELETE) in cron jobs');
      }
    }

    if (!VALID_SCHEMA_RE.test(projectSchema)) {
      throw new Error('Invalid project schema name');
    }

    validateSchemaAccess(query, projectSchema);

    const result = await this.db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL search_path TO "${projectSchema}"`);
      await trx.raw(`SET LOCAL statement_timeout = ${Math.max(1000, Math.min(timeoutMs, 120000))}`);
      return trx.raw(query) as any;
    });
    return { rows: result.rows ?? [], rowCount: result.rowCount ?? 0 };
  }

}
