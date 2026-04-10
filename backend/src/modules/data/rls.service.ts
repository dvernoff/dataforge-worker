import type { Knex } from 'knex';

const rulesCache = new Map<string, { rules: Record<string, unknown>[]; expiry: number }>();
const CACHE_TTL = 10_000;

export class RLSService {
  constructor(private db: Knex) {}

  async getRules(projectId: string, tableName: string) {
    const key = `${projectId}:${tableName}`;
    const cached = rulesCache.get(key);
    if (cached && cached.expiry > Date.now()) return cached.rules;

    const rules = await this.db('rls_rules').where({ project_id: projectId, table_name: tableName, is_active: true });
    rulesCache.set(key, { rules, expiry: Date.now() + CACHE_TTL });
    return rules;
  }

  async listRules(projectId: string) {
    return this.db('rls_rules').where({ project_id: projectId }).orderBy('created_at', 'desc');
  }

  async hasRules(projectId: string): Promise<boolean> {
    const key = `${projectId}:__any__`;
    const cached = rulesCache.get(key);
    if (cached && cached.expiry > Date.now()) return cached.rules.length > 0;

    const rules = await this.db('rls_rules').where({ project_id: projectId, is_active: true }).limit(1);
    rulesCache.set(key, { rules, expiry: Date.now() + CACHE_TTL });
    return rules.length > 0;
  }

  async applyRLS(query: Knex.QueryBuilder, projectId: string, tableName: string, context: Record<string, string>) {
    const rules = await this.getRules(projectId, tableName);
    if (rules.length === 0) return query;

    for (const rule of rules) {
      let value: string | null = null;
      switch (rule.value_source) {
        case 'static': value = rule.value_static as string; break;
        case 'current_user_id': value = context.userId ?? null; break;
        case 'current_user_role': value = context.userRole ?? null; break;
        case 'header': value = context[`header_${rule.value_static}`] ?? null; break;
        default: value = rule.value_static as string;
      }
      if (value === null || value === undefined) continue;

      const col = rule.column_name as string;
      switch (rule.operator) {
        case 'eq': query.where(col, value); break;
        case 'neq': query.whereNot(col, value); break;
        case 'gt': query.where(col, '>', value); break;
        case 'gte': query.where(col, '>=', value); break;
        case 'lt': query.where(col, '<', value); break;
        case 'lte': query.where(col, '<=', value); break;
        case 'in': query.whereIn(col, value.split(',').map(v => v.trim())); break;
        case 'contains': query.where(col, 'ILIKE', `%${value}%`); break;
      }
    }
    return query;
  }

  invalidateCache(projectId: string) {
    for (const key of rulesCache.keys()) {
      if (key.startsWith(`${projectId}:`)) rulesCache.delete(key);
    }
  }

  async createRule(input: Record<string, unknown>) {
    const [rule] = await this.db('rls_rules').insert(input).returning('*');
    this.invalidateCache(input.project_id as string);
    return rule;
  }

  async deleteRule(id: string, projectId: string) {
    const deleted = await this.db('rls_rules').where({ id, project_id: projectId }).delete();
    if (!deleted) {
      throw Object.assign(new Error('RLS rule not found'), { statusCode: 404 });
    }
    this.invalidateCache(projectId);
  }
}
