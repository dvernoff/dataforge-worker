import type { Knex } from 'knex';
import { AppError } from '../../middleware/error-handler.js';
import { validateSchemaAccess, validateIdentifier, validateSchema } from '../../utils/sql-guard.js';
interface ResponseFieldConfig {
  enabled: boolean;
  alias?: string;
}

interface ResponseConfig {
  fields?: Record<string, ResponseFieldConfig>;
  fk_populate?: boolean;
}

interface EndpointDef {
  source_type: string;
  source_config: Record<string, unknown>;
  response_config: ResponseConfig | null;
  validation_schema?: Record<string, unknown> | null;
}

const SYSTEM_COLUMNS = new Set(['id', 'created_at', 'updated_at', 'deleted_at']);

export type MutationHook = (event: 'INSERT' | 'UPDATE' | 'DELETE', tableName: string, record: Record<string, unknown>) => void;

export class Executor {
  private onMutation?: MutationHook;

  constructor(private db: Knex) {}

  setMutationHook(hook: MutationHook) {
    this.onMutation = hook;
  }

  async execute(
    endpoint: EndpointDef,
    schema: string,
    params: Record<string, string>,
    query: Record<string, string>,
    body: unknown,
    timeoutMs = 30_000,
    projectId?: string,
  ) {
    if (body && !Array.isArray(body) && endpoint.validation_schema) {
      this.validateBody(body as Record<string, unknown>, endpoint.validation_schema);
    }

    let result: unknown;

    switch (endpoint.source_type) {
      case 'table':
        result = await this.executeTable(endpoint, schema, params, query, body, projectId);
        break;
      case 'custom_sql':
        result = await this.executeSQL(endpoint, schema, params, query, body as Record<string, unknown> | null, timeoutMs);
        break;
      default:
        throw new AppError(400, `Unsupported source type: ${endpoint.source_type}`);
    }

    return result;
  }

  private validateBody(body: Record<string, unknown>, schema: Record<string, unknown>) {
    const rules = schema as Record<string, {
      required?: boolean;
      type?: string;
      min?: number;
      max?: number;
      pattern?: string;
    }>;

    const errors: string[] = [];

    for (const [field, rule] of Object.entries(rules)) {
      if (!rule || typeof rule !== 'object') continue;
      const value = body[field];

      if (rule.required && (value === undefined || value === null || value === '')) {
        errors.push(`Field '${field}' is required`);
        continue;
      }

      if (value === undefined || value === null) continue;

      if (rule.type) {
        const actualType = typeof value;
        if (rule.type === 'number' && actualType !== 'number') {
          errors.push(`Field '${field}' must be a number`);
        } else if (rule.type === 'string' && actualType !== 'string') {
          errors.push(`Field '${field}' must be a string`);
        } else if (rule.type === 'boolean' && actualType !== 'boolean') {
          errors.push(`Field '${field}' must be a boolean`);
        }
      }

      if (typeof value === 'number') {
        if (rule.min !== undefined && value < rule.min) {
          errors.push(`Field '${field}' must be >= ${rule.min}`);
        }
        if (rule.max !== undefined && value > rule.max) {
          errors.push(`Field '${field}' must be <= ${rule.max}`);
        }
      }

      if (typeof value === 'string') {
        if (rule.min !== undefined && value.length < rule.min) {
          errors.push(`Field '${field}' must be at least ${rule.min} characters`);
        }
        if (rule.max !== undefined && value.length > rule.max) {
          errors.push(`Field '${field}' must be at most ${rule.max} characters`);
        }
      }

      if (rule.pattern && typeof value === 'string') {
        try {
          if (!new RegExp(rule.pattern).test(value)) {
            errors.push(`Field '${field}' does not match pattern`);
          }
        } catch {
        }
      }
    }

    if (errors.length > 0) {
      throw new AppError(422, `Validation failed: ${errors.join('; ')}`);
    }
  }

  private sanitizeBody(body: Record<string, unknown>): Record<string, unknown> {
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      if (!SYSTEM_COLUMNS.has(key)) {
        cleaned[key] = value;
      }
    }
    return cleaned;
  }

  private applyResponseConfig(record: Record<string, unknown>, rc: ResponseConfig): Record<string, unknown> {
    if (rc.fields && Object.keys(rc.fields).length > 0) {
      const result: Record<string, unknown> = {};
      for (const [field, cfg] of Object.entries(rc.fields)) {
        if (!cfg.enabled) continue;
        if (record[field] !== undefined) {
          const key = cfg.alias || field;
          result[key] = record[field];
        }
      }
      return result;
    }

    return record;
  }

  private filterResponse(data: unknown, rc: ResponseConfig | null): unknown {
    if (!rc) return data;

    if (Array.isArray(data)) {
      return data.map((item) =>
        typeof item === 'object' && item !== null
          ? this.applyResponseConfig(item as Record<string, unknown>, rc)
          : item
      );
    }

    if (typeof data === 'object' && data !== null && !('pagination' in (data as object))) {
      return this.applyResponseConfig(data as Record<string, unknown>, rc);
    }

    if (typeof data === 'object' && data !== null && 'data' in (data as object)) {
      const paginated = data as { data: unknown[]; pagination: unknown };
      return {
        ...paginated,
        data: paginated.data.map((item) =>
          typeof item === 'object' && item !== null
            ? this.applyResponseConfig(item as Record<string, unknown>, rc)
            : item
        ),
      };
    }

    return data;
  }

  private applyFilters(qb: Knex.QueryBuilder, queryParams: Record<string, string>) {
    const SAFE_OPS: Record<string, string> = {
      eq: '=', neq: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=',
      like: 'LIKE', ilike: 'ILIKE',
    };
    const RESERVED = new Set(['page', 'limit', 'offset', 'sort', 'order', 'q', 'search', 'fields', 'include', 'include_deleted', 'only_deleted', 'v']);

    for (const [key, value] of Object.entries(queryParams)) {
      const bracketMatch = key.match(/^filter\[([a-zA-Z_]\w*)\](?:\[(\w+)\])?$/);
      if (bracketMatch) {
        const [, column, op] = bracketMatch;
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(column)) continue;
        if (op === 'in') {
          qb.whereIn(column, value.split(','));
        } else if (op === 'is_null') {
          value === 'true' ? qb.whereNull(column) : qb.whereNotNull(column);
        } else {
          const sqlOp = SAFE_OPS[op ?? 'eq'] ?? '=';
          qb.where(column, sqlOp, value);
        }
        continue;
      }

      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) continue;
      const KNOWN_OPS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'in', 'is_null']);
      let column = key;
      let op: string | undefined;
      const sepIdx = key.lastIndexOf('__');
      if (sepIdx > 0) {
        const maybeOp = key.slice(sepIdx + 2);
        const maybeCol = key.slice(0, sepIdx);
        if (KNOWN_OPS.has(maybeOp) && maybeCol.length > 0) {
          column = maybeCol;
          op = maybeOp;
        }
      }
      if (RESERVED.has(column)) continue;

      if (op === 'in') {
        qb.whereIn(column, value.split(','));
      } else if (op === 'is_null') {
        value === 'true' ? qb.whereNull(column) : qb.whereNotNull(column);
      } else {
        const sqlOp = SAFE_OPS[op ?? 'eq'] ?? '=';
        qb.where(column, sqlOp, value);
      }
    }
  }

  private async executeTable(
    endpoint: EndpointDef,
    schema: string,
    params: Record<string, string>,
    query: Record<string, string>,
    body: unknown,
    projectId?: string,
  ) {
    const config = endpoint.source_config;
    const tableName = config.table as string;
    validateSchema(schema);
    validateIdentifier(tableName, 'table name');
    const rawOp = config.operation as string;
    const fullTable = `${schema}.${tableName}`;

    const OP_ALIASES: Record<string, string> = {
      list: 'find',
      get: 'findOne',
      read: 'findOne',
    };
    const operation = OP_ALIASES[rawOp] ?? rawOp;

    let result: unknown;

    switch (operation) {
      case 'find': {
        const page = Number(query.page ?? 1);
        const limit = Math.min(Number(query.limit ?? 50), 100);
        const offset = (page - 1) * limit;

        const q = this.db(fullTable);
        const countQ = this.db(fullTable);

        this.applyFilters(q, query);
        this.applyFilters(countQ, query);

        const explicitSort = (query.sort ?? (config.default_sort as string | undefined));
        const order = (query.order ?? 'desc') as 'asc' | 'desc';
        if (order !== 'asc' && order !== 'desc') {
          throw new AppError(400, 'Invalid sort order');
        }
        let sort: string | null = explicitSort ?? null;
        if (sort && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(sort)) {
          throw new AppError(400, 'Invalid sort field');
        }
        if (!sort) {
          const cols = await this.db('information_schema.columns')
            .where({ table_schema: schema, table_name: tableName })
            .pluck('column_name');
          const colSet = new Set(cols as string[]);
          if (colSet.has('created_at')) sort = 'created_at';
          else if (colSet.has('id')) sort = 'id';
        }

        const [{ count }] = await countQ.count('* as count');
        const data = sort
          ? await q.orderBy(sort, order).offset(offset).limit(limit)
          : await q.offset(offset).limit(limit);

        result = {
          data,
          pagination: { page, limit, total: Number(count), totalPages: Math.ceil(Number(count) / limit) },
        };
        break;
      }

      case 'findOne': {
        const searchColumn = String(config.search_column ?? 'id');
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(searchColumn)) {
          throw new AppError(400, 'Invalid search column');
        }
        const value = params[searchColumn] ?? query[searchColumn] ?? params.id ?? query.id;
        if (!value) throw new AppError(400, `${searchColumn} required`);
        const findOneQ = this.db(fullTable).where(searchColumn, value);
        const record = await findOneQ.first();
        if (!record) throw new AppError(404, 'Record not found');
        result = record;
        break;
      }

      case 'create': {
        if (!body || Array.isArray(body)) throw new AppError(400, 'Request body required (object)');
        const cleanBody = this.sanitizeBody(body as Record<string, unknown>);
        if (Object.keys(cleanBody).length === 0) {
          throw new AppError(400, 'Request body must contain at least one field');
        }
        const [record] = await this.db(fullTable).insert(cleanBody).returning('*');
        if (this.onMutation) this.onMutation('INSERT', tableName, record);
        result = record;
        break;
      }

      case 'create_many': {
        let rows: Record<string, unknown>[];
        if (Array.isArray(body)) {
          rows = body as Record<string, unknown>[];
        } else if (body && Array.isArray((body as Record<string, unknown>).rows)) {
          rows = (body as { rows: Record<string, unknown>[] }).rows;
        } else {
          throw new AppError(400, 'Body must be a JSON array of objects, NDJSON, or {"rows": [...]}');
        }
        if (rows.length === 0) {
          result = { inserted: 0, skipped: 0, errors: [] };
          break;
        }

        const maxBatch = Number(config.max_batch_size ?? 1000);
        if (rows.length > maxBatch) {
          throw new AppError(413, `Batch size ${rows.length} exceeds max_batch_size ${maxBatch}`);
        }

        const onConflict = (config.on_conflict as string) ?? 'error';
        if (!['error', 'do_nothing', 'do_update'].includes(onConflict)) {
          throw new AppError(400, `Invalid on_conflict "${onConflict}". Use: error, do_nothing, do_update.`);
        }
        const conflictColumns = (config.conflict_columns as string[]) ?? [];
        if ((onConflict === 'do_nothing' || onConflict === 'do_update') && conflictColumns.length === 0) {
          throw new AppError(400, 'conflict_columns is required when on_conflict is "do_nothing" or "do_update"');
        }
        for (const c of conflictColumns) validateIdentifier(c, 'conflict column');

        const errors: Array<{ index: number; error: string }> = [];
        let inserted = 0;
        let skipped = 0;

        const allKeys = new Set<string>();
        for (const row of rows) {
          const clean = this.sanitizeBody(row ?? {});
          for (const k of Object.keys(clean)) allKeys.add(k);
        }

        await this.db.transaction(async (trx) => {
          for (let i = 0; i < rows.length; i++) {
            const raw = rows[i];
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
              errors.push({ index: i, error: 'Row must be a non-null object' });
              continue;
            }
            const cleanRow = this.sanitizeBody(raw);
            if (Object.keys(cleanRow).length === 0) {
              errors.push({ index: i, error: 'Row is empty after removing system columns' });
              continue;
            }

            try {
              await trx.transaction(async (sp) => {
                let q = sp(fullTable).insert(cleanRow);
                if (onConflict === 'do_nothing') {
                  q = (q as any).onConflict(conflictColumns).ignore();
                } else if (onConflict === 'do_update') {
                  const updateCols = Object.keys(cleanRow).filter(c => !conflictColumns.includes(c));
                  if (updateCols.length > 0) {
                    q = (q as any).onConflict(conflictColumns).merge(updateCols);
                  } else {
                    q = (q as any).onConflict(conflictColumns).ignore();
                  }
                }
                const affected = await (q as any).returning('*');
                if (Array.isArray(affected) && affected.length > 0) {
                  inserted++;
                  if (this.onMutation) this.onMutation('INSERT', tableName, affected[0]);
                } else {
                  skipped++;
                }
              });
            } catch (err) {
              errors.push({ index: i, error: (err as Error).message });
            }
          }
        });

        result = { inserted, skipped, errors };
        break;
      }

      case 'update': {
        const id = params.id ?? query.id;
        if (!id) throw new AppError(400, 'ID required');
        if (!body) throw new AppError(400, 'Request body required');
        const updateData = this.sanitizeBody(body);
        if (Object.keys(updateData).length === 0) {
          throw new AppError(400, 'Request body must contain at least one field to update');
        }
        const [record] = await this.db(fullTable).where({ id }).update(updateData).returning('*');
        if (!record) throw new AppError(404, 'Record not found');
        if (this.onMutation) this.onMutation('UPDATE', tableName, record);
        result = record;
        break;
      }

      case 'delete': {
        const id = params.id ?? query.id;
        if (!id) throw new AppError(400, 'ID required');
        const existing = await this.db(fullTable).where({ id }).first();
        if (!existing) throw new AppError(404, 'Record not found');
        await this.db(fullTable).where({ id }).delete();
        if (this.onMutation) this.onMutation('DELETE', tableName, existing);
        result = { deleted: true };
        break;
      }

      default:
        throw new AppError(400, `Unsupported operation: ${operation}`);
    }

    return this.filterResponse(result, endpoint.response_config);
  }

  private async executeSQL(
    endpoint: EndpointDef,
    schema: string,
    params: Record<string, string>,
    query: Record<string, string>,
    body: Record<string, unknown> | null,
    timeoutMs = 30_000,
  ) {
    if (!/^[a-z_][a-z0-9_]*$/.test(schema)) {
      throw new AppError(400, 'Invalid schema name');
    }

    const config = endpoint.source_config;
    const sql = config.query as string;

    const bodyObj: Record<string, unknown> = (body && typeof body === 'object' && !Array.isArray(body))
      ? (body as Record<string, unknown>)
      : {};
    const allParams: Record<string, unknown> = { ...params, ...query, ...bodyObj };
    const paramValues: unknown[] = [];
    const missing: string[] = [];

    const parameterizedSql = sql.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_match, key) => {
      if (!(key in allParams) || allParams[key] === undefined) {
        missing.push(key);
        return _match;
      }
      paramValues.push(allParams[key]);
      return '?';
    });

    if (missing.length > 0) {
      const available = Object.keys(allParams);
      const availableHint = available.length > 0 ? ` Available keys: ${available.join(', ')}.` : ' No params/query/body keys were provided.';
      throw new AppError(400, `Missing parameter${missing.length > 1 ? 's' : ''} for {{${missing.join('}}, {{')}}}. Pass values via path, query string, or JSON body.${availableHint}`);
    }

    await validateSchemaAccess(parameterizedSql, schema, this.db);

    const upperSql = sql.trim().toUpperCase();
    if (upperSql.startsWith('WITH') && /\b(INSERT|UPDATE|DELETE)\b/i.test(sql)) {
      if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(endpoint.method ?? '')) {
        throw new AppError(403, 'WITH clause with mutations only allowed on POST/PUT/PATCH/DELETE endpoints');
      }
    }

    const clamped = Math.max(1000, Math.min(timeoutMs, 120_000));
    const result = await this.db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL statement_timeout = ${clamped}`);
      await trx.raw(`SET LOCAL search_path TO "${schema}"`);
      return trx.raw(parameterizedSql, paramValues as any[]) as any;
    });

    const rows = result.rows ?? result;
    return this.filterResponse(rows, endpoint.response_config);
  }
}
