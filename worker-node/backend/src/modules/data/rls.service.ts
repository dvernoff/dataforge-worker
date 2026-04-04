import type { Knex } from 'knex';

export class RLSService {
  constructor(private db: Knex) {}

  async getRules(projectId: string, tableName: string) {
    return this.db('rls_rules').where({ project_id: projectId, table_name: tableName, is_active: true });
  }

  async listRules(projectId: string) {
    return this.db('rls_rules').where({ project_id: projectId }).orderBy('created_at', 'desc');
  }

  async applyRLS(query: Knex.QueryBuilder, projectId: string, tableName: string, context: Record<string, string>) {
    const rules = await this.getRules(projectId, tableName);
    for (const rule of rules) {
      let value: string | null = null;
      switch (rule.value_source) {
        case 'static': value = rule.value_static; break;
        case 'current_user_id': value = context.userId; break;
        case 'current_user_role': value = context.userRole; break;
        case 'header': value = context[`header_${rule.value_static}`]; break;
        default: value = rule.value_static;
      }
      if (value === null) continue;
      switch (rule.operator) {
        case 'eq': query.where(`${tableName}.${rule.column_name}`, value); break;
        case 'neq': query.whereNot(`${tableName}.${rule.column_name}`, value); break;
        case 'gt': query.where(`${tableName}.${rule.column_name}`, '>', value); break;
        case 'lt': query.where(`${tableName}.${rule.column_name}`, '<', value); break;
        case 'in': query.whereIn(`${tableName}.${rule.column_name}`, value.split(',')); break;
        case 'contains': query.where(`${tableName}.${rule.column_name}`, 'ILIKE', `%${value}%`); break;
      }
    }
    return query;
  }

  async createRule(input: Record<string, unknown>) {
    const [rule] = await this.db('rls_rules').insert(input).returning('*');
    return rule;
  }

  async deleteRule(id: string, projectId: string) {
    const deleted = await this.db('rls_rules').where({ id, project_id: projectId }).delete();
    if (!deleted) {
      throw Object.assign(new Error('RLS rule not found'), { statusCode: 404 });
    }
  }
}
