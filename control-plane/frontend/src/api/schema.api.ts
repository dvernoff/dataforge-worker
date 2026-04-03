import { api } from './client';

export interface TableListItem {
  name: string;
  column_count: number;
  row_count: number;
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  default_value: string | null;
  is_primary: boolean;
  is_unique: boolean;
}

export interface ForeignKeyInfo {
  constraint_name: string;
  source_column: string;
  target_table: string;
  target_column: string;
  on_delete: string;
  on_update: string;
}

export interface IndexInfo {
  name: string;
  type: string;
  is_unique: boolean;
  columns: string[];
}

export interface TableInfo {
  name: string;
  columns: ColumnInfo[];
  foreign_keys: ForeignKeyInfo[];
  indexes: IndexInfo[];
  row_count: number;
}

export interface CreateTableInput {
  name: string;
  columns: {
    name: string;
    type: string;
    nullable: boolean;
    default_value?: string;
    is_unique: boolean;
    is_primary: boolean;
  }[];
  add_timestamps: boolean;
  add_uuid_pk: boolean;
}

export interface AlterColumnChange {
  action: 'add' | 'alter' | 'drop' | 'rename';
  name: string;
  newName?: string;
  type?: string;
  nullable?: boolean;
  default_value?: string | null;
  is_unique?: boolean;
}

export const schemaApi = {
  listTables: (projectId: string) =>
    api.get<{ tables: TableListItem[] }>(`/projects/${projectId}/tables`),

  getTable: (projectId: string, tableName: string) =>
    api.get<{ table: TableInfo }>(`/projects/${projectId}/tables/${tableName}`),

  createTable: (projectId: string, data: CreateTableInput) =>
    api.post<{ success: boolean; sql: string }>(`/projects/${projectId}/tables`, data),

  previewCreateTable: (projectId: string, data: CreateTableInput) =>
    api.post<{ sql: string }>(`/projects/${projectId}/tables/preview`, data),

  alterColumns: (projectId: string, tableName: string, changes: AlterColumnChange[]) =>
    api.put<{ success: boolean; sqls: string[] }>(
      `/projects/${projectId}/tables/${tableName}/columns`,
      { changes }
    ),

  dropTable: (projectId: string, tableName: string) =>
    api.delete(`/projects/${projectId}/tables/${tableName}`),

  addForeignKey: (projectId: string, tableName: string, fk: {
    source_column: string;
    target_table: string;
    target_column: string;
    on_delete: string;
    on_update: string;
  }) => api.post<{ success: boolean; sql: string }>(
    `/projects/${projectId}/tables/${tableName}/foreign-keys`, fk
  ),

  dropForeignKey: (projectId: string, tableName: string, constraintName: string) =>
    api.delete(`/projects/${projectId}/tables/${tableName}/foreign-keys/${constraintName}`),

  addIndex: (projectId: string, tableName: string, idx: {
    columns: string[];
    type: string;
    is_unique: boolean;
    name?: string;
  }) => api.post<{ success: boolean; sql: string }>(
    `/projects/${projectId}/tables/${tableName}/indexes`, idx
  ),

  dropIndex: (projectId: string, tableName: string, indexName: string) =>
    api.delete(`/projects/${projectId}/tables/${tableName}/indexes/${indexName}`),

  // Computed columns
  addComputedColumn: (projectId: string, tableName: string, data: {
    name: string;
    expression: string;
    return_type: string;
  }) => api.post<{ success: boolean; sql: string }>(
    `/projects/${projectId}/tables/${tableName}/computed`, data
  ),

  dropComputedColumn: (projectId: string, tableName: string, columnName: string) =>
    api.delete(`/projects/${projectId}/tables/${tableName}/computed/${columnName}`),

  // Schema versioning
  listSchemaVersions: (projectId: string) =>
    api.get<{ versions: SchemaVersion[] }>(`/projects/${projectId}/schema-versions`),

  getSchemaVersion: (projectId: string, versionId: string) =>
    api.get<{ version: SchemaVersion }>(`/projects/${projectId}/schema-versions/${versionId}`),

  createSchemaVersion: (projectId: string, description: string) =>
    api.post<{ version: SchemaVersion }>(`/projects/${projectId}/schema-versions`, { description }),

  rollbackSchemaVersion: (projectId: string, versionId: string) =>
    api.post<{ success: boolean }>(`/projects/${projectId}/schema-versions/${versionId}/rollback`, { confirm: true }),
};

export interface SchemaVersion {
  id: string;
  project_id: string;
  version: number;
  description: string;
  diff: Record<string, unknown>;
  full_schema: Record<string, unknown>;
  created_by: string;
  created_at: string;
}
