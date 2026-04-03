import type { Knex } from 'knex';
import { AppError } from '../../middleware/error-handler.js';
import { PG_TYPE_MAP } from './schema.types.js';

export class ComputedColumnService {
  constructor(private db: Knex) {}

  /**
   * Add a computed (generated) column to a table.
   * Uses PostgreSQL GENERATED ALWAYS AS ... STORED syntax.
   */
  async addComputedColumn(
    schema: string,
    tableName: string,
    name: string,
    expression: string,
    returnType: string
  ): Promise<string> {
    const pgType = PG_TYPE_MAP[returnType] ?? 'TEXT';

    // Validate column name
    if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
      throw new AppError(400, 'Invalid column name. Use lowercase letters, numbers, and underscores.');
    }

    // Validate expression characters to prevent injection
    // Block quotes, pipes, semicolons — only allow safe SQL expression chars
    if (!/^[a-zA-Z0-9_\s+\-*/().,: ]+$/.test(expression)) {
      throw new AppError(400, 'Invalid expression characters. Quotes, pipes, and special characters are not allowed.');
    }

    // Block dangerous keywords
    const upper = expression.toUpperCase().replace(/\s+/g, ' ');
    const forbidden = ['DROP', 'ALTER', 'CREATE', 'INSERT', 'UPDATE', 'DELETE', 'GRANT', 'REVOKE', 'EXEC', 'EXECUTE'];
    for (const kw of forbidden) {
      if (upper.includes(kw)) {
        throw new AppError(400, `Expression contains forbidden keyword: ${kw}`);
      }
    }

    // Test expression in a read-only context
    try {
      await this.db.raw(`SELECT (${expression})::text LIMIT 0`);
    } catch {
      throw new AppError(400, 'Invalid SQL expression');
    }

    const sql = `ALTER TABLE "${schema}"."${tableName}" ADD COLUMN "${name}" ${pgType} GENERATED ALWAYS AS (${expression}) STORED`;

    try {
      await this.db.raw(sql);
    } catch (err) {
      throw new AppError(400, `Failed to add computed column: ${(err as Error).message}`);
    }

    return sql;
  }

  async dropComputedColumn(
    schema: string,
    tableName: string,
    name: string
  ): Promise<void> {
    const sql = `ALTER TABLE "${schema}"."${tableName}" DROP COLUMN IF EXISTS "${name}" CASCADE`;

    try {
      await this.db.raw(sql);
    } catch (err) {
      throw new AppError(400, `Failed to drop computed column: ${(err as Error).message}`);
    }
  }
}
