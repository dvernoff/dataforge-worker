import type { Knex } from 'knex';
import { AppError } from '../../middleware/error-handler.js';
import { applyFilters, type FilterCondition } from './data.filter.js';
import { getPaginationMeta } from '../../utils/pagination.js';

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
  constructor(private db: Knex) {}

  private async hasDeletedAtColumn(schema: string, tableName: string): Promise<boolean> {
    try {
      const result = await this.db.raw(
        `SELECT 1 FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = 'deleted_at'`,
        [schema, tableName]
      );
      return result.rows.length > 0;
    } catch {
      return false;
    }
  }

  async findAll(schema: string, tableName: string, params: QueryParams) {
    const baseQuery = this.db(`${schema}.${tableName}`);

    let query = baseQuery.clone();

    try {
      const hasDeletedAt = await this.db.raw(
        `SELECT 1 FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = 'deleted_at'`,
        [schema, tableName]
      );
      if (hasDeletedAt.rows.length > 0) {
        if (params.only_deleted) {
          query = query.whereNotNull('deleted_at');
        } else if (!params.include_deleted) {
          query = query.whereNull('deleted_at');
        }
      }
    } catch {}

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

        const colsResult = await this.db.raw(
          `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = ? AND table_name = ?`,
          [schema, tableName]
        );
        searchCols = colsResult.rows
          .filter((r: { column_name: string; data_type: string }) =>
            SEARCHABLE_TYPES.has(r.data_type) && !SKIP_COLUMNS.has(r.column_name)
          )
          .map((r: { column_name: string }) => r.column_name);
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

    const countQuery = query.clone();
    const [{ count }] = await countQuery.count('* as count');
    const total = Number(count);

    const sortField = params.sort ?? 'created_at';
    const columnsResult = await this.db.raw(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = ? AND table_name = ?`,
      [schema, tableName]
    );
    const validColumns = columnsResult.rows.map((r: { column_name: string }) => r.column_name);
    if (!validColumns.includes(sortField)) {
      throw new AppError(400, 'Invalid sort field');
    }
    query = query.orderBy(sortField, params.order);

    const offset = (params.page - 1) * params.limit;
    query = query.offset(offset).limit(params.limit);

    const rows = await query;

    return {
      data: rows,
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

  async create(schema: string, tableName: string, data: Record<string, unknown>) {
    const [row] = await this.db(`${schema}.${tableName}`).insert(data).returning('*');
    return row;
  }

  async update(schema: string, tableName: string, id: string, data: Record<string, unknown>) {
    const { id: _id, created_at: _ca, updated_at: _ua, ...updateData } = data;

    const [row] = await this.db(`${schema}.${tableName}`)
      .where({ id })
      .update(updateData)
      .returning('*');

    if (!row) {
      throw new AppError(404, 'Record not found');
    }
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

  async delete(schema: string, tableName: string, id: string) {
    const hasSoftDelete = await this.hasDeletedAtColumn(schema, tableName);
    if (hasSoftDelete) {
      const [row] = await this.db(`${schema}.${tableName}`)
        .where({ id })
        .update({ deleted_at: this.db.fn.now() })
        .returning('*');
      if (!row) throw new AppError(404, 'Record not found');
    } else {
      const deleted = await this.db(`${schema}.${tableName}`).where({ id }).delete();
      if (!deleted) throw new AppError(404, 'Record not found');
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

  async permanentDelete(schema: string, tableName: string, id: string) {
    const deleted = await this.db(`${schema}.${tableName}`).where({ id }).delete();
    if (!deleted) {
      throw new AppError(404, 'Record not found');
    }
  }

  async bulkUpdate(schema: string, tableName: string, ids: string[], field: string, value: unknown) {
    const updated = await this.db(`${schema}.${tableName}`)
      .whereIn('id', ids)
      .update({ [field]: value });
    return { updated };
  }

  async importRecords(schema: string, tableName: string, records: Record<string, unknown>[]) {
    const batchSize = 500;
    let inserted = 0;
    const errors: { index: number; error: string }[] = [];

    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      try {
        await this.db(`${schema}.${tableName}`).insert(batch);
        inserted += batch.length;
      } catch (err) {
        for (let j = 0; j < batch.length; j++) {
          try {
            await this.db(`${schema}.${tableName}`).insert(batch[j]);
            inserted++;
          } catch (e) {
            errors.push({ index: i + j, error: (e as Error).message });
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
    if (maxRows && maxRows > 0) {
      query = query.limit(maxRows);
    }
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
