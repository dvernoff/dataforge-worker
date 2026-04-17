import type { Knex } from 'knex';

export interface FilterCondition {
  field: string;
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'ilike' | 'in' | 'is_null' | 'is_not_null' | 'between';
  value?: unknown;
  values?: unknown[];
}

export function applyFilters(query: Knex.QueryBuilder, filters: FilterCondition[]): Knex.QueryBuilder {
  for (const f of filters) {
    switch (f.operator) {
      case 'eq':
        query = query.where(f.field, '=', f.value as Knex.Value);
        break;
      case 'neq':
        query = query.where(f.field, '!=', f.value as Knex.Value);
        break;
      case 'gt':
        query = query.where(f.field, '>', f.value as Knex.Value);
        break;
      case 'gte':
        query = query.where(f.field, '>=', f.value as Knex.Value);
        break;
      case 'lt':
        query = query.where(f.field, '<', f.value as Knex.Value);
        break;
      case 'lte':
        query = query.where(f.field, '<=', f.value as Knex.Value);
        break;
      case 'like':
        query = query.where(f.field, 'LIKE', f.value as Knex.Value);
        break;
      case 'ilike':
        query = query.where(f.field, 'ILIKE', f.value as Knex.Value);
        break;
      case 'in':
        if (Array.isArray(f.values)) {
          query = query.whereIn(f.field, f.values as Knex.Value[]);
        }
        break;
      case 'is_null':
        query = query.whereNull(f.field);
        break;
      case 'is_not_null':
        query = query.whereNotNull(f.field);
        break;
      case 'between':
        if (Array.isArray(f.values) && f.values.length === 2) {
          query = query.whereBetween(f.field, [f.values[0] as Knex.Value, f.values[1] as Knex.Value]);
        }
        break;
    }
  }
  return query;
}
