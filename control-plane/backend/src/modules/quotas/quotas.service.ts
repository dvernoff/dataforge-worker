import type { Knex } from 'knex';
import type Redis from 'ioredis';
import { env } from '../../config/env.js';

const QUOTA_FIELDS = [
  'max_projects',
  'max_tables',
  'max_records',
  'max_api_requests',
  'max_storage_mb',
  'max_endpoints',
  'max_webhooks',
  'max_files',
  'max_backups',
  'max_cron',
  'max_ai_requests_per_day',
  'max_ai_tokens_per_day',
  'max_query_timeout_ms',
  'max_concurrent_requests',
  'max_rows_per_query',
  'max_export_rows',
] as const;

const HARDCODED_DEFAULTS: Record<string, number> = {
  max_projects: 5,
  max_tables: 20,
  max_records: 100000,
  max_api_requests: 10000,
  max_storage_mb: 1000,
  max_endpoints: 50,
  max_webhooks: 20,
  max_files: 500,
  max_backups: 10,
  max_cron: 10,
  max_ai_requests_per_day: 50,
  max_ai_tokens_per_day: 100000,
  max_query_timeout_ms: 30000,
  max_concurrent_requests: 10,
  max_rows_per_query: 1000,
  max_export_rows: 10000,
};

export interface QuotaInput {
  max_projects?: number;
  max_tables?: number;
  max_records?: number;
  max_api_requests?: number;
  max_storage_mb?: number;
  max_endpoints?: number;
  max_webhooks?: number;
  max_files?: number;
  max_backups?: number;
  max_cron?: number;
  max_ai_requests_per_day?: number;
  max_ai_tokens_per_day?: number;
  max_query_timeout_ms?: number;
  max_concurrent_requests?: number;
  max_rows_per_query?: number;
  max_export_rows?: number;
}

export class QuotasService {
  private redis?: Redis;
  constructor(private db: Knex, redis?: Redis) {
    this.redis = redis;
  }

  /** Returns the single default_quotas row */
  async getDefaults() {
    const row = await this.db('default_quotas').first();
    if (!row) {
      throw Object.assign(new Error('Default quotas not found'), { statusCode: 500 });
    }
    return row;
  }

  /** Update the single default_quotas row */
  async updateDefaults(input: QuotaInput) {
    const defaults = await this.getDefaults();

    const [updated] = await this.db('default_quotas')
      .where({ id: defaults.id })
      .update({ ...input, updated_at: new Date() })
      .returning('*');

    return updated;
  }

  /**
   * Get effective quota for a user with source info.
   * Resolution chain: user_quotas override > role quotas > hardcoded defaults
   */
  async getEffectiveQuota(userId: string) {
    const userQuota = await this.db('user_quotas').where({ user_id: userId }).first();
    if (userQuota) {
      const quota: Record<string, number> = {};
      for (const f of QUOTA_FIELDS) quota[f] = userQuota[f];
      return { quota, source: 'user_override' as const };
    }

    const hasRoleId = await this.db.schema.hasColumn('users', 'role_id');
    if (hasRoleId) {
      const user = await this.db('users').where({ id: userId }).select('role_id').first();
      if (user?.role_id) {
        const hasRoles = await this.db.schema.hasTable('custom_roles');
        if (hasRoles) {
          const role = await this.db('custom_roles').where({ id: user.role_id }).first();
          if (role) {
            const quota: Record<string, number> = {};
            for (const f of QUOTA_FIELDS) quota[f] = role[f] ?? HARDCODED_DEFAULTS[f];
            return {
              quota,
              source: 'role' as const,
              role_name: role.name as string,
              role_color: role.color as string,
              role_id: role.id as string,
            };
          }
        }
      }
    }

    // 3. Hardcoded fallback defaults
    return { quota: { ...HARDCODED_DEFAULTS }, source: 'default' as const };
  }

  /** Returns user_quotas for a user, or defaults if none set */
  async getUserQuota(userId: string) {
    const userQuota = await this.db('user_quotas').where({ user_id: userId }).first();
    if (userQuota) {
      return userQuota;
    }
    // Try role-based quotas
    const effective = await this.getEffectiveQuota(userId);
    return effective.quota;
  }

  /** Upsert user_quotas for a user */
  async setUserQuota(userId: string, input: QuotaInput) {
    const existing = await this.db('user_quotas').where({ user_id: userId }).first();

    if (existing) {
      const [updated] = await this.db('user_quotas')
        .where({ user_id: userId })
        .update({ ...input, updated_at: new Date() })
        .returning('*');
      return updated;
    }

    // Merge with effective quota for fields not provided
    const effective = await this.getEffectiveQuota(userId);
    const merged: Record<string, unknown> = { user_id: userId };
    for (const field of QUOTA_FIELDS) {
      merged[field] = input[field] ?? effective.quota[field];
    }

    const [created] = await this.db('user_quotas')
      .insert(merged)
      .returning('*');

    return created;
  }

  /** Delete user quota override (revert to role/defaults) */
  async deleteUserQuota(userId: string) {
    const deleted = await this.db('user_quotas').where({ user_id: userId }).del();
    if (!deleted) {
      throw Object.assign(new Error('User quota not found'), { statusCode: 404 });
    }
  }

  /** Fetch usage stats from a worker node for a specific project */
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

  /** Calculate current usage for a user across all their projects */
  async getUserUsage(userId: string) {
    const userProjects = await this.db('project_members')
      .where({ user_id: userId })
      .select('project_id');
    const projectIds = userProjects.map(p => p.project_id);

    const projectsCount = projectIds.length;

    // CP-side counts: backups
    let backupsCount = 0;
    let backupSizeMb = 0;
    if (projectIds.length > 0) {
      try {
        const backupStats = await this.db('backups')
          .whereIn('project_id', projectIds)
          .select(
            this.db.raw('COUNT(*)::int as count'),
            this.db.raw('COALESCE(SUM(file_size), 0)::bigint as total_bytes')
          )
          .first();
        backupsCount = backupStats?.count ?? 0;
        backupSizeMb = Math.round(Number(backupStats?.total_bytes ?? 0) / 1024 / 1024 * 100) / 100;
      } catch { /* backups table may not exist */ }
    }

    // Worker-side counts: aggregate across all user's projects
    let tables = 0, records = 0, storageMb = 0, files = 0, cron = 0, endpoints = 0, webhooks = 0;
    if (projectIds.length > 0) {
      const usageResults = await Promise.all(
        projectIds.map(pid => this.fetchWorkerProjectUsage(pid))
      );
      for (const u of usageResults) {
        tables += u.tables;
        records += u.records;
        storageMb += u.storage_mb;
        files += u.files;
        cron += u.cron;
        endpoints += u.endpoints;
        webhooks += u.webhooks;
      }
    }

    // Total storage = worker schema/files + backup files
    const totalStorageMb = Math.round((storageMb + backupSizeMb) * 100) / 100;

    // AI usage for today
    let aiRequests = 0;
    let aiTokens = 0;
    try {
      const hasAiLog = await this.db.schema.hasTable('ai_usage_log');
      if (hasAiLog) {
        const today = new Date().toISOString().split('T')[0];
        const aiUsage = await this.db('ai_usage_log')
          .where('user_id', userId)
          .whereRaw("created_at::date = ?", [today])
          .select(
            this.db.raw('COUNT(*)::int as requests'),
            this.db.raw('COALESCE(SUM(input_tokens + output_tokens), 0)::int as tokens')
          )
          .first();
        aiRequests = aiUsage?.requests ?? 0;
        aiTokens = aiUsage?.tokens ?? 0;
      }
    } catch { /* ai_usage_log may not exist yet */ }

    return {
      projects: projectsCount,
      tables,
      records,
      api_requests: 0,
      storage_mb: totalStorageMb,
      endpoints,
      webhooks,
      files,
      backups: backupsCount,
      cron,
      ai_requests_today: aiRequests,
      ai_tokens_today: aiTokens,
    };
  }

  /**
   * Check if a user can create a resource. Returns null if allowed,
   * or an error string if quota exceeded. Cached for 10s in Redis.
   *
   * resourceType maps to: tables, endpoints, webhooks, cron, files, backups
   */
  async checkCreateQuota(
    userId: string,
    resourceType: 'tables' | 'endpoints' | 'webhooks' | 'cron' | 'files' | 'backups' | 'projects',
  ): Promise<string | null> {
    const quotaFieldMap: Record<string, string> = {
      tables: 'max_tables',
      endpoints: 'max_endpoints',
      webhooks: 'max_webhooks',
      cron: 'max_cron',
      files: 'max_files',
      backups: 'max_backups',
      projects: 'max_projects',
    };

    const field = quotaFieldMap[resourceType];
    if (!field) return null;

    // Check Redis cache first (avoid expensive usage calculation)
    const cacheKey = `quota-check:${userId}:${resourceType}`;
    const cached = await this.redis.get(cacheKey);
    if (cached === 'ok') return null;
    if (cached?.startsWith('blocked:')) return cached.slice(8);

    const { quota } = await this.getEffectiveQuota(userId);
    const limit = quota[field];
    if (!limit || limit <= 0) {
      // 0 = unlimited
      await this.redis.set(cacheKey, 'ok', 'EX', 10);
      return null;
    }

    const usage = await this.getUserUsage(userId);
    const current = (usage as Record<string, number>)[resourceType] ?? 0;

    if (current >= limit) {
      const msg = `Quota exceeded: ${resourceType} (${current}/${limit})`;
      await this.redis.set(cacheKey, `blocked:${msg}`, 'EX', 10);
      return msg;
    }

    await this.redis.set(cacheKey, 'ok', 'EX', 10);
    return null;
  }
}
