import { parse, stringify } from 'yaml';
import type { CreateTableInput, TableInfo } from '@/api/schema.api';

// ── Types ──

export interface YamlColumnDef {
  type: string;
  nullable?: boolean;
  default?: string;
  unique?: boolean;
  primary?: boolean;
  rename_from?: string;
}

export interface YamlForeignKeyDef {
  column: string;
  references: string; // "table.column"
  on_delete?: string;
  on_update?: string;
}

export interface YamlIndexDef {
  columns: string[];
  type?: string;
  unique?: boolean;
}

export interface YamlTableDef {
  options?: {
    uuid_pk?: boolean;
    timestamps?: boolean;
    endpoints?: boolean;
  };
  columns: Record<string, YamlColumnDef>;
  indexes?: YamlIndexDef[];
  foreign_keys?: YamlForeignKeyDef[];
}

export interface YamlSchema {
  tables: Record<string, YamlTableDef>;
}

export interface ParseResult {
  success: boolean;
  schema?: YamlSchema;
  errors: string[];
  warnings: string[];
}

export interface ApiPayloads {
  tables: (CreateTableInput & { _name: string })[];
  foreignKeys: { tableName: string; source_column: string; target_table: string; target_column: string; on_delete: string; on_update: string }[];
  indexes: { tableName: string; columns: string[]; type: string; is_unique: boolean }[];
  endpointTables: string[];
}

// ── Constants ──

const VALID_TYPES = [
  'text', 'integer', 'bigint', 'float', 'decimal', 'boolean', 'date',
  'timestamp', 'timestamptz', 'uuid', 'json', 'jsonb', 'text[]', 'integer[]',
  'serial', 'bigserial',
];

const VALID_INDEX_TYPES = ['btree', 'hash', 'gin', 'gist'];
const VALID_FK_ACTIONS = ['CASCADE', 'SET NULL', 'RESTRICT', 'NO ACTION'];
const NAME_REGEX = /^[a-z_][a-z0-9_]*$/;

const PG_TO_FRIENDLY: Record<string, string> = {
  'character varying': 'text', 'text': 'text', 'varchar': 'text',
  'integer': 'integer', 'int4': 'integer', 'smallint': 'integer',
  'bigint': 'bigint', 'int8': 'bigint',
  'double precision': 'float', 'float8': 'float', 'real': 'float', 'float4': 'float',
  'numeric': 'decimal', 'decimal': 'decimal',
  'boolean': 'boolean', 'bool': 'boolean',
  'date': 'date',
  'timestamp without time zone': 'timestamp', 'timestamp': 'timestamp',
  'timestamp with time zone': 'timestamptz', 'timestamptz': 'timestamptz',
  'uuid': 'uuid',
  'json': 'json', 'jsonb': 'jsonb',
  'text[]': 'text[]', 'ARRAY': 'text[]',
  'integer[]': 'integer[]',
  'serial': 'serial', 'bigserial': 'bigserial',
};

// ── Template ──

const SCHEMA_HEADER = `# DataForge Schema Definition
#
# STRUCTURE (everything is INSIDE each table, never at root level):
#
#   tables:
#     table_name:
#       options: { ... }          # table-level settings
#       columns: { ... }          # column definitions
#       indexes: [ ... ]          # indexes (INSIDE the table, not separate!)
#       foreign_keys: [ ... ]     # foreign keys (INSIDE the table, not separate!)
#
# COLUMN TYPES:
#   text, integer, bigint, float, decimal, boolean, date, timestamp,
#   timestamptz, uuid, json, jsonb, text[], integer[], serial, bigserial
#
# COLUMN PROPERTIES (inside columns → column_name):
#   type        - (required) one of the types above
#   nullable    - (optional, default: true)
#   default     - (optional) e.g. "now()", "0", "'draft'"
#   unique      - (optional, default: false)
#   primary     - (optional, default: false)
#   rename_from - (optional) rename existing column: new_name: { rename_from: old_name }
#
# TABLE OPTIONS:
#   uuid_pk    - (default: true) auto-add UUID "id" primary key
#   timestamps - (default: true) auto-add created_at / updated_at
#   endpoints  - (default: false) auto-create CRUD API endpoints
#
# INDEXES (array inside table, NOT at root):
#   - columns: [col1, col2]       # required, array of column names
#     type: btree                  # btree (default) | hash | gin | gist
#     unique: true                 # optional
#
# FOREIGN KEYS (array inside table, NOT at root):
#   - column: my_column            # source column in THIS table
#     references: other_table.id   # target as "table.column" (dot notation)
#     on_delete: CASCADE           # CASCADE | SET NULL | RESTRICT | NO ACTION
#     on_update: CASCADE           # CASCADE | SET NULL | RESTRICT | NO ACTION
#
# IMPORTANT RULES:
#   - indexes and foreign_keys go INSIDE the table definition, NOT as separate root keys
#   - foreign_keys use a SEPARATE section, NOT properties inside a column
#   - FK column (e.g. user_id uuid) must be defined in columns first
#   - Tables referenced by FK are created automatically in the correct order
#   - Add indexes on FK columns and frequently filtered columns for performance
`;

export function getYamlTemplate(): string {
  return SCHEMA_HEADER + `
# ── EXAMPLE ──

tables:
  users:
    options:
      uuid_pk: true
      timestamps: true
      endpoints: true
    columns:
      email:
        type: text
        nullable: false
        unique: true
      name:
        type: text
      role:
        type: text
        default: "'user'"
    indexes:                         # ← indexes INSIDE the table
      - columns: [email]
        type: btree
        unique: true

  posts:
    options:
      uuid_pk: true
      timestamps: true
    columns:
      title:
        type: text
        nullable: false
      body:
        type: text
      status:
        type: text
        default: "'draft'"
      author_id:                     # ← define FK column here as a normal column
        type: uuid
        nullable: false
    indexes:                         # ← indexes INSIDE the table
      - columns: [author_id]
        type: btree
      - columns: [status]
        type: hash
    foreign_keys:                    # ← foreign_keys INSIDE the table
      - column: author_id           # ← source column in THIS table
        references: users.id        # ← "table.column" dot notation
        on_delete: CASCADE
        on_update: CASCADE
`;
}

// ── Parse & Validate ──

export function parseYamlSchema(yamlString: string): ParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!yamlString.trim()) {
    return { success: false, errors: ['Schema is empty'], warnings };
  }

  let raw: unknown;
  try {
    raw = parse(yamlString);
  } catch (e) {
    return { success: false, errors: [`YAML syntax error: ${(e as Error).message}`], warnings };
  }

  if (!raw || typeof raw !== 'object' || !('tables' in (raw as Record<string, unknown>))) {
    return { success: false, errors: ['Missing top-level "tables" key'], warnings };
  }

  const schema = raw as YamlSchema;

  if (!schema.tables || typeof schema.tables !== 'object' || Array.isArray(schema.tables)) {
    return { success: false, errors: ['"tables" must be an object (map of table_name → definition)'], warnings };
  }

  const tableNames = Object.keys(schema.tables);
  if (tableNames.length === 0) {
    return { success: false, errors: ['No tables defined'], warnings };
  }

  for (const tableName of tableNames) {
    const prefix = `Table "${tableName}"`;

    if (!NAME_REGEX.test(tableName)) {
      errors.push(`${prefix}: invalid name (use lowercase letters, digits, underscores; must start with letter or underscore)`);
      continue;
    }

    const table = schema.tables[tableName];
    if (!table || typeof table !== 'object') {
      errors.push(`${prefix}: definition must be an object`);
      continue;
    }

    if (!table.columns || typeof table.columns !== 'object' || Array.isArray(table.columns)) {
      errors.push(`${prefix}: "columns" must be an object (map of column_name → properties)`);
      continue;
    }

    // Validate columns
    const columnNames = Object.keys(table.columns);
    if (columnNames.length === 0) {
      errors.push(`${prefix}: must have at least one column`);
    }

    for (const colName of columnNames) {
      const col = table.columns[colName];
      const colPrefix = `${prefix}.${colName}`;

      if (!NAME_REGEX.test(colName)) {
        errors.push(`${colPrefix}: invalid column name`);
        continue;
      }

      if (!col || typeof col !== 'object') {
        errors.push(`${colPrefix}: column definition must be an object`);
        continue;
      }

      if (!col.type) {
        errors.push(`${colPrefix}: "type" is required`);
        continue;
      }

      if (!VALID_TYPES.includes(col.type)) {
        errors.push(`${colPrefix}: unknown type "${col.type}". Valid: ${VALID_TYPES.join(', ')}`);
      }
    }

    const opts = table.options ?? {};

    if ((opts.uuid_pk ?? true) && 'id' in table.columns) {
      warnings.push(`${prefix}: uuid_pk is enabled but "id" column is also defined manually. The manual column will be used, uuid_pk ignored for this table.`);
    }

    if (columnNames.length > 20) {
      warnings.push(`${prefix}: has ${columnNames.length} columns — consider splitting into multiple tables for better maintainability`);
    }

    if (opts.endpoints === false) {
      warnings.push(`${prefix}: CRUD endpoints are disabled — table will only be accessible via direct SQL`);
    }

    if ((opts.timestamps ?? true) === false && !columnNames.includes('created_at')) {
      warnings.push(`${prefix}: timestamps disabled and no "created_at" column — records will have no creation date`);
    }

    for (const colName of columnNames) {
      const col = table.columns[colName];
      if (col && col.unique && table.indexes?.some(idx => idx.columns.length === 1 && idx.columns[0] === colName)) {
        warnings.push(`${prefix}.${colName}: column is marked unique and also has a separate index — the unique constraint already creates an index`);
      }
    }

    // Validate indexes
    if (table.indexes) {
      if (!Array.isArray(table.indexes)) {
        errors.push(`${prefix}: "indexes" must be an array`);
      } else {
        for (let i = 0; i < table.indexes.length; i++) {
          const idx = table.indexes[i];
          const idxPrefix = `${prefix}.indexes[${i}]`;
          if (!idx.columns || !Array.isArray(idx.columns) || idx.columns.length === 0) {
            errors.push(`${idxPrefix}: "columns" must be a non-empty array`);
          } else {
            for (const c of idx.columns) {
              if (!columnNames.includes(c) && c !== 'id' && c !== 'created_at' && c !== 'updated_at') {
                errors.push(`${idxPrefix}: column "${c}" does not exist in table`);
              }
            }
          }
          if (idx.type && !VALID_INDEX_TYPES.includes(idx.type)) {
            errors.push(`${idxPrefix}: unknown index type "${idx.type}". Valid: ${VALID_INDEX_TYPES.join(', ')}`);
          }
        }
      }
    }

    // Validate foreign keys
    if (table.foreign_keys) {
      if (!Array.isArray(table.foreign_keys)) {
        errors.push(`${prefix}: "foreign_keys" must be an array`);
      } else {
        for (let i = 0; i < table.foreign_keys.length; i++) {
          const fk = table.foreign_keys[i];
          const fkPrefix = `${prefix}.foreign_keys[${i}]`;

          if (!fk.column) {
            errors.push(`${fkPrefix}: "column" is required`);
          } else if (!columnNames.includes(fk.column) && fk.column !== 'id') {
            errors.push(`${fkPrefix}: column "${fk.column}" does not exist in table`);
          }

          if (!fk.references) {
            errors.push(`${fkPrefix}: "references" is required (format: "table.column")`);
          } else if (!fk.references.includes('.')) {
            errors.push(`${fkPrefix}: "references" must use dot notation (e.g. "users.id")`);
          } else {
            const [refTable] = fk.references.split('.');
            if (!tableNames.includes(refTable)) {
              warnings.push(`${fkPrefix}: references table "${refTable}" which is not in this schema (must already exist in DB)`);
            }
          }

          if (fk.on_delete && !VALID_FK_ACTIONS.includes(fk.on_delete.toUpperCase())) {
            errors.push(`${fkPrefix}: invalid on_delete "${fk.on_delete}". Valid: ${VALID_FK_ACTIONS.join(', ')}`);
          }
          if (fk.on_update && !VALID_FK_ACTIONS.includes(fk.on_update.toUpperCase())) {
            errors.push(`${fkPrefix}: invalid on_update "${fk.on_update}". Valid: ${VALID_FK_ACTIONS.join(', ')}`);
          }
        }
      }
    }
  }

  return {
    success: errors.length === 0,
    schema: errors.length === 0 ? schema : undefined,
    errors,
    warnings,
  };
}

// ── Topological Sort ──

export function topologicalSort(schema: YamlSchema): string[] | { cycle: string[] } {
  const tables = Object.keys(schema.tables);
  const tableSet = new Set(tables);
  const inDegree: Record<string, number> = {};
  const adj: Record<string, string[]> = {};

  for (const t of tables) {
    inDegree[t] = 0;
    adj[t] = [];
  }

  for (const tableName of tables) {
    const fks = schema.tables[tableName].foreign_keys ?? [];
    for (const fk of fks) {
      if (!fk.references) continue;
      const [refTable] = fk.references.split('.');
      if (refTable === tableName) continue; // self-ref: handled after creation
      if (!tableSet.has(refTable)) continue; // external table
      // refTable must be created before tableName
      adj[refTable].push(tableName);
      inDegree[tableName]++;
    }
  }

  const queue: string[] = [];
  for (const t of tables) {
    if (inDegree[t] === 0) queue.push(t);
  }

  const order: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    order.push(node);
    for (const neighbor of adj[node]) {
      inDegree[neighbor]--;
      if (inDegree[neighbor] === 0) queue.push(neighbor);
    }
  }

  if (order.length < tables.length) {
    const cycle = tables.filter((t) => !order.includes(t));
    return { cycle };
  }

  return order;
}

// ── Convert to API Payloads ──

export function yamlSchemaToApiPayloads(schema: YamlSchema): ApiPayloads {
  const sortResult = topologicalSort(schema);
  const tableOrder = Array.isArray(sortResult) ? sortResult : Object.keys(schema.tables);

  const tables: ApiPayloads['tables'] = [];
  const foreignKeys: ApiPayloads['foreignKeys'] = [];
  const indexes: ApiPayloads['indexes'] = [];
  const endpointTables: string[] = [];

  for (const tableName of tableOrder) {
    const def = schema.tables[tableName];
    const opts = def.options ?? {};
    const addUuidPk = opts.uuid_pk ?? true;
    const addTimestamps = opts.timestamps ?? true;
    const hasManualId = 'id' in def.columns;

    const columns = Object.entries(def.columns).map(([name, col]) => ({
      name,
      type: col.type,
      nullable: col.nullable ?? true,
      default_value: col.default,
      is_unique: col.unique ?? false,
      is_primary: col.primary ?? false,
    }));

    tables.push({
      _name: tableName,
      name: tableName,
      columns,
      add_uuid_pk: addUuidPk && !hasManualId,
      add_timestamps: addTimestamps,
    });

    if (opts.endpoints) {
      endpointTables.push(tableName);
    }

    // Collect FKs
    for (const fk of def.foreign_keys ?? []) {
      const [targetTable, targetColumn] = fk.references.split('.');
      foreignKeys.push({
        tableName,
        source_column: fk.column,
        target_table: targetTable,
        target_column: targetColumn,
        on_delete: (fk.on_delete ?? 'NO ACTION').toUpperCase(),
        on_update: (fk.on_update ?? 'NO ACTION').toUpperCase(),
      });
    }

    // Collect indexes
    for (const idx of def.indexes ?? []) {
      indexes.push({
        tableName,
        columns: idx.columns,
        type: idx.type ?? 'btree',
        is_unique: idx.unique ?? false,
      });
    }
  }

  return { tables, foreignKeys, indexes, endpointTables };
}

// ── Export existing tables to YAML ──

const AUTO_COLUMNS = new Set(['id', 'created_at', 'updated_at']);

function mapPgType(pgType: string): string {
  const lower = pgType.toLowerCase();
  return PG_TO_FRIENDLY[lower] ?? lower;
}

export function tableInfoToYaml(tables: TableInfo[]): string {
  const schema: Record<string, unknown> = {};

  for (const table of tables) {
    const hasUuidPk = table.columns.some((c) => c.name === 'id' && c.is_primary && mapPgType(c.type) === 'uuid');
    const hasTimestamps = table.columns.some((c) => c.name === 'created_at' && mapPgType(c.type) === 'timestamptz')
      && table.columns.some((c) => c.name === 'updated_at' && mapPgType(c.type) === 'timestamptz');

    const columns: Record<string, unknown> = {};
    for (const col of table.columns) {
      if (hasUuidPk && col.name === 'id') continue;
      if (hasTimestamps && (col.name === 'created_at' || col.name === 'updated_at')) continue;

      const def: Record<string, unknown> = { type: mapPgType(col.type), rename_from: col.name };
      if (!col.nullable) def.nullable = false;
      if (col.default_value && !col.default_value.includes('nextval')) def.default = col.default_value;
      if (col.is_unique) def.unique = true;
      if (col.is_primary && col.name !== 'id') def.primary = true;
      columns[col.name] = def;
    }

    const tableDef: Record<string, unknown> = {
      options: {
        uuid_pk: hasUuidPk,
        timestamps: hasTimestamps,
      },
      columns,
    };

    // Indexes (skip auto-generated PK indexes)
    const userIndexes = table.indexes.filter((idx) => {
      if (idx.columns.length === 1 && idx.columns[0] === 'id' && idx.is_unique) return false;
      if (idx.name.endsWith('_pkey')) return false;
      return true;
    });
    if (userIndexes.length > 0) {
      (tableDef as Record<string, unknown>).indexes = userIndexes.map((idx) => {
        const def: Record<string, unknown> = { columns: idx.columns };
        if (idx.type !== 'btree') def.type = idx.type;
        if (idx.is_unique) def.unique = true;
        return def;
      });
    }

    // Foreign keys
    if (table.foreign_keys.length > 0) {
      (tableDef as Record<string, unknown>).foreign_keys = table.foreign_keys.map((fk) => {
        const def: Record<string, unknown> = {
          column: fk.source_column,
          references: `${fk.target_table}.${fk.target_column}`,
        };
        if (fk.on_delete !== 'NO ACTION') def.on_delete = fk.on_delete;
        if (fk.on_update !== 'NO ACTION') def.on_update = fk.on_update;
        return def;
      });
    }

    schema[table.name] = tableDef;
  }

  const yamlBody = stringify({ tables: schema }, { indent: 2, lineWidth: 0 });
  return SCHEMA_HEADER + '\n' + yamlBody;
}

// ── Safe re-import: detect conflicts with existing tables ──

export interface TableConflict {
  tableName: string;
  action: 'skip' | 'update';
  changes: string[];
  newColumns: { name: string; type: string; nullable: boolean; default_value?: string; is_unique: boolean }[];
  alteredColumns: { name: string; type?: string; nullable?: boolean; default_value?: string; is_unique?: boolean }[];
  renamedColumns: { oldName: string; newName: string }[];
  removedColumns: string[];
  newIndexes: { columns: string[]; type: string; is_unique: boolean }[];
  removedIndexes: { name: string; columns: string[] }[];
  newForeignKeys: { source_column: string; target_table: string; target_column: string; on_delete: string; on_update: string }[];
  removedForeignKeys: { constraint_name: string; source_column: string; target_table: string }[];
}

export interface ReImportPayloads extends ApiPayloads {
  tablesToCreate: ApiPayloads['tables'];
  tableConflicts: TableConflict[];
}

export function detectTableConflicts(
  schema: YamlSchema,
  existingTables: import('@/api/schema.api').TableInfo[],
): ReImportPayloads {
  const base = yamlSchemaToApiPayloads(schema);
  const existingMap = new Map(existingTables.map(t => [t.name, t]));

  const tablesToCreate: ApiPayloads['tables'] = [];
  const tableConflicts: TableConflict[] = [];

  for (const table of base.tables) {
    const existing = existingMap.get(table._name);
    if (!existing) {
      tablesToCreate.push(table);
      continue;
    }

    const def = schema.tables[table._name];
    const existingColMap = new Map(existing.columns.map(c => [c.name, c]));
    const yamlColNames = Object.keys(def.columns);
    const changes: string[] = [];

    const newColumns: TableConflict['newColumns'] = [];
    const alteredColumns: TableConflict['alteredColumns'] = [];
    const renamedColumns: TableConflict['renamedColumns'] = [];
    const removedColumns: string[] = [];

    const renamedFromSet = new Set<string>();

    for (const colName of yamlColNames) {
      const yamlCol = def.columns[colName];

      if (yamlCol.rename_from && yamlCol.rename_from !== colName && existingColMap.has(yamlCol.rename_from)) {
        renamedColumns.push({ oldName: yamlCol.rename_from, newName: colName });
        renamedFromSet.add(yamlCol.rename_from);
        changes.push(`rename ${yamlCol.rename_from}→${colName}`);
        continue;
      }

      const dbCol = existingColMap.get(colName);

      if (!dbCol) {
        newColumns.push({
          name: colName, type: yamlCol.type, nullable: yamlCol.nullable !== false,
          default_value: yamlCol.default, is_unique: yamlCol.unique ?? false,
        });
        changes.push(`+col ${colName}`);
      } else {
        const dbFriendly = mapPgType(dbCol.type);
        const alter: TableConflict['alteredColumns'][0] = { name: colName };
        let hasChange = false;

        if (dbFriendly !== yamlCol.type) {
          alter.type = yamlCol.type;
          hasChange = true;
          changes.push(`~type ${colName}: ${dbFriendly}→${yamlCol.type}`);
        }
        const yamlNullable = yamlCol.nullable !== false;
        if (dbCol.nullable !== yamlNullable) {
          alter.nullable = yamlNullable;
          hasChange = true;
          changes.push(`~nullable ${colName}`);
        }
        if (hasChange) alteredColumns.push(alter);
      }
    }

    const systemCols = new Set(['id', 'created_at', 'updated_at']);
    for (const dbCol of existing.columns) {
      if (systemCols.has(dbCol.name)) continue;
      if (renamedFromSet.has(dbCol.name)) continue;
      if (!yamlColNames.includes(dbCol.name)) {
        removedColumns.push(dbCol.name);
        changes.push(`-col ${dbCol.name}`);
      }
    }

    const existingUserIndexes = existing.indexes.filter(idx => !idx.name.endsWith('_pkey'));
    const existingIdxMap = new Map(
      existingUserIndexes.map(idx => [[...idx.columns].sort().join(',') + ':' + idx.type, idx])
    );
    const yamlIdxKeys = new Set<string>();
    const newIndexes: TableConflict['newIndexes'] = [];
    for (const idx of def.indexes ?? []) {
      const key = [...idx.columns].sort().join(',') + ':' + (idx.type ?? 'btree');
      yamlIdxKeys.add(key);
      if (!existingIdxMap.has(key)) {
        newIndexes.push({ columns: idx.columns, type: idx.type ?? 'btree', is_unique: idx.unique ?? false });
        changes.push(`+idx(${idx.columns.join(',')})`);
      }
    }
    const removedIndexes: TableConflict['removedIndexes'] = [];
    for (const [key, idx] of existingIdxMap) {
      if (!yamlIdxKeys.has(key)) {
        removedIndexes.push({ name: idx.name, columns: idx.columns });
        changes.push(`-idx(${idx.columns.join(',')})`);
      }
    }

    const existingFkMap = new Map(
      existing.foreign_keys.map(fk => [`${fk.source_column}:${fk.target_table}.${fk.target_column}`, fk])
    );
    const yamlFkKeys = new Set<string>();
    const newForeignKeys: TableConflict['newForeignKeys'] = [];
    for (const fk of def.foreign_keys ?? []) {
      const [targetTable, targetColumn] = fk.references.split('.');
      const key = `${fk.column}:${targetTable}.${targetColumn}`;
      yamlFkKeys.add(key);
      if (!existingFkMap.has(key)) {
        newForeignKeys.push({
          source_column: fk.column, target_table: targetTable, target_column: targetColumn,
          on_delete: fk.on_delete ?? 'NO ACTION', on_update: fk.on_update ?? 'NO ACTION',
        });
        changes.push(`+fk(${fk.column}→${targetTable})`);
      }
    }
    const removedForeignKeys: TableConflict['removedForeignKeys'] = [];
    for (const [key, fk] of existingFkMap) {
      if (!yamlFkKeys.has(key)) {
        removedForeignKeys.push({ constraint_name: fk.constraint_name, source_column: fk.source_column, target_table: fk.target_table });
        changes.push(`-fk(${fk.source_column}→${fk.target_table})`);
      }
    }

    if (changes.length > 0) {
      tableConflicts.push({
        tableName: table._name, action: 'skip', changes,
        newColumns, alteredColumns, renamedColumns, removedColumns,
        newIndexes, removedIndexes, newForeignKeys, removedForeignKeys,
      });
    }
  }

  return { ...base, tablesToCreate, tableConflicts };
}
