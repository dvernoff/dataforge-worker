import type { Knex } from 'knex';
import { AppError } from '../../middleware/error-handler.js';

interface TableSchema {
  name: string;
  columns: {
    name: string;
    type: string;
    nullable: boolean;
    default_value: string | null;
  }[];
}

interface SchemaDiff {
  tables_added: string[];
  tables_removed: string[];
  tables_modified: {
    table: string;
    columns_added: string[];
    columns_removed: string[];
    columns_modified: string[];
  }[];
}

export interface SchemaVersion {
  id: string;
  project_id: string;
  version: number;
  description: string;
  diff: SchemaDiff;
  full_schema: { tables: TableSchema[] };
  created_by: string;
  created_at: string;
}

export class VersioningService {
  constructor(private db: Knex) {}

  async captureVersion(
    projectId: string,
    schema: string,
    description: string,
    userId: string
  ): Promise<SchemaVersion> {
    const currentSchema = await this.getSchemaSnapshot(schema);

    const prevVersion = await this.db('schema_versions')
      .where({ project_id: projectId })
      .orderBy('version', 'desc')
      .first();

    const version = prevVersion ? prevVersion.version + 1 : 1;

    const previousSchema = prevVersion?.full_schema as { tables: TableSchema[] } | undefined;
    const diff = this.computeDiff(previousSchema, currentSchema);

    const [record] = await this.db('schema_versions')
      .insert({
        project_id: projectId,
        version,
        description,
        diff: JSON.stringify(diff),
        full_schema: JSON.stringify(currentSchema),
        created_by: userId,
      })
      .returning('*');

    return record;
  }

  async listVersions(projectId: string): Promise<SchemaVersion[]> {
    return this.db('schema_versions')
      .where({ project_id: projectId })
      .orderBy('version', 'desc');
  }

  async getVersion(id: string): Promise<SchemaVersion> {
    const version = await this.db('schema_versions').where({ id }).first();
    if (!version) {
      throw new AppError(404, 'Schema version not found');
    }
    return version;
  }

  async rollback(projectId: string, schema: string, versionId: string): Promise<void> {
    const targetVersion = await this.getVersion(versionId);
    const targetSchema = (typeof targetVersion.full_schema === 'string'
      ? JSON.parse(targetVersion.full_schema as unknown as string)
      : targetVersion.full_schema) as { tables: TableSchema[] };

    const currentSchema = await this.getSchemaSnapshot(schema);

    const currentTableNames = new Set(currentSchema.tables.map((t) => t.name));
    const targetTableNames = new Set(targetSchema.tables.map((t) => t.name));

    for (const table of currentSchema.tables) {
      if (!targetTableNames.has(table.name)) {
        await this.db.raw(`DROP TABLE IF EXISTS "${schema}"."${table.name}" CASCADE`);
      }
    }

    for (const table of targetSchema.tables) {
      if (!currentTableNames.has(table.name)) {
        const colDefs = table.columns.map((col) => {
          let def = `"${col.name}" ${col.type}`;
          if (!col.nullable) def += ' NOT NULL';
          if (col.default_value) def += ` DEFAULT ${col.default_value}`;
          return def;
        });
        await this.db.raw(`CREATE TABLE "${schema}"."${table.name}" (${colDefs.join(', ')})`);
      }
    }

    for (const targetTable of targetSchema.tables) {
      if (!currentTableNames.has(targetTable.name)) continue;
      const currentTable = currentSchema.tables.find((t) => t.name === targetTable.name);
      if (!currentTable) continue;

      const currentColNames = new Set(currentTable.columns.map((c) => c.name));
      const targetColNames = new Set(targetTable.columns.map((c) => c.name));

      for (const col of currentTable.columns) {
        if (!targetColNames.has(col.name)) {
          await this.db.raw(
            `ALTER TABLE "${schema}"."${targetTable.name}" DROP COLUMN IF EXISTS "${col.name}" CASCADE`
          );
        }
      }

      for (const col of targetTable.columns) {
        if (!currentColNames.has(col.name)) {
          let sql = `ALTER TABLE "${schema}"."${targetTable.name}" ADD COLUMN "${col.name}" ${col.type}`;
          if (!col.nullable) sql += ' NOT NULL';
          if (col.default_value) sql += ` DEFAULT ${col.default_value}`;
          try {
            await this.db.raw(sql);
          } catch {
          }
        }
      }
    }
  }

  private async getSchemaSnapshot(schema: string): Promise<{ tables: TableSchema[] }> {
    const tablesResult = await this.db.raw(`
      SELECT table_name as name
      FROM information_schema.tables
      WHERE table_schema = ? AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `, [schema]);

    const tables: TableSchema[] = [];

    for (const row of tablesResult.rows) {
      const columnsResult = await this.db.raw(`
        SELECT
          column_name as name,
          data_type as type,
          is_nullable = 'YES' as nullable,
          column_default as default_value
        FROM information_schema.columns
        WHERE table_schema = ? AND table_name = ?
        ORDER BY ordinal_position
      `, [schema, row.name]);

      tables.push({
        name: row.name,
        columns: columnsResult.rows,
      });
    }

    return { tables };
  }

  private computeDiff(
    prev: { tables: TableSchema[] } | undefined,
    current: { tables: TableSchema[] }
  ): SchemaDiff {
    if (!prev) {
      return {
        tables_added: current.tables.map((t) => t.name),
        tables_removed: [],
        tables_modified: [],
      };
    }

    const prevTableMap = new Map(prev.tables.map((t) => [t.name, t]));
    const currTableMap = new Map(current.tables.map((t) => [t.name, t]));

    const tables_added: string[] = [];
    const tables_removed: string[] = [];
    const tables_modified: SchemaDiff['tables_modified'] = [];

    for (const name of currTableMap.keys()) {
      if (!prevTableMap.has(name)) {
        tables_added.push(name);
      }
    }

    for (const name of prevTableMap.keys()) {
      if (!currTableMap.has(name)) {
        tables_removed.push(name);
      }
    }

    for (const [name, currTable] of currTableMap.entries()) {
      const prevTable = prevTableMap.get(name);
      if (!prevTable) continue;

      const prevColNames = new Set(prevTable.columns.map((c) => c.name));
      const currColNames = new Set(currTable.columns.map((c) => c.name));

      const columns_added = currTable.columns
        .filter((c) => !prevColNames.has(c.name))
        .map((c) => c.name);

      const columns_removed = prevTable.columns
        .filter((c) => !currColNames.has(c.name))
        .map((c) => c.name);

      const columns_modified: string[] = [];
      for (const currCol of currTable.columns) {
        const prevCol = prevTable.columns.find((c) => c.name === currCol.name);
        if (prevCol && (prevCol.type !== currCol.type || prevCol.nullable !== currCol.nullable)) {
          columns_modified.push(currCol.name);
        }
      }

      if (columns_added.length > 0 || columns_removed.length > 0 || columns_modified.length > 0) {
        tables_modified.push({
          table: name,
          columns_added,
          columns_removed,
          columns_modified,
        });
      }
    }

    return { tables_added, tables_removed, tables_modified };
  }
}
