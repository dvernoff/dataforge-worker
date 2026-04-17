export interface ColumnDef {
  name: string;
  type: string;
  nullable: boolean;
  default_value?: string;
  is_unique: boolean;
  is_primary: boolean;
  check?: string;
}

export interface ForeignKeyDef {
  constraint_name?: string;
  source_column: string;
  target_table: string;
  target_column: string;
  on_delete: string;
  on_update: string;
}

export interface IndexDef {
  name?: string;
  columns?: string[];
  expressions?: string[];
  type: 'btree' | 'hash' | 'gin' | 'gist' | 'brin';
  is_unique: boolean;
  where?: string;
  include?: string[];
}

export interface StorageParams {
  fillfactor?: number;
  autovacuum_vacuum_scale_factor?: number;
  autovacuum_vacuum_threshold?: number;
  autovacuum_analyze_scale_factor?: number;
  autovacuum_analyze_threshold?: number;
}

export interface TableDefinition {
  name: string;
  columns: ColumnDef[];
  add_timestamps: boolean;
  add_uuid_pk: boolean;
  add_created_at?: boolean;
  add_updated_at?: boolean;
  checks?: { name?: string; expression: string }[];
  storage_params?: StorageParams;
}

export interface AlterColumnDef {
  action: 'add' | 'alter' | 'drop' | 'rename' | 'set_primary_key' | 'drop_primary_key';
  name?: string;
  newName?: string;
  type?: string;
  nullable?: boolean;
  default_value?: string | null;
  is_unique?: boolean;
  json_schema?: Record<string, unknown>;
  check?: string;
  // For set_primary_key: composite PK columns
  columns?: string[];
  constraint_name?: string;
}

export const PG_TYPE_MAP: Record<string, string> = {
  text: 'TEXT',
  integer: 'INTEGER',
  bigint: 'BIGINT',
  float: 'DOUBLE PRECISION',
  decimal: 'DECIMAL',
  boolean: 'BOOLEAN',
  date: 'DATE',
  timestamp: 'TIMESTAMP',
  timestamptz: 'TIMESTAMPTZ',
  uuid: 'UUID',
  json: 'JSON',
  jsonb: 'JSONB',
  inet: 'INET',
  cidr: 'CIDR',
  macaddr: 'MACADDR',
  'text[]': 'TEXT[]',
  'integer[]': 'INTEGER[]',
  'inet[]': 'INET[]',
  serial: 'SERIAL',
  bigserial: 'BIGSERIAL',
};
