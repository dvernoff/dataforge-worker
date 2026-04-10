export interface ColumnDef {
  name: string;
  type: string;
  nullable: boolean;
  default_value?: string;
  is_unique: boolean;
  is_primary: boolean;
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
  columns: string[];
  type: 'btree' | 'hash' | 'gin' | 'gist';
  is_unique: boolean;
}

export interface TableDefinition {
  name: string;
  columns: ColumnDef[];
  add_timestamps: boolean;
  add_uuid_pk: boolean;
}

export interface AlterColumnDef {
  action: 'add' | 'alter' | 'drop' | 'rename';
  name: string;
  newName?: string;
  type?: string;
  nullable?: boolean;
  default_value?: string | null;
  is_unique?: boolean;
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
  'text[]': 'TEXT[]',
  'integer[]': 'INTEGER[]',
  serial: 'SERIAL',
  bigserial: 'BIGSERIAL',
};
