import type { Knex } from 'knex';

export interface PivotConfig {
  table: string;
  rows: string[];         // group by columns
  columns?: string;       // pivot column (optional)
  values: string;         // aggregation column
  aggregation: 'count' | 'sum' | 'avg' | 'min' | 'max';
}

export class ExplorerService {
  async executePivot(db: Knex, schema: string, config: PivotConfig) {
    const { table, rows, values, aggregation } = config;

    // Validate aggregation function
    const validAgg = ['count', 'sum', 'avg', 'min', 'max'];
    if (!validAgg.includes(aggregation)) {
      throw Object.assign(new Error('Invalid aggregation function'), { statusCode: 400 });
    }

    // Validate all identifiers to prevent injection
    const identifierRegex = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
    if (!identifierRegex.test(table)) {
      throw Object.assign(new Error('Invalid table name'), { statusCode: 400 });
    }
    if (!identifierRegex.test(values)) {
      throw Object.assign(new Error('Invalid column name'), { statusCode: 400 });
    }
    for (const col of rows) {
      if (!identifierRegex.test(col)) {
        throw Object.assign(new Error('Invalid column name'), { statusCode: 400 });
      }
    }

    // Build quoted identifiers
    const qualifiedTable = `"${schema}"."${table}"`;
    const groupByColumns = rows.map((col) => `"${col}"`);
    const valueCol = `"${values}"`;

    // Build aggregation expression
    const aggExpr = aggregation === 'count'
      ? `COUNT(${valueCol})`
      : `${aggregation.toUpperCase()}(${valueCol})`;

    const selectCols = [...groupByColumns, `${aggExpr} as "agg_value"`];
    const groupByClause = groupByColumns.join(', ');

    const sql = `SELECT ${selectCols.join(', ')} FROM ${qualifiedTable} GROUP BY ${groupByClause} ORDER BY "agg_value" DESC LIMIT 1000`;

    const result = await db.raw(sql);
    return {
      rows: result.rows,
      rowCount: result.rows.length,
      columns: [...rows, 'agg_value'],
    };
  }

  async listTables(db: Knex, schema: string) {
    // Get all tables in the schema
    const tables = await db
      .select('table_name')
      .from('information_schema.tables')
      .where('table_schema', schema)
      .where('table_type', 'BASE TABLE')
      .orderBy('table_name');

    // Get columns for each table
    const result = await Promise.all(
      tables.map(async (t) => {
        const columns = await db
          .select('column_name', 'data_type', 'is_nullable')
          .from('information_schema.columns')
          .where('table_schema', schema)
          .where('table_name', t.table_name)
          .orderBy('ordinal_position');

        return {
          name: t.table_name,
          columns: columns.map((c) => ({
            name: c.column_name,
            type: c.data_type,
            nullable: c.is_nullable === 'YES',
          })),
        };
      })
    );

    return result;
  }
}
