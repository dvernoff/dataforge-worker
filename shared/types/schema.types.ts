import { z } from 'zod';

export const columnTypes = [
  'text', 'integer', 'bigint', 'float', 'decimal', 'boolean',
  'date', 'timestamp', 'timestamptz', 'uuid', 'json', 'jsonb',
  'text[]', 'integer[]', 'serial', 'bigserial',
] as const;

export type ColumnType = typeof columnTypes[number];

export const columnSchema = z.object({
  name: z.string().min(1).max(63).regex(/^[a-z_][a-z0-9_]*$/, 'Column name must be lowercase with underscores'),
  type: z.enum(columnTypes),
  nullable: z.boolean().default(true),
  default_value: z.string().optional(),
  is_unique: z.boolean().default(false),
  is_primary: z.boolean().default(false),
});

export const createTableSchema = z.object({
  name: z.string().min(1).max(63).regex(/^[a-z_][a-z0-9_]*$/, 'Table name must be lowercase with underscores'),
  columns: z.array(columnSchema).min(1),
  add_timestamps: z.boolean().default(true),
  add_uuid_pk: z.boolean().default(true),
});

export const foreignKeySchema = z.object({
  source_column: z.string(),
  target_table: z.string(),
  target_column: z.string(),
  on_delete: z.enum(['CASCADE', 'SET NULL', 'RESTRICT', 'NO ACTION']).default('RESTRICT'),
  on_update: z.enum(['CASCADE', 'SET NULL', 'RESTRICT', 'NO ACTION']).default('CASCADE'),
});

export const indexSchema = z.object({
  columns: z.array(z.string()).min(1),
  type: z.enum(['btree', 'gin', 'gist']).default('btree'),
  is_unique: z.boolean().default(false),
  name: z.string().optional(),
});

export type ColumnDefinition = z.infer<typeof columnSchema>;
export type CreateTableInput = z.infer<typeof createTableSchema>;
export type ForeignKeyDefinition = z.infer<typeof foreignKeySchema>;
export type IndexDefinition = z.infer<typeof indexSchema>;

export interface TableInfo {
  name: string;
  columns: ColumnInfo[];
  row_count: number;
  created_at?: string;
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  default_value: string | null;
  is_primary: boolean;
  is_unique: boolean;
}
