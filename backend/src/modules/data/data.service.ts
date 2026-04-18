import type { Knex } from 'knex';
import { AppError } from '../../middleware/error-handler.js';
import { applyFilters, type FilterCondition } from './data.filter.js';
import { getPaginationMeta } from '../../utils/pagination.js';
import { WebhookDispatcher } from '../webhooks/dispatcher.js';
import { WebSocketService } from '../realtime/websocket.service.js';
import { isModuleEnabled } from '../../utils/module-check.js';
import { fireDiscordWebhooks } from '../plugins/built-in/discord-webhook/discord-webhook.routes.js';
import { fireTelegramNotifications } from '../plugins/built-in/telegram-bot/telegram-bot.routes.js';

function stringifyJsonbFields(row: Record<string, unknown>): Record<string, unknown> {
  const fixed: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    fixed[k] = (v !== null && typeof v === 'object') ? JSON.stringify(v) : v;
  }
  return fixed;
}

interface QueryParams {
  page: number;
  limit: number;
  sort?: string;
  order: 'asc' | 'desc';
  filters?: FilterCondition[];
  search?: string;
  searchColumns?: string[];
  include_deleted?: boolean;
  only_deleted?: boolean;
  /** If false, skip the `COUNT(*) OVER()` window and use pg_class.reltuples estimate. Saves 100-500ms on large tables where exact totals aren't needed. */
  approx_count?: boolean;
}

export class DataService {
  private webhookDispatcher: WebhookDispatcher;
  private columnCache = new Map<string, { columns: { column_name: string; data_type: string }[]; expiry: number }>();
  private static COLUMN_CACHE_TTL = 300_000;

  constructor(private db: Knex) {
    this.webhookDispatcher = new WebhookDispatcher(db);
  }

  private async getColumns(schema: string, tableName: string): Promise<{ column_name: string; data_type: string }[]> {
    const key = `${schema}.${tableName}`;
    const cached = this.columnCache.get(key);
    if (cached && cached.expiry > Date.now()) return cached.columns;

    const result = await this.db.raw(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position`,
      [schema, tableName]
    );
    const columns = result.rows;
    this.columnCache.set(key, { columns, expiry: Date.now() + DataService.COLUMN_CACHE_TTL });
    return columns;
  }

  invalidateColumnCache(schema: string, tableName: string) {
    this.columnCache.delete(`${schema}.${tableName}`);
  }

  private fireWebhooks(projectId: string, tableName: string, event: string, record: Record<string, unknown>) {
    try {
      const ws = WebSocketService.getInstance();
      ws.broadcastDataChange(projectId, tableName, event as 'INSERT' | 'UPDATE' | 'DELETE', record);
    } catch {}

    Promise.all([
      isModuleEnabled(this.db, projectId, 'feature-webhooks').then((enabled) => {
        if (!enabled) return;
        return this.db('webhooks')
          .where({ project_id: projectId, is_active: true })
          .whereRaw('? = ANY(table_names)', [tableName])
          .whereRaw('? = ANY(events)', [event])
          .then((webhooks) => {
            for (const wh of webhooks) {
              this.webhookDispatcher.dispatch(wh, event, { table: tableName, event, record, timestamp: new Date().toISOString() }).catch(() => {});
            }
          });
      }),
      fireDiscordWebhooks(this.db, projectId, tableName, event, record),
      fireTelegramNotifications(this.db, projectId, tableName, event, record),
    ]).catch(() => {});
  }

  private async hasDeletedAtColumn(schema: string, tableName: string): Promise<boolean> {
    const columns = await this.getColumns(schema, tableName);
    return columns.some(c => c.column_name === 'deleted_at');
  }

  async findAll(schema: string, tableName: string, params: QueryParams) {
    const columns = await this.getColumns(schema, tableName);
    const columnNames = columns.map(c => c.column_name);
    const hasDeletedAt = columnNames.includes('deleted_at');

    const baseQuery = this.db(`${schema}.${tableName}`);
    let query = baseQuery.clone();

    if (hasDeletedAt) {
      if (params.only_deleted) {
        query = query.whereNotNull('deleted_at');
      } else if (!params.include_deleted) {
        query = query.whereNull('deleted_at');
      }
    }

    if (params.filters && params.filters.length > 0) {
      query = applyFilters(query, params.filters);
    }

    // Adaptive search strategy. The old version did `"<col>"::text ILIKE '%x%'` on every column,
    // which disables btree indexes (cast loses index eligibility) and forces seq scan on 500k+ rows.
    // Now we split the search by column category:
    //   - numeric columns: use equality ONLY if the query looks like a number (preserves btree/PK usage)
    //   - text columns: ILIKE WITHOUT ::text cast (lets pg_trgm GIN indexes kick in when present)
    //   - non-numeric, non-text types are skipped (rarely useful for substring search anyway)
    if (params.search) {
      let searchCols = params.searchColumns ?? [];
      const colsByName = new Map(columns.map(c => [c.column_name, c.data_type]));

      if (searchCols.length === 0) {
        const TEXT_TYPES = new Set(['text', 'character varying', 'character', 'name', 'citext']);
        const NUM_TYPES = new Set(['integer', 'bigint', 'smallint', 'numeric', 'real', 'double precision']);
        const SKIP_COLUMNS = new Set(['id', 'created_at', 'updated_at', 'deleted_at']);
        searchCols = columns
          .filter(r => (TEXT_TYPES.has(r.data_type) || NUM_TYPES.has(r.data_type)) && !SKIP_COLUMNS.has(r.column_name))
          .map(r => r.column_name);
      }

      if (searchCols.length > 0) {
        const raw = params.search.trim();
        const isInt = /^-?\d+$/.test(raw);
        const isFloat = /^-?\d+(\.\d+)?$/.test(raw);
        const searchTerm = `%${raw}%`;
        const TEXT_TYPES = new Set(['text', 'character varying', 'character', 'name', 'citext']);

        query = query.where(function (this: Knex.QueryBuilder) {
          for (const col of searchCols) {
            const dt = colsByName.get(col);
            if (!dt) continue;
            if (TEXT_TYPES.has(dt)) {
              // Use the column directly so pg_trgm GIN index (when present) is eligible
              this.orWhereRaw(`"${col}" ILIKE ?`, [searchTerm]);
            } else if (dt === 'integer' || dt === 'smallint') {
              if (isInt) this.orWhere(col, '=', parseInt(raw, 10));
            } else if (dt === 'bigint') {
              if (isInt) this.orWhereRaw(`"${col}" = ?`, [raw]); // bigint as string to avoid JS precision loss
            } else if (dt === 'numeric' || dt === 'real' || dt === 'double precision') {
              if (isFloat) this.orWhereRaw(`"${col}" = ?`, [raw]);
            }
            // Non-text/non-numeric columns are intentionally skipped from free-text search.
          }
        });
      }
    }

    // Adaptive default sort: if no sort is requested, prefer an indexed column.
    // created_at is the common default but has no index by default — sorting 500k rows in memory
    // costs 300-500ms. Fall back to id (PK, always indexed) when created_at lacks an index.
    let sortField = params.sort;
    if (!sortField) {
      if (columnNames.includes('created_at') && await this.hasIndexOn(schema, tableName, 'created_at')) {
        sortField = 'created_at';
      } else if (columnNames.includes('id')) {
        sortField = 'id';
      } else {
        sortField = columnNames[0];
      }
    }
    if (sortField && columnNames.includes(sortField)) {
      query = query.orderBy(sortField, params.order);
    }

    const offset = (params.page - 1) * params.limit;

    // Approximate count: avoid the expensive COUNT(*) OVER() window on large tables.
    // On a table with no WHERE clause, approx uses pg_class.reltuples (free, live-updated by PG).
    // Applies only when no filters/search are active (otherwise we'd need a real count for accuracy).
    const hasWhere = !!(params.filters?.length || params.search
      || (hasDeletedAt && (params.only_deleted || !params.include_deleted)));
    if (params.approx_count && !hasWhere) {
      query = query.select('*').offset(offset).limit(params.limit);
      const rows = await query;
      const est = await this.estimateRowCount(schema, tableName);
      return {
        data: rows,
        pagination: { ...getPaginationMeta(params.page, params.limit, est), approx: true },
      };
    }

    query = query.select(this.db.raw('*, COUNT(*) OVER() as _total_count')).offset(offset).limit(params.limit);
    const rows = await query;
    const total = rows.length > 0 ? Number(rows[0]._total_count) : 0;
    const data = rows.map((r: Record<string, unknown>) => {
      const { _total_count, ...rest } = r;
      return rest;
    });

    return {
      data,
      pagination: getPaginationMeta(params.page, params.limit, total),
    };
  }

  private indexCache = new Map<string, { cols: Set<string>; expiry: number }>();
  private async hasIndexOn(schema: string, tableName: string, column: string): Promise<boolean> {
    const key = `${schema}.${tableName}`;
    let entry = this.indexCache.get(key);
    if (!entry || entry.expiry < Date.now()) {
      const r: any = await this.db.raw(`
        SELECT DISTINCT a.attname AS col
        FROM pg_index idx
        JOIN pg_class i ON i.oid = idx.indexrelid
        JOIN pg_class t ON t.oid = idx.indrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(idx.indkey)
        WHERE n.nspname = ? AND t.relname = ? AND idx.indpred IS NULL
      `, [schema, tableName]);
      const cols = new Set<string>((r.rows as { col: string }[]).map(x => x.col));
      entry = { cols, expiry: Date.now() + 60_000 };
      this.indexCache.set(key, entry);
    }
    return entry.cols.has(column);
  }

  private async estimateRowCount(schema: string, tableName: string): Promise<number> {
    try {
      const r: any = await this.db.raw(
        `SELECT reltuples::bigint AS n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE ns.nspname = ? AND c.relname = ?`,
        [schema, tableName]
      );
      return Number(r.rows?.[0]?.n ?? 0);
    } catch {
      return 0;
    }
  }

  async findById(schema: string, tableName: string, id: string) {
    const result = await this.db.raw(
      `SELECT * FROM "${schema}"."${tableName}" WHERE "id" = ? LIMIT 1`,
      [id]
    );
    const row = result.rows?.[0];
    if (!row) {
      throw new AppError(404, 'Record not found');
    }
    return row;
  }

  async create(schema: string, tableName: string, data: Record<string, unknown>, projectId?: string) {
    const [row] = await this.db(`${schema}.${tableName}`).insert(stringifyJsonbFields(data)).returning('*');
    if (projectId) this.fireWebhooks(projectId, tableName, 'INSERT', row);
    return row;
  }

  async update(schema: string, tableName: string, id: string, data: Record<string, unknown>, projectId?: string) {
    const { id: _id, created_at: _ca, updated_at: _ua, ...updateData } = data;
    const safeData = stringifyJsonbFields(updateData);

    const [row] = await this.db(`${schema}.${tableName}`)
      .where({ id })
      .update(safeData)
      .returning('*');

    if (!row) {
      throw new AppError(404, 'Record not found');
    }
    if (projectId) this.fireWebhooks(projectId, tableName, 'UPDATE', row);
    return row;
  }

  async updateField(schema: string, tableName: string, id: string, field: string, value: unknown) {
    const [row] = await this.db(`${schema}.${tableName}`)
      .where({ id })
      .update({ [field]: value })
      .returning('*');

    if (!row) {
      throw new AppError(404, 'Record not found');
    }
    return row;
  }

  async delete(schema: string, tableName: string, id: string, projectId?: string) {
    const hasSoftDelete = await this.hasDeletedAtColumn(schema, tableName);
    if (hasSoftDelete) {
      const [row] = await this.db(`${schema}.${tableName}`)
        .where({ id })
        .update({ deleted_at: this.db.fn.now() })
        .returning('*');
      if (!row) throw new AppError(404, 'Record not found');
      if (projectId) this.fireWebhooks(projectId, tableName, 'DELETE', row);
    } else {
      const record = await this.db(`${schema}.${tableName}`).where({ id }).first();
      if (!record) throw new AppError(404, 'Record not found');
      await this.db(`${schema}.${tableName}`).where({ id }).delete();
      if (projectId) this.fireWebhooks(projectId, tableName, 'DELETE', record);
    }
  }

  async bulkDelete(schema: string, tableName: string, ids: string[]) {
    const hasSoftDelete = await this.hasDeletedAtColumn(schema, tableName);
    if (hasSoftDelete) {
      const deleted = await this.db(`${schema}.${tableName}`)
        .whereIn('id', ids)
        .update({ deleted_at: this.db.fn.now() });
      return { deleted };
    } else {
      const deleted = await this.db(`${schema}.${tableName}`)
        .whereIn('id', ids)
        .delete();
      return { deleted };
    }
  }

  async restore(schema: string, tableName: string, id: string) {
    const [row] = await this.db(`${schema}.${tableName}`)
      .where({ id })
      .update({ deleted_at: null })
      .returning('*');
    if (!row) {
      throw new AppError(404, 'Record not found');
    }
    return row;
  }

  async bulkInsertWithWebhooks(schema: string, tableName: string, records: Record<string, unknown>[], projectId: string) {
    const batchSize = 500;
    let inserted = 0;
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize).map(stringifyJsonbFields);
      const rows = await this.db(`${schema}.${tableName}`).insert(batch).returning('*');
      inserted += rows.length;
      for (const row of rows) {
        this.fireWebhooks(projectId, tableName, 'INSERT', row);
      }
    }
    return inserted;
  }

  async permanentDelete(schema: string, tableName: string, id: string) {
    const deleted = await this.db(`${schema}.${tableName}`).where({ id }).delete();
    if (!deleted) {
      throw new AppError(404, 'Record not found');
    }
  }

  async bulkUpdate(schema: string, tableName: string, ids: string[], field: string, value: unknown) {
    const safeValue = (value !== null && typeof value === 'object') ? JSON.stringify(value) : value;
    const updated = await this.db(`${schema}.${tableName}`)
      .whereIn('id', ids)
      .update({ [field]: safeValue });
    return { updated };
  }

  async importRecords(schema: string, tableName: string, records: Record<string, unknown>[]) {
    const batchSize = 500;
    let inserted = 0;
    const errors: { index: number; error: string }[] = [];

    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize).map(stringifyJsonbFields);
      try {
        await this.db(`${schema}.${tableName}`).insert(batch);
        inserted += batch.length;
      } catch {
        const results = await Promise.allSettled(
          batch.map((record, j) =>
            this.db(`${schema}.${tableName}`).insert(record)
              .then(() => ({ index: i + j, ok: true as const }))
              .catch((e: Error) => ({ index: i + j, ok: false as const, error: e.message }))
          )
        );
        for (const r of results) {
          if (r.status === 'fulfilled') {
            if (r.value.ok) inserted++;
            else errors.push({ index: r.value.index, error: r.value.error });
          }
        }
      }
    }

    return { inserted, errors, total: records.length };
  }

  async exportRecords(schema: string, tableName: string, filters?: FilterCondition[], maxRows?: number) {
    let query = this.db(`${schema}.${tableName}`);
    if (filters && filters.length > 0) {
      query = applyFilters(query, filters);
    }
    const safeLimit = maxRows && maxRows > 0 ? maxRows : 10000;
    query = query.limit(safeLimit);
    return query.orderBy('created_at', 'desc');
  }

  async getTextColumns(schema: string, tableName: string): Promise<string[]> {
    const result = await this.db.raw(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = ? AND table_name = ?
        AND data_type IN ('text', 'character varying', 'character')
    `, [schema, tableName]);
    return result.rows.map((r: { column_name: string }) => r.column_name);
  }
}
