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

    if (params.search) {
      let searchCols = params.searchColumns ?? [];

      if (searchCols.length === 0) {
        const SEARCHABLE_TYPES = new Set([
          'text', 'character varying', 'character', 'name', 'citext',
          'integer', 'bigint', 'smallint', 'numeric', 'real', 'double precision',
        ]);
        const SKIP_COLUMNS = new Set(['id', 'created_at', 'updated_at', 'deleted_at']);

        searchCols = columns
          .filter(r => SEARCHABLE_TYPES.has(r.data_type) && !SKIP_COLUMNS.has(r.column_name))
          .map(r => r.column_name);
      }

      if (searchCols.length > 0) {
        const searchTerm = `%${params.search}%`;
        query = query.where(function (this: Knex.QueryBuilder) {
          for (const col of searchCols) {
            this.orWhereRaw(`"${col}"::text ILIKE ?`, [searchTerm]);
          }
        });
      }
    }

    const sortField = params.sort ?? (columnNames.includes('created_at') ? 'created_at' : columnNames[0]);
    if (sortField && columnNames.includes(sortField)) {
      query = query.orderBy(sortField, params.order);
    }

    const offset = (params.page - 1) * params.limit;
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
