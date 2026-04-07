import type { Knex } from 'knex';
import type Redis from 'ioredis';
import { env } from '../../config/env.js';

const PROJECT_QUOTA_FIELDS = [
  'max_tables',
  'max_records',
  'max_api_requests',
  'max_storage_mb',
  'max_endpoints',
  'max_webhooks',
  'max_files',
  'max_backups',
  'max_cron',
  'max_query_timeout_ms',
  'max_concurrent_requests',
  'max_rows_per_query',
  'max_export_rows',
] as const;

const HARDCODED_DEFAULTS: Record<string, number> = {
  max_tables: 20,
  max_records: 100000,
  max_api_requests: 10000,
  max_storage_mb: 1000,
  max_endpoints: 50,
  max_webhooks: 20,
  max_files: 500,
  max_backups: 10,
  max_cron: 10,
  max_query_timeout_ms: 30000,
  max_concurrent_requests: 10,
  max_rows_per_query: 1000,
  max_export_rows: 10000,
};

export interface ProjectQuotaInput {
  max_tables?: number;
  max_records?: number;
  max_api_requests?: number;
  max_storage_mb?: number;
  max_endpoints?: number;
  max_webhooks?: number;
  max_files?: number;
  max_backups?: number;
  max_cron?: number;
  max_query_timeout_ms?: number;
  max_concurrent_requests?: number;
  max_rows_per_query?: number;
  max_export_rows?: number;
}

export interface PlanInput {
  name: string;
  color?: string;
  description?: string;
  max_tables?: number;
  max_records?: number;
  max_api_requests?: number;
  max_storage_mb?: number;
  max_endpoints?: number;
  max_webhooks?: number;
  max_files?: number;
  max_backups?: number;
  max_cron?: number;
  max_query_timeout_ms?: number;
  max_concurrent_requests?: number;
  max_rows_per_query?: number;
  max_export_rows?: number;
}

export class ProjectQuotasService {
  private redis?: Redis;
  constructor(private db: Knex, redis?: Redis) {
    this.redis = redis;
  }

  async getEffectiveProjectQuota(projectId: string) {
    const project = await this.db('projects as p')
      .leftJoin('nodes as n', 'p.node_id', 'n.id')
      .where('p.id', projectId)
      .select('p.plan_id', 'n.owner_id')
      .first();

    if (!project) {
      throw Object.assign(new Error('Project not found'), { statusCode: 404 });
    }

    if (project.owner_id) {
      const quota: Record<string, number> = {};
      for (const f of PROJECT_QUOTA_FIELDS) quota[f] = 0;
      return { quota, source: 'personal_node' as const };
    }

    const override = await this.db('project_quotas').where({ project_id: projectId }).first();
    if (override) {
      const quota: Record<string, number> = {};
      for (const f of PROJECT_QUOTA_FIELDS) quota[f] = override[f];
      return { quota, source: 'project_override' as const };
    }

    if (project.plan_id) {
      const plan = await this.db('project_plans').where({ id: project.plan_id }).first();
      if (plan) {
        const quota: Record<string, number> = {};
        for (const f of PROJECT_QUOTA_FIELDS) quota[f] = plan[f] ?? HARDCODED_DEFAULTS[f];
        return {
          quota,
          source: 'plan' as const,
          plan_name: plan.name as string,
          plan_color: plan.color as string,
        };
      }
    }

    return { quota: { ...HARDCODED_DEFAULTS }, source: 'default' as const };
  }

  async getProjectUsage(projectId: string) {
    const workerUsage = await this.fetchWorkerProjectUsage(projectId);

    let backupsCount = 0;
    try {
      const stats = await this.db('backups')
        .where({ project_id: projectId })
        .select(this.db.raw('COUNT(*)::int as count'))
        .first();
      backupsCount = stats?.count ?? 0;
    } catch { /* backups table may not exist */ }

    return {
      tables: workerUsage.tables,
      records: workerUsage.records,
      api_requests: 0,
      storage_mb: workerUsage.storage_mb,
      endpoints: workerUsage.endpoints,
      webhooks: workerUsage.webhooks,
      files: workerUsage.files,
      backups: backupsCount,
      cron: workerUsage.cron,
    };
  }

  private async fetchWorkerProjectUsage(projectId: string): Promise<{
    tables: number; records: number; storage_mb: number; files: number;
    cron: number; endpoints: number; webhooks: number;
  }> {
    const defaults = { tables: 0, records: 0, storage_mb: 0, files: 0, cron: 0, endpoints: 0, webhooks: 0 };
    try {
      const row = await this.db('projects as p')
        .join('nodes as n', 'p.node_id', 'n.id')
        .where('p.id', projectId)
        .select('n.url')
        .first();
      if (!row?.url) return defaults;

      const res = await fetch(`${String(row.url).replace(/\/$/, '')}/internal/projects/${projectId}/usage`, {
        headers: {
          'X-Node-Api-Key': env.WORKER_NODE_API_KEY,
          ...(env.INTERNAL_SECRET ? { 'X-Internal-Secret': env.INTERNAL_SECRET } : {}),
        },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return defaults;
      return await res.json() as typeof defaults;
    } catch {
      return defaults;
    }
  }

  async checkProjectCreateQuota(
    projectId: string,
    resourceType: 'tables' | 'endpoints' | 'webhooks' | 'cron' | 'files' | 'backups',
  ): Promise<string | null> {
    const quotaFieldMap: Record<string, string> = {
      tables: 'max_tables',
      endpoints: 'max_endpoints',
      webhooks: 'max_webhooks',
      cron: 'max_cron',
      files: 'max_files',
      backups: 'max_backups',
    };

    const field = quotaFieldMap[resourceType];
    if (!field) return null;

    const cacheKey = `pq:${projectId}:${resourceType}`;

    if (this.redis) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached === 'ok') return null;
        if (cached?.startsWith('blocked:')) return cached.slice(8);
      } catch { /* Redis unavailable, skip cache */ }
    }

    const effective = await this.getEffectiveProjectQuota(projectId);
    if (effective.source === 'personal_node') {
      if (this.redis) {
        try { await this.redis.set(cacheKey, 'ok', 'EX', 10); } catch { /* ignore */ }
      }
      return null;
    }

    const limit = effective.quota[field];
    if (!limit || limit <= 0) {
      if (this.redis) {
        try { await this.redis.set(cacheKey, 'ok', 'EX', 10); } catch { /* ignore */ }
      }
      return null;
    }

    const usage = await this.getProjectUsage(projectId);
    const current = (usage as Record<string, number>)[resourceType] ?? 0;

    if (current >= limit) {
      const msg = `Quota exceeded: ${resourceType} (${current}/${limit})`;
      if (this.redis) {
        try { await this.redis.set(cacheKey, `blocked:${msg}`, 'EX', 10); } catch { /* ignore */ }
      }
      return msg;
    }

    if (this.redis) {
      try { await this.redis.set(cacheKey, 'ok', 'EX', 10); } catch { /* ignore */ }
    }
    return null;
  }

  async getAllPlans() {
    const plans = await this.db('project_plans')
      .select('project_plans.*')
      .select(
        this.db.raw(`(SELECT COUNT(*)::int FROM projects WHERE projects.plan_id = project_plans.id) as projects_count`)
      )
      .orderBy('created_at', 'desc');
    return plans;
  }

  async createPlan(input: PlanInput) {
    const insert: Record<string, unknown> = {
      name: input.name,
      color: input.color ?? '#6B7280',
      description: input.description ?? null,
    };
    for (const field of PROJECT_QUOTA_FIELDS) {
      insert[field] = input[field] ?? HARDCODED_DEFAULTS[field];
    }

    const [plan] = await this.db('project_plans')
      .insert(insert)
      .returning('*');

    return { ...plan, projects_count: 0 };
  }

  async updatePlan(id: string, input: Partial<PlanInput>) {
    const update: Record<string, unknown> = { updated_at: new Date() };
    if (input.name !== undefined) update.name = input.name;
    if (input.color !== undefined) update.color = input.color;
    if (input.description !== undefined) update.description = input.description;
    for (const field of PROJECT_QUOTA_FIELDS) {
      const val = (input as Record<string, unknown>)[field];
      if (val !== undefined) update[field] = val;
    }

    const [plan] = await this.db('project_plans')
      .where({ id })
      .update(update)
      .returning('*');

    if (!plan) {
      throw Object.assign(new Error('Plan not found'), { statusCode: 404 });
    }

    return plan;
  }

  async deletePlan(id: string) {
    await this.db('projects').where({ plan_id: id }).update({ plan_id: null });

    const deleted = await this.db('project_plans').where({ id }).del();
    if (!deleted) {
      throw Object.assign(new Error('Plan not found'), { statusCode: 404 });
    }
  }

  async setProjectQuota(projectId: string, input: ProjectQuotaInput) {
    const existing = await this.db('project_quotas').where({ project_id: projectId }).first();

    if (existing) {
      const [updated] = await this.db('project_quotas')
        .where({ project_id: projectId })
        .update({ ...input, updated_at: new Date() })
        .returning('*');
      return updated;
    }

    const effective = await this.getEffectiveProjectQuota(projectId);
    const merged: Record<string, unknown> = { project_id: projectId };
    for (const field of PROJECT_QUOTA_FIELDS) {
      merged[field] = input[field] ?? effective.quota[field];
    }

    const [created] = await this.db('project_quotas')
      .insert(merged)
      .returning('*');

    return created;
  }

  async deleteProjectQuota(projectId: string) {
    const deleted = await this.db('project_quotas').where({ project_id: projectId }).del();
    if (!deleted) {
      throw Object.assign(new Error('Project quota override not found'), { statusCode: 404 });
    }
  }

  async assignPlan(projectId: string, planId: string | null) {
    if (planId) {
      const plan = await this.db('project_plans').where({ id: planId }).first();
      if (!plan) {
        throw Object.assign(new Error('Plan not found'), { statusCode: 404 });
      }
    }

    await this.db('projects')
      .where({ id: projectId })
      .update({ plan_id: planId });
  }
}
