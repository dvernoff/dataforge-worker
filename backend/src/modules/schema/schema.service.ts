import type { Knex } from 'knex';
import { AppError } from '../../middleware/error-handler.js';
import { validateSchema, validateIdentifier, validateIndexExpression, validateSchemaAccess } from '../../utils/sql-guard.js';
import type {
  TableDefinition, ColumnDef, ForeignKeyDef, IndexDef, AlterColumnDef, PG_TYPE_MAP as PgTypeMapType, StorageParams,
} from './schema.types.js';
import { PG_TYPE_MAP } from './schema.types.js';

// Whitelist of PostgreSQL storage parameters the user can tune.
// Values are validated numerically to prevent SQL injection.
const ALLOWED_STORAGE_PARAMS: Record<string, { min: number; max: number; integer?: boolean }> = {
  fillfactor: { min: 10, max: 100, integer: true },
  autovacuum_vacuum_scale_factor: { min: 0, max: 1 },
  autovacuum_vacuum_threshold: { min: 0, max: 2_000_000_000, integer: true },
  autovacuum_analyze_scale_factor: { min: 0, max: 1 },
  autovacuum_analyze_threshold: { min: 0, max: 2_000_000_000, integer: true },
};

function buildStorageParamsClause(params?: StorageParams | Record<string, number> | undefined): string {
  if (!params || Object.keys(params).length === 0) return '';
  const pairs: string[] = [];
  for (const [key, rawValue] of Object.entries(params as Record<string, number>)) {
    const spec = ALLOWED_STORAGE_PARAMS[key];
    if (!spec) throw new AppError(400, `Unknown storage parameter "${key}". Allowed: ${Object.keys(ALLOWED_STORAGE_PARAMS).join(', ')}`);
    const num = Number(rawValue);
    if (!Number.isFinite(num)) throw new AppError(400, `storage_params.${key} must be a number`);
    if (num < spec.min || num > spec.max) throw new AppError(400, `storage_params.${key} must be between ${spec.min} and ${spec.max}`);
    if (spec.integer && !Number.isInteger(num)) throw new AppError(400, `storage_params.${key} must be an integer`);
    pairs.push(`${key} = ${num}`);
  }
  return ` WITH (${pairs.join(', ')})`;
}

function formatDefaultValue(raw: string): string {
  const val = String(raw);
  if (val.startsWith("'") && /'::[a-zA-Z_][a-zA-Z0-9_]*(\[\])?\s*$/.test(val)) return val;
  if (val.startsWith("'") && val.endsWith("'")) return val;
  if (/^-?[0-9]+(\.[0-9]+)?$/.test(val) || val === 'true' || val === 'false' || val === 'NULL') return val;
  if (/^[a-zA-Z_][a-zA-Z0-9_]*\s*\(.*\)(::[a-zA-Z_][a-zA-Z0-9_]*(\[\])?)?$/.test(val)) return val;
  if (/^[A-Z][A-Z_]+$/.test(val)) return val;
  return `'${val.replace(/'/g, "''")}'`;
}

export class SchemaService {
  constructor(private db: Knex) {}

  async listTables(schema: string) {
    const result = await this.db.raw(`
      SELECT
        t.table_name as name,
        (SELECT COUNT(*) FROM information_schema.columns c
         WHERE c.table_schema = t.table_schema AND c.table_name = t.table_name)::int as column_count,
        COALESCE(s.n_live_tup, 0)::int as row_count
      FROM information_schema.tables t
      LEFT JOIN pg_stat_user_tables s
        ON s.schemaname = t.table_schema AND s.relname = t.table_name
      WHERE t.table_schema = ? AND t.table_type = 'BASE TABLE'
      ORDER BY t.table_name
    `, [schema]);

    return result.rows;
  }

  async listTablesFast(schema: string) {
    validateSchema(schema);
    const tsExt = await this.db.raw(
      `SELECT 1 AS ok FROM pg_extension WHERE extname = 'timescaledb'`
    ).then((r: any) => r.rows.length > 0).catch(() => false);

    const hypertableJoin = tsExt
      ? `LEFT JOIN timescaledb_information.hypertables h ON h.hypertable_schema = n.nspname AND h.hypertable_name = c.relname`
      : '';
    const hypertableSelect = tsExt ? `(h.hypertable_name IS NOT NULL) AS is_hypertable` : `FALSE AS is_hypertable`;

    const result = await this.db.raw(`
      SELECT
        c.relname AS name,
        c.reltuples::bigint AS row_count_estimate,
        pg_total_relation_size(c.oid) AS size_bytes,
        ${hypertableSelect}
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      ${hypertableJoin}
      WHERE n.nspname = ? AND c.relkind = 'r'
      ORDER BY c.relname
    `, [schema]);

    return result.rows.map((r: any) => ({
      name: r.name,
      row_count_estimate: Number(r.row_count_estimate ?? 0),
      size_bytes: Number(r.size_bytes ?? 0),
      is_hypertable: !!r.is_hypertable,
    }));
  }

  async describeTable(schema: string, tableName: string) {
    validateSchema(schema);
    validateIdentifier(tableName, 'table name');

    const info = await this.getTableInfo(schema, tableName);

    let hypertableInfo: Record<string, unknown> | null = null;
    try {
      const tsExt = await this.db.raw(
        `SELECT 1 AS ok FROM pg_extension WHERE extname = 'timescaledb'`
      ).then((r: any) => r.rows.length > 0).catch(() => false);
      if (tsExt) {
        const res = await this.db.raw(`
          SELECT
            h.num_dimensions,
            h.num_chunks,
            h.compression_enabled,
            d.column_name AS time_column,
            d.time_interval::text AS chunk_time_interval
          FROM timescaledb_information.hypertables h
          LEFT JOIN timescaledb_information.dimensions d
            ON d.hypertable_schema = h.hypertable_schema AND d.hypertable_name = h.hypertable_name AND d.dimension_number = 1
          WHERE h.hypertable_schema = ? AND h.hypertable_name = ?
        `, [schema, tableName]);
        if (res.rows.length > 0) {
          hypertableInfo = {
            num_chunks: Number(res.rows[0].num_chunks ?? 0),
            compression_enabled: !!res.rows[0].compression_enabled,
            time_column: res.rows[0].time_column,
            chunk_time_interval: res.rows[0].chunk_time_interval,
          };
        }
      }
    } catch {}

    return { ...info, hypertable_info: hypertableInfo };
  }

  async getTableInfo(schema: string, tableName: string) {
    const [columns, pks, uniques, fks, indexes, countRes] = await Promise.all([
      this.db.raw(`
        SELECT c.column_name as name, c.data_type as type, c.udt_name as udt_type,
               c.is_nullable = 'YES' as nullable, c.column_default as default_value, c.ordinal_position
        FROM information_schema.columns c
        WHERE c.table_schema = ? AND c.table_name = ?
        ORDER BY c.ordinal_position
      `, [schema, tableName]),
      this.db.raw(`
        SELECT kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        WHERE tc.table_schema = ? AND tc.table_name = ? AND tc.constraint_type = 'PRIMARY KEY'
      `, [schema, tableName]),
      this.db.raw(`
        SELECT kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        WHERE tc.table_schema = ? AND tc.table_name = ? AND tc.constraint_type = 'UNIQUE'
      `, [schema, tableName]),
      this.db.raw(`
        SELECT tc.constraint_name, kcu.column_name as source_column, ccu.table_name as target_table,
               ccu.column_name as target_column, rc.delete_rule as on_delete, rc.update_rule as on_update
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
        JOIN information_schema.referential_constraints rc ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.table_schema
        WHERE tc.table_schema = ? AND tc.table_name = ? AND tc.constraint_type = 'FOREIGN KEY'
      `, [schema, tableName]),
      this.db.raw(`
        SELECT i.relname as name, am.amname as type, ix.indisunique as is_unique,
               array_agg(a.attname ORDER BY k.n) as columns
        FROM pg_index ix
        JOIN pg_class t ON t.oid = ix.indrelid
        JOIN pg_class i ON i.oid = ix.indexrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        JOIN pg_am am ON am.oid = i.relam
        CROSS JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, n)
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
        WHERE n.nspname = ? AND t.relname = ? AND NOT ix.indisprimary
        GROUP BY i.relname, am.amname, ix.indisunique
      `, [schema, tableName]),
      this.db.raw(`SELECT COUNT(*)::int as count FROM "${schema}"."${tableName}"`).catch(() => ({ rows: [{ count: 0 }] })),
    ]);

    const pkColumns = new Set(pks.rows.map((r: { column_name: string }) => r.column_name));
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
      row_count: countRes.rows[0].count,
    };
  }

  async createTable(schema: string, def: TableDefinition): Promise<string> {
    validateSchema(schema);
    validateIdentifier(def.name, 'table name');
    const parts: string[] = [];

    const addUuidPk = def.add_uuid_pk !== false;
    const timestampsDefault = def.add_timestamps !== false;
    const addCreatedAt = def.add_created_at ?? timestampsDefault;
    const addUpdatedAt = def.add_updated_at ?? timestampsDefault;

    // Composite PK: if multiple columns have is_primary:true (and add_uuid_pk=false),
    // collect them and emit a single table-level PRIMARY KEY(...) constraint instead.
    const pkColumns = def.columns.filter(c => c.is_primary === true).map(c => c.name);
    const useCompositePk = !addUuidPk && pkColumns.length > 1;

    if (addUuidPk) {
      parts.push(`"id" UUID PRIMARY KEY DEFAULT gen_random_uuid()`);
    }

    for (const col of def.columns) {
      if (col.name === 'id' && addUuidPk) continue;
      if (useCompositePk) {
        // Don't emit PRIMARY KEY on the column — it goes at the table level.
        parts.push(this.buildColumnSQL({ ...col, is_primary: false }));
      } else {
        parts.push(this.buildColumnSQL(col));
      }
    }

    if (addCreatedAt) parts.push(`"created_at" TIMESTAMPTZ DEFAULT NOW()`);
    if (addUpdatedAt) parts.push(`"updated_at" TIMESTAMPTZ DEFAULT NOW()`);

    if (useCompositePk) {
      for (const c of pkColumns) validateIdentifier(c, 'PK column');
      parts.push(`PRIMARY KEY (${pkColumns.map(c => `"${c}"`).join(', ')})`);
    }

    if (def.checks && def.checks.length > 0) {
      for (let i = 0; i < def.checks.length; i++) {
        const chk = def.checks[i];
        if (!chk?.expression?.trim()) continue;
        const name = chk.name ?? `chk_${def.name}_${i + 1}`;
        validateIdentifier(name, 'check constraint name');
        parts.push(`CONSTRAINT "${name}" CHECK (${chk.expression.trim()})`);
      }
    }

    const storageClause = buildStorageParamsClause(def.storage_params);
    const sql = `CREATE TABLE "${schema}"."${def.name}" (\n  ${parts.join(',\n  ')}\n)${storageClause}`;

    await this.db.raw(sql);

    if (addUpdatedAt) {
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

  async alterColumns(
    schema: string,
    tableName: string,
    changes: AlterColumnDef[],
    options: { storage_params?: Record<string, number> } = {},
  ): Promise<string[]> {
    validateSchema(schema);
    validateIdentifier(tableName, 'table name');
    const sqls: string[] = [];

    for (const change of changes) {
      let sql = '';
      switch (change.action) {
        case 'add': {
          if (!change.name) throw new AppError(400, 'name required for add');
          const pgType = PG_TYPE_MAP[change.type ?? 'text'] ?? 'TEXT';
          sql = `ALTER TABLE "${schema}"."${tableName}" ADD COLUMN "${change.name}" ${pgType}`;
          if (change.nullable === false) sql += ' NOT NULL';
          if (change.default_value !== undefined) {
            sql += ` DEFAULT ${formatDefaultValue(String(change.default_value))}`;
          }
          const extras: string[] = [];
          if (change.is_unique === true) {
            extras.push(`CREATE UNIQUE INDEX "idx_${tableName}_${change.name}_unique" ON "${schema}"."${tableName}" ("${change.name}")`);
          }
          if (change.json_schema && typeof change.json_schema === 'object') {
            try {
              await this.db.raw(`CREATE EXTENSION IF NOT EXISTS pg_jsonschema`);
            } catch {
              throw new AppError(503, `pg_jsonschema extension is not available. Install it in the postgres base image to use json_schema validation.`);
            }
            const schemaJson = JSON.stringify(change.json_schema).replace(/'/g, "''");
            const constraintName = `chk_${tableName}_${change.name}_schema`;
            extras.push(`ALTER TABLE "${schema}"."${tableName}" ADD CONSTRAINT "${constraintName}" CHECK (jsonb_matches_schema('${schemaJson}', "${change.name}"))`);
          }
          if (extras.length > 0 || change.is_unique === true) {
            await this.db.transaction(async (trx) => {
              await trx.raw(sql);
              for (const s of extras) await trx.raw(s);
            });
            sqls.push(sql);
            for (const s of extras) sqls.push(s);
            continue;
          }
          break;
        }
        case 'alter': {
          if (!change.name) throw new AppError(400, 'name required for alter');
          const colName = change.name;
          if (change.type) {
            const pgType = PG_TYPE_MAP[change.type] ?? 'TEXT';
            // For types that don't have an implicit cast from text/varchar (inet, cidr, macaddr, uuid, jsonb, date/time types),
            // add a USING clause so the conversion actually runs. Otherwise PG raises "cannot be cast automatically".
            const NEEDS_USING = new Set(['inet', 'cidr', 'macaddr', 'uuid', 'jsonb', 'json', 'timestamptz', 'timestamp', 'date', 'integer', 'bigint', 'float', 'decimal', 'boolean']);
            const usingClause = NEEDS_USING.has(change.type) ? ` USING "${colName}"::${pgType}` : '';
            sql = `ALTER TABLE "${schema}"."${tableName}" ALTER COLUMN "${colName}" TYPE ${pgType}${usingClause}`;
            sqls.push(sql);
            await this.execAlterSql(sql, colName, change.type);
          }
          if (change.nullable !== undefined) {
            sql = `ALTER TABLE "${schema}"."${tableName}" ALTER COLUMN "${colName}" ${change.nullable ? 'DROP NOT NULL' : 'SET NOT NULL'}`;
            sqls.push(sql);
            await this.execAlterSql(sql, colName);
          }
          if (change.default_value !== undefined) {
            if (change.default_value === null) {
              sql = `ALTER TABLE "${schema}"."${tableName}" ALTER COLUMN "${colName}" DROP DEFAULT`;
            } else {
              sql = `ALTER TABLE "${schema}"."${tableName}" ALTER COLUMN "${colName}" SET DEFAULT ${formatDefaultValue(String(change.default_value))}`;
            }
            sqls.push(sql);
            await this.execAlterSql(sql, colName);
          }
          continue;
        }
        case 'drop':
          if (!change.name) throw new AppError(400, 'name required for drop');
          sql = `ALTER TABLE "${schema}"."${tableName}" DROP COLUMN IF EXISTS "${change.name}" CASCADE`;
          break;
        case 'rename':
          if (!change.name) throw new AppError(400, 'name required for rename');
          if (!change.newName) throw new AppError(400, 'newName required for rename');
          sql = `ALTER TABLE "${schema}"."${tableName}" RENAME COLUMN "${change.name}" TO "${change.newName}"`;
          break;
        case 'drop_primary_key': {
          const existing = await this.findPrimaryKeyConstraint(schema, tableName);
          if (!existing) {
            // Idempotent: no PK to drop
            continue;
          }
          sql = `ALTER TABLE "${schema}"."${tableName}" DROP CONSTRAINT "${existing}"`;
          sqls.push(sql);
          await this.execAlterSql(sql, existing);
          continue;
        }
        case 'drop_constraint': {
          // Drop any named constraint: UNIQUE, CHECK, FK, EXCLUDE.
          // For PRIMARY KEY prefer drop_primary_key (which auto-discovers the name).
          if (!change.name) throw new AppError(400, 'name required for drop_constraint (the constraint name)');
          validateIdentifier(change.name, 'constraint name');
          sql = `ALTER TABLE "${schema}"."${tableName}" DROP CONSTRAINT IF EXISTS "${change.name}"`;
          sqls.push(sql);
          await this.execAlterSql(sql, change.name);
          continue;
        }
        case 'set_primary_key': {
          const cols = change.columns ?? [];
          if (cols.length === 0) throw new AppError(400, 'set_primary_key requires "columns": [...]');
          for (const c of cols) validateIdentifier(c, 'PK column');

          // 1. Drop existing PK if present
          const existing = await this.findPrimaryKeyConstraint(schema, tableName);
          if (existing) {
            const dropSql = `ALTER TABLE "${schema}"."${tableName}" DROP CONSTRAINT "${existing}"`;
            sqls.push(dropSql);
            await this.execAlterSql(dropSql, existing);
          }

          // 2. Ensure NOT NULL on all target columns (PG requires this for PK)
          for (const c of cols) {
            const notNullSql = `ALTER TABLE "${schema}"."${tableName}" ALTER COLUMN "${c}" SET NOT NULL`;
            try {
              await this.db.raw(notNullSql);
              sqls.push(notNullSql);
            } catch (err) {
              const pgErr = err as { code?: string; message?: string };
              if (pgErr.code === '23502' || (pgErr.message ?? '').includes('contains null values')) {
                throw new AppError(400, `Cannot set PRIMARY KEY on column "${c}": contains NULL values. Clean data first.`);
              }
              // Already NOT NULL — ignore
            }
          }

          // 3. Promote existing UNIQUE INDEX if it matches the column list exactly; otherwise ADD PRIMARY KEY
          const matchingIndex = await this.findUniqueIndexMatchingColumns(schema, tableName, cols);
          const constraintName = change.constraint_name ?? `${tableName}_pkey`;
          validateIdentifier(constraintName, 'PK constraint name');

          if (matchingIndex) {
            sql = `ALTER TABLE "${schema}"."${tableName}" ADD CONSTRAINT "${constraintName}" PRIMARY KEY USING INDEX "${matchingIndex}"`;
          } else {
            sql = `ALTER TABLE "${schema}"."${tableName}" ADD CONSTRAINT "${constraintName}" PRIMARY KEY (${cols.map(c => `"${c}"`).join(', ')})`;
          }
          sqls.push(sql);
          await this.execAlterSql(sql, constraintName);
          continue;
        }
      }

      if (sql) {
        sqls.push(sql);
        await this.execAlterSql(sql, change.name ?? '', change.type);
      }
    }

    if (options.storage_params) {
      const clause = buildStorageParamsClause(options.storage_params).replace(/^\s+WITH\s+/, '');
      if (clause) {
        const setSql = `ALTER TABLE "${schema}"."${tableName}" SET ${clause}`;
        sqls.push(setSql);
        await this.db.raw(setSql);
      }
    }

    return sqls;
  }

  private async findPrimaryKeyConstraint(schema: string, tableName: string): Promise<string | null> {
    const r: any = await this.db.raw(`
      SELECT conname FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = ? AND t.relname = ? AND c.contype = 'p' LIMIT 1
    `, [schema, tableName]);
    return r.rows[0]?.conname ?? null;
  }

  private async findUniqueIndexMatchingColumns(schema: string, tableName: string, columns: string[]): Promise<string | null> {
    // We can only promote a STANDALONE unique index (no owning constraint). Indexes auto-created by
    // inline UNIQUE constraints or ADD CONSTRAINT UNIQUE are owned by their constraint and PG refuses
    // `ADD CONSTRAINT ... PRIMARY KEY USING INDEX` on them. Fall back to plain ADD in that case.
    const r: any = await this.db.raw(`
      SELECT i.relname AS index_name,
             (SELECT array_agg(a.attname::text ORDER BY k.ord)
              FROM unnest(idx.indkey::int[]) WITH ORDINALITY AS k(attnum, ord)
              JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum) AS cols
      FROM pg_index idx
      JOIN pg_class i ON i.oid = idx.indexrelid
      JOIN pg_class t ON t.oid = idx.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = ? AND t.relname = ?
        AND idx.indisunique = true AND idx.indisprimary = false
        AND idx.indpred IS NULL AND idx.indexprs IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM pg_constraint c
          WHERE c.conindid = idx.indexrelid AND c.contype IN ('u', 'p', 'x')
        )
    `, [schema, tableName]);
    for (const row of r.rows as { index_name: string; cols: unknown }[]) {
      // pg driver returns text[] as JS array; defensive fallback for legacy 'name[]' as "{a,b}" string
      const cols = Array.isArray(row.cols)
        ? row.cols as string[]
        : typeof row.cols === 'string'
          ? (row.cols as string).replace(/^\{|\}$/g, '').split(',').map(s => s.replace(/^"|"$/g, ''))
          : [];
      if (cols.length === columns.length && cols.every((c, i) => c === columns[i])) {
        return row.index_name;
      }
    }
    return null;
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
    validateSchema(schema);
    validateIdentifier(tableName, 'table name');
    try {
      const comment = await this.db.raw(`SELECT obj_description(oid) as comment FROM pg_class WHERE relname = ? AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = ?)`, [tableName, schema]);
      if (comment.rows[0]?.comment?.startsWith('system:')) {
        throw new AppError(403, `Table "${tableName}" is a system table managed by plugin "${comment.rows[0].comment.replace('system:', '')}". Disable the plugin to remove it.`);
      }
    } catch (e) { if ((e as { statusCode?: number }).statusCode === 403) throw e; }
    const deleted: string[] = [];

    if (projectId) {
      try {
        const files = await this.db('files')
          .where({ project_id: projectId, table_name: tableName })
          .select('storage_path');
        const fs = await import('fs');
        for (const f of files) {
          try { if (f.storage_path && fs.existsSync(f.storage_path)) fs.unlinkSync(f.storage_path); } catch {}
        }
      } catch {}

      const cleanup: [string, Promise<number>][] = [
        ['endpoints', this.db('api_endpoints').where({ project_id: projectId }).where(function () {
          this.whereRaw("source_config::text LIKE ?", [`%"table":"${tableName}"%`])
            .orWhereRaw("source_config::text LIKE ?", [`%"table": "${tableName}"%`])
            .orWhere('path', 'LIKE', `/${tableName}%`);
        }).delete()],
        ['webhooks', this.db('webhooks').where({ project_id: projectId, table_name: tableName }).delete()],
        ['validation_rules', this.db('validation_rules').where({ project_id: projectId, table_name: tableName }).delete()],
        ['data_history', this.db('data_history').where({ project_id: projectId, table_name: tableName }).delete()],
        ['record_comments', this.db('record_comments').where({ project_id: projectId, table_name: tableName }).delete()],
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
    validateSchema(schema);
    validateIdentifier(tableName, 'table name');
    validateIdentifier(fk.source_column, 'source column');
    validateIdentifier(fk.target_table, 'target table');
    validateIdentifier(fk.target_column, 'target column');
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
    validateSchema(schema);
    validateIdentifier(tableName, 'table name');
    validateIdentifier(constraintName, 'constraint name');
    await this.db.raw(
      `ALTER TABLE "${schema}"."${tableName}" DROP CONSTRAINT IF EXISTS "${constraintName}"`
    );
  }

  async addIndex(schema: string, tableName: string, idx: IndexDef) {
    validateSchema(schema);
    validateIdentifier(tableName, 'table name');

    const hasCols = Array.isArray(idx.columns) && idx.columns.length > 0;
    const hasExprs = Array.isArray(idx.expressions) && idx.expressions.length > 0;
    if (hasCols && hasExprs) {
      throw new AppError(400, 'Provide either "columns" or "expressions", not both.');
    }
    if (!hasCols && !hasExprs) {
      throw new AppError(400, 'Missing "columns" or "expressions".');
    }

    if (hasCols) {
      for (const col of idx.columns!) validateIdentifier(col, 'column name');
    }
    if (hasExprs) {
      for (const expr of idx.expressions!) validateIndexExpression(expr);
    }
    if (idx.where) validateIndexExpression(idx.where, 'where');
    if (Array.isArray(idx.include) && idx.include.length > 0) {
      for (const col of idx.include) validateIdentifier(col, 'include column');
    }

    const nameSuffix = hasCols
      ? idx.columns!.join('_')
      : 'expr_' + Math.random().toString(36).slice(2, 8);
    const idxName = idx.name ?? (idx.is_unique ? `idx_${tableName}_${nameSuffix}_unique` : `idx_${tableName}_${nameSuffix}`);
    const unique = idx.is_unique ? 'UNIQUE' : '';
    const using = idx.type !== 'btree' ? `USING ${idx.type}` : '';

    let target: string;
    if (hasExprs) {
      target = idx.expressions!.map(e => `(${e})`).join(', ');
    } else if (idx.type === 'gin' || idx.type === 'gist') {
      await this.db.raw('CREATE EXTENSION IF NOT EXISTS pg_trgm');
      const colTypes = await this.db.raw(
        `SELECT column_name, data_type FROM information_schema.columns
         WHERE table_schema = ? AND table_name = ?`,
        [schema, tableName]
      );
      const typeMap = new Map(colTypes.rows.map((r: any) => [r.column_name, r.data_type]));
      const textTypes = new Set(['text', 'character varying', 'character']);
      const opsClass = idx.type === 'gin' ? 'gin_trgm_ops' : 'gist_trgm_ops';
      target = idx.columns!.map(c => {
        const dt = typeMap.get(c);
        return textTypes.has(dt) ? `"${c}" ${opsClass}` : `"${c}"`;
      }).join(', ');
    } else {
      target = idx.columns!.map(c => `"${c}"`).join(', ');
    }

    const include = Array.isArray(idx.include) && idx.include.length > 0
      ? ` INCLUDE (${idx.include.map(c => `"${c}"`).join(', ')})`
      : '';
    const whereClause = idx.where ? ` WHERE ${idx.where}` : '';

    const sql = `CREATE ${unique} INDEX IF NOT EXISTS "${idxName}" ON "${schema}"."${tableName}" ${using} (${target})${include}${whereClause}`;
    await this.db.raw(sql);
    return sql;
  }

  async dropIndex(schema: string, indexName: string) {
    validateSchema(schema);
    validateIdentifier(indexName, 'index name');
    await this.db.raw(`DROP INDEX IF EXISTS "${schema}"."${indexName}"`);
  }

  async createMaterializedView(schema: string, input: {
    name: string;
    query: string;
    refresh_cron?: string;
    refresh_concurrently?: boolean;
  }) {
    validateSchema(schema);
    validateIdentifier(input.name, 'view name');
    await validateSchemaAccess(input.query, schema, this.db);

    const fq = `"${schema}"."${input.name}"`;
    await this.db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL search_path TO "${schema}"`);
      await trx.raw(`CREATE MATERIALIZED VIEW ${fq} AS ${input.query} WITH NO DATA`);
    });
    await this.db.raw(`REFRESH MATERIALIZED VIEW ${fq}`);

    return {
      view: `${schema}.${input.name}`,
      created: true,
      refresh_cron_hint: input.refresh_cron
        ? `Create a cron job with SQL: REFRESH MATERIALIZED VIEW ${input.refresh_concurrently ? 'CONCURRENTLY ' : ''}${fq}`
        : null,
    };
  }

  async listMaterializedViews(schema: string) {
    validateSchema(schema);
    const r: any = await this.db.raw(`
      SELECT
        matviewname AS name,
        pg_size_pretty(pg_total_relation_size(format('%I.%I', schemaname, matviewname)::regclass)) AS size,
        ispopulated AS populated,
        definition
      FROM pg_matviews
      WHERE schemaname = ?
      ORDER BY matviewname
    `, [schema]);
    return r.rows;
  }

  previewCreateTable(schema: string, def: TableDefinition): string {
    const parts: string[] = [];
    const addUuidPk = def.add_uuid_pk !== false;
    const timestampsDefault = def.add_timestamps !== false;
    const addCreatedAt = def.add_created_at ?? timestampsDefault;
    const addUpdatedAt = def.add_updated_at ?? timestampsDefault;

    const pkColumns = def.columns.filter(c => c.is_primary === true).map(c => c.name);
    const useCompositePk = !addUuidPk && pkColumns.length > 1;

    if (addUuidPk) {
      parts.push(`  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid()`);
    }

    for (const col of def.columns) {
      if (col.name === 'id' && addUuidPk) continue;
      if (useCompositePk) {
        parts.push(`  ${this.buildColumnSQL({ ...col, is_primary: false })}`);
      } else {
        parts.push(`  ${this.buildColumnSQL(col)}`);
      }
    }

    if (addCreatedAt) parts.push(`  "created_at" TIMESTAMPTZ DEFAULT NOW()`);
    if (addUpdatedAt) parts.push(`  "updated_at" TIMESTAMPTZ DEFAULT NOW()`);

    if (useCompositePk) {
      parts.push(`  PRIMARY KEY (${pkColumns.map(c => `"${c}"`).join(', ')})`);
    }

    if (def.checks && def.checks.length > 0) {
      for (let i = 0; i < def.checks.length; i++) {
        const chk = def.checks[i];
        if (!chk?.expression?.trim()) continue;
        const name = chk.name ?? `chk_${def.name}_${i + 1}`;
        parts.push(`  CONSTRAINT "${name}" CHECK (${chk.expression.trim()})`);
      }
    }

    const storageClause = buildStorageParamsClause(def.storage_params);
    return `CREATE TABLE "${schema}"."${def.name}" (\n${parts.join(',\n')}\n)${storageClause};`;
  }

  private buildColumnSQL(col: ColumnDef): string {
    const pgType = PG_TYPE_MAP[col.type] ?? 'TEXT';
    let sql = `"${col.name}" ${pgType}`;
    if (col.is_primary) sql += ' PRIMARY KEY';
    if (!col.nullable && !col.is_primary) sql += ' NOT NULL';
    if (col.is_unique && !col.is_primary) sql += ' UNIQUE';
    if (col.default_value) {
      sql += ` DEFAULT ${formatDefaultValue(String(col.default_value))}`;
    }
    if (col.check && col.check.trim()) {
      sql += ` CHECK (${col.check.trim()})`;
    }
    return sql;
  }
}
