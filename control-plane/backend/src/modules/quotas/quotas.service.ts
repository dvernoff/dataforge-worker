import type { Knex } from 'knex';
import type Redis from 'ioredis';

const QUOTA_FIELDS = [
  'max_projects',
] as const;

const HARDCODED_DEFAULTS: Record<string, number> = {
  max_projects: 5,
};

export interface QuotaInput {
  max_projects?: number;
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

  async getUserUsage(userId: string) {
    const projectsCount = await this.db('projects')
      .where({ created_by: userId })
      .count('* as count')
      .first()
      .then(r => Number(r?.count ?? 0));

    return {
      projects: projectsCount,
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
    resourceType: 'projects',
  ): Promise<string | null> {
    const field = 'max_projects';
    if (resourceType !== 'projects') return null;

    const cacheKey = `quota-check:${userId}:${resourceType}`;

    if (this.redis) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached === 'ok') return null;
        if (cached?.startsWith('blocked:')) return cached.slice(8);
      } catch { /* Redis unavailable, skip cache */ }
    }

    const { quota } = await this.getEffectiveQuota(userId);
    const limit = quota[field];
    if (!limit || limit <= 0) {
      if (this.redis) {
        try { await this.redis.set(cacheKey, 'ok', 'EX', 10); } catch { /* ignore */ }
      }
      return null;
    }

    const usage = await this.getUserUsage(userId);
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
}
