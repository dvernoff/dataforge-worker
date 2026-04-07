import type { Knex } from 'knex';
import { AppError } from '../../middleware/error-handler.js';
import type {
  TableDefinition, ColumnDef, ForeignKeyDef, IndexDef, AlterColumnDef, PG_TYPE_MAP as PgTypeMapType,
} from './schema.types.js';
import { PG_TYPE_MAP } from './schema.types.js';

export class SchemaService {
  constructor(private db: Knex) {}

  async listTables(schema: string) {
    const result = await this.db.raw(`
      SELECT
        t.table_name as name,
        (SELECT COUNT(*) FROM information_schema.columns c
         WHERE c.table_schema = t.table_schema AND c.table_name = t.table_name)::int as column_count
      FROM information_schema.tables t
      WHERE t.table_schema = ? AND t.table_type = 'BASE TABLE'
      ORDER BY t.table_name
    `, [schema]);

    const tables = [];
    for (const row of result.rows) {
      try {
        const countResult = await this.db.raw(
          `SELECT COUNT(*)::int as count FROM "${schema}"."${row.name}"`
        );
        tables.push({
          name: row.name,
          column_count: row.column_count,
          row_count: countResult.rows[0].count,
        });
      } catch {
        tables.push({ name: row.name, column_count: row.column_count, row_count: 0 });
      }
    }

    return tables;
  }

  async getTableInfo(schema: string, tableName: string) {
    const columns = await this.db.raw(`
      SELECT
        c.column_name as name,
        c.data_type as type,
        c.udt_name as udt_type,
        c.is_nullable = 'YES' as nullable,
        c.column_default as default_value,
        c.ordinal_position
      FROM information_schema.columns c
      WHERE c.table_schema = ? AND c.table_name = ?
      ORDER BY c.ordinal_position
    `, [schema, tableName]);

    const pks = await this.db.raw(`
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.table_schema = ? AND tc.table_name = ? AND tc.constraint_type = 'PRIMARY KEY'
    `, [schema, tableName]);
    const pkColumns = new Set(pks.rows.map((r: { column_name: string }) => r.column_name));

    const uniques = await this.db.raw(`
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.table_schema = ? AND tc.table_name = ? AND tc.constraint_type = 'UNIQUE'
    `, [schema, tableName]);
    const uniqueColumns = new Set(uniques.rows.map((r: { column_name: string }) => r.column_name));

    const TAIL_COLS = new Set(['created_at', 'updated_at', 'deleted_at']);
    const allCols = columns.rows.map((col: Record<string, unknown>) => ({
      name: col.name,
      type: col.udt_type === 'uuid' ? 'uuid' : col.type,
      nullable: col.nullable,
      default_value: col.default_value,
      is_primary: pkColumns.has(col.name as string),
      is_unique: uniqueColumns.has(col.name as string),
    }));
    const columnList = [
      ...allCols.filter((c: { name: string }) => c.name === 'id'),
      ...allCols.filter((c: { name: string }) => c.name !== 'id' && !TAIL_COLS.has(c.name)),
      ...allCols.filter((c: { name: string }) => TAIL_COLS.has(c.name)),
    ];

    const fks = await this.db.raw(`
      SELECT
        tc.constraint_name,
        kcu.column_name as source_column,
        ccu.table_name as target_table,
        ccu.column_name as target_column,
        rc.delete_rule as on_delete,
        rc.update_rule as on_update
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      JOIN information_schema.referential_constraints rc
        ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.table_schema
      WHERE tc.table_schema = ? AND tc.table_name = ? AND tc.constraint_type = 'FOREIGN KEY'
    `, [schema, tableName]);

    const indexes = await this.db.raw(`
      SELECT
        i.relname as name,
        am.amname as type,
        ix.indisunique as is_unique,
        array_agg(a.attname ORDER BY k.n) as columns
      FROM pg_index ix
      JOIN pg_class t ON t.oid = ix.indrelid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_am am ON am.oid = i.relam
      CROSS JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, n)
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
      WHERE n.nspname = ? AND t.relname = ?
        AND NOT ix.indisprimary
      GROUP BY i.relname, am.amname, ix.indisunique
    `, [schema, tableName]);

    let rowCount = 0;
    try {
      const countRes = await this.db.raw(
        `SELECT COUNT(*)::int as count FROM "${schema}"."${tableName}"`
      );
      rowCount = countRes.rows[0].count;
    } catch {}

    const normalizedIndexes = indexes.rows.map((idx: any) => ({
      ...idx,
      columns: Array.isArray(idx.columns)
        ? idx.columns
        : String(idx.columns).replace(/^\{|\}$/g, '').split(',').map((c: string) => c.trim()),
    }));

    return {
      name: tableName,
      columns: columnList,
      foreign_keys: fks.rows,
      indexes: normalizedIndexes,
      row_count: rowCount,
    };
  }

  async createTable(schema: string, def: TableDefinition): Promise<string> {
    const parts: string[] = [];

    if (def.add_uuid_pk) {
      parts.push(`"id" UUID PRIMARY KEY DEFAULT gen_random_uuid()`);
    }

    for (const col of def.columns) {
      if (col.name === 'id' && def.add_uuid_pk) continue;
      parts.push(this.buildColumnSQL(col));
    }

    if (def.add_timestamps) {
      parts.push(`"created_at" TIMESTAMPTZ DEFAULT NOW()`);
      parts.push(`"updated_at" TIMESTAMPTZ DEFAULT NOW()`);
    }

    const sql = `CREATE TABLE "${schema}"."${def.name}" (\n  ${parts.join(',\n  ')}\n)`;

    await this.db.raw(sql);

    if (def.add_timestamps) {
      await this.db.raw(`
        CREATE OR REPLACE FUNCTION "${schema}".update_updated_at_column()
        RETURNS TRIGGER AS $$
        BEGIN
          NEW.updated_at = NOW();
          RETURN NEW;
        END;
        $$ language 'plpgsql';
      `);

      await this.db.raw(`
        CREATE TRIGGER update_${def.name}_updated_at
        BEFORE UPDATE ON "${schema}"."${def.name}"
        FOR EACH ROW EXECUTE FUNCTION "${schema}".update_updated_at_column();
      `);
    }

    return sql;
  }

  async alterColumns(schema: string, tableName: string, changes: AlterColumnDef[]): Promise<string[]> {
    const sqls: string[] = [];

    for (const change of changes) {
      let sql = '';
      switch (change.action) {
        case 'add': {
          const pgType = PG_TYPE_MAP[change.type ?? 'text'] ?? 'TEXT';
          sql = `ALTER TABLE "${schema}"."${tableName}" ADD COLUMN "${change.name}" ${pgType}`;
          if (change.nullable === false) sql += ' NOT NULL';
          if (change.default_value !== undefined) {
            const val = String(change.default_value);
            if (/^[0-9]+(\.[0-9]+)?$/.test(val) || val === 'true' || val === 'false' || val === 'NULL' || val.startsWith('gen_') || val === 'now()') {
              sql += ` DEFAULT ${val}`;
            } else {
              sql += ` DEFAULT '${val.replace(/'/g, "''")}'`;
            }
          }
          break;
        }
        case 'alter': {
          if (change.type) {
            const pgType = PG_TYPE_MAP[change.type] ?? 'TEXT';
            sql = `ALTER TABLE "${schema}"."${tableName}" ALTER COLUMN "${change.name}" TYPE ${pgType}`;
            sqls.push(sql);
            await this.execAlterSql(sql, change.name, change.type);
          }
          if (change.nullable !== undefined) {
            sql = `ALTER TABLE "${schema}"."${tableName}" ALTER COLUMN "${change.name}" ${change.nullable ? 'DROP NOT NULL' : 'SET NOT NULL'}`;
            sqls.push(sql);
            await this.execAlterSql(sql, change.name);
          }
          if (change.default_value !== undefined) {
            if (change.default_value === null) {
              sql = `ALTER TABLE "${schema}"."${tableName}" ALTER COLUMN "${change.name}" DROP DEFAULT`;
            } else {
              const val = String(change.default_value);
              let defaultExpr: string;
              if (/^[0-9]+(\.[0-9]+)?$/.test(val) || val === 'true' || val === 'false' || val === 'NULL' || val.startsWith('gen_') || val === 'now()') {
                defaultExpr = val;
              } else {
                defaultExpr = `'${val.replace(/'/g, "''")}'`;
              }
              sql = `ALTER TABLE "${schema}"."${tableName}" ALTER COLUMN "${change.name}" SET DEFAULT ${defaultExpr}`;
            }
            sqls.push(sql);
            await this.execAlterSql(sql, change.name);
          }
          continue;
        }
        case 'drop':
          sql = `ALTER TABLE "${schema}"."${tableName}" DROP COLUMN IF EXISTS "${change.name}" CASCADE`;
          break;
        case 'rename':
          if (!change.newName) throw new AppError(400, 'newName required for rename');
          sql = `ALTER TABLE "${schema}"."${tableName}" RENAME COLUMN "${change.name}" TO "${change.newName}"`;
          break;
      }

      if (sql) {
        sqls.push(sql);
        await this.execAlterSql(sql, change.name, change.type);
      }
    }

    return sqls;
  }

  private async execAlterSql(sql: string, columnName: string, targetType?: string) {
    try {
      await this.db.raw(sql);
    } catch (err: unknown) {
      const pgErr = err as { code?: string; message?: string; detail?: string };
      const code = pgErr.code;
      const msg = pgErr.message ?? '';

      if (code === '42804' || code === '22P02' || msg.includes('cannot be cast')) {
        throw Object.assign(
          new AppError(400, `Cannot convert column "${columnName}" to ${targetType ?? 'the requested type'}`),
          { errorCode: 'INCOMPATIBLE_TYPE', column: columnName, targetType }
        );
      }

      if (code === '23502' || msg.includes('contains null values')) {
        throw Object.assign(
          new AppError(400, `Column "${columnName}" contains NULL values`),
          { errorCode: 'HAS_NULL_VALUES', column: columnName }
        );
      }

      if (code === '2BP01') {
        throw Object.assign(
          new AppError(400, `Column "${columnName}" has dependent objects`),
          { errorCode: 'HAS_DEPENDENTS', column: columnName }
        );
      }

      if (code === '42703') {
        throw Object.assign(
          new AppError(404, `Column "${columnName}" does not exist`),
          { errorCode: 'NOT_FOUND', column: columnName }
        );
      }

      if (code === '42701') {
        throw Object.assign(
          new AppError(409, `Column "${columnName}" already exists`),
          { errorCode: 'DUPLICATE_NAME', column: columnName }
        );
      }

      if (code === '23505') {
        throw Object.assign(
          new AppError(400, `Column "${columnName}" has duplicate values`),
          { errorCode: 'HAS_DUPLICATES', column: columnName }
        );
      }

      throw new AppError(400, `Column "${columnName}": ${msg}`);
    }
  }

  async dropTable(schema: string, tableName: string, projectId?: string): Promise<string[]> {
    const deleted: string[] = [];

    if (projectId) {
      const cleanup: [string, Promise<number>][] = [
        ['endpoints', this.db('api_endpoints').where({ project_id: projectId }).where(function () {
          this.whereRaw("source_config::text LIKE ?", [`%"table":"${tableName}"%`])
            .orWhereRaw("source_config::text LIKE ?", [`%"table": "${tableName}"%`])
            .orWhere('path', 'LIKE', `/${tableName}%`);
        }).delete()],
        ['webhooks', this.db('webhooks').where({ project_id: projectId, table_name: tableName }).delete()],
        ['validation_rules', this.db('validation_rules').where({ project_id: projectId, table_name: tableName }).delete()],
        ['rls_rules', this.db('rls_rules').where({ project_id: projectId, table_name: tableName }).delete()],
        ['data_history', this.db('data_history').where({ project_id: projectId, table_name: tableName }).delete()],
        ['comments', this.db('comments').where({ project_id: projectId, table_name: tableName }).delete()],
        ['files', this.db('files').where({ project_id: projectId, table_name: tableName }).delete()],
      ];

      for (const [name, promise] of cleanup) {
        try {
          const count = await promise;
          if (count > 0) deleted.push(`${count} ${name}`);
        } catch {}
      }
    }

    await this.db.raw(`DROP TABLE IF EXISTS "${schema}"."${tableName}" CASCADE`);
    return deleted;
  }

  async addForeignKey(schema: string, tableName: string, fk: ForeignKeyDef) {
    const constraintName = fk.constraint_name ?? `fk_${tableName}_${fk.source_column}_${fk.target_table}`;
    const sql = `
      ALTER TABLE "${schema}"."${tableName}"
      ADD CONSTRAINT "${constraintName}"
      FOREIGN KEY ("${fk.source_column}")
      REFERENCES "${schema}"."${fk.target_table}"("${fk.target_column}")
      ON DELETE ${fk.on_delete}
      ON UPDATE ${fk.on_update}
    `;
    try {
      await this.db.raw(sql);
    } catch (err: any) {
      if (err.code === '42830') {
        throw new AppError(400, `Column "${fk.target_table}"."${fk.target_column}" must have a UNIQUE or PRIMARY KEY constraint to be used as a foreign key target`);
      }
      if (err.code === '42804') {
        const detail = err.detail || '';
        throw new AppError(400, `Incompatible column types: ${detail || `"${fk.source_column}" and "${fk.target_column}" have different data types`}`);
      }
      if (err.code === '42710') {
        throw new AppError(400, `Foreign key "${constraintName}" already exists`);
      }
      if (err.code === '23503') {
        throw new AppError(400, `Existing data violates this constraint: ${err.detail || 'some rows reference values that do not exist in the target table'}. Clean up the data first.`);
      }
      throw err;
    }
    return sql;
  }

  async dropForeignKey(schema: string, tableName: string, constraintName: string) {
    await this.db.raw(
      `ALTER TABLE "${schema}"."${tableName}" DROP CONSTRAINT IF EXISTS "${constraintName}"`
    );
  }

  async addIndex(schema: string, tableName: string, idx: IndexDef) {
    const idxName = idx.name ?? `idx_${tableName}_${idx.columns.join('_')}`;
    const unique = idx.is_unique ? 'UNIQUE' : '';
    const using = idx.type !== 'btree' ? `USING ${idx.type}` : '';

    let cols: string;
    if (idx.type === 'gin' || idx.type === 'gist') {
      await this.db.raw('CREATE EXTENSION IF NOT EXISTS pg_trgm');
      const colTypes = await this.db.raw(
        `SELECT column_name, data_type FROM information_schema.columns
         WHERE table_schema = ? AND table_name = ?`,
        [schema, tableName]
      );
      const typeMap = new Map(colTypes.rows.map((r: any) => [r.column_name, r.data_type]));
      const textTypes = new Set(['text', 'character varying', 'character']);
      const opsClass = idx.type === 'gin' ? 'gin_trgm_ops' : 'gist_trgm_ops';
      cols = idx.columns.map(c => {
        const dt = typeMap.get(c);
        return textTypes.has(dt) ? `"${c}" ${opsClass}` : `"${c}"`;
      }).join(', ');
    } else {
      cols = idx.columns.map(c => `"${c}"`).join(', ');
    }

    const sql = `CREATE ${unique} INDEX IF NOT EXISTS "${idxName}" ON "${schema}"."${tableName}" ${using} (${cols})`;
    await this.db.raw(sql);
    return sql;
  }

  async dropIndex(schema: string, indexName: string) {
    await this.db.raw(`DROP INDEX IF EXISTS "${schema}"."${indexName}"`);
  }

  previewCreateTable(schema: string, def: TableDefinition): string {
    const parts: string[] = [];

    if (def.add_uuid_pk) {
      parts.push(`  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid()`);
    }

    for (const col of def.columns) {
      if (col.name === 'id' && def.add_uuid_pk) continue;
      parts.push(`  ${this.buildColumnSQL(col)}`);
    }

    if (def.add_timestamps) {
      parts.push(`  "created_at" TIMESTAMPTZ DEFAULT NOW()`);
      parts.push(`  "updated_at" TIMESTAMPTZ DEFAULT NOW()`);
    }

    return `CREATE TABLE "${schema}"."${def.name}" (\n${parts.join(',\n')}\n);`;
  }

  private buildColumnSQL(col: ColumnDef): string {
    const pgType = PG_TYPE_MAP[col.type] ?? 'TEXT';
    let sql = `"${col.name}" ${pgType}`;
    if (col.is_primary) sql += ' PRIMARY KEY';
    if (!col.nullable && !col.is_primary) sql += ' NOT NULL';
    if (col.is_unique && !col.is_primary) sql += ' UNIQUE';
    if (col.default_value) {
      const val = String(col.default_value);
      if (/^[0-9]+(\.[0-9]+)?$/.test(val) || val === 'true' || val === 'false' || val === 'NULL' || val.startsWith('gen_') || val === 'now()') {
        sql += ` DEFAULT ${val}`;
      } else {
        sql += ` DEFAULT '${val.replace(/'/g, "''")}'`;
      }
    }
    return sql;
  }
}
