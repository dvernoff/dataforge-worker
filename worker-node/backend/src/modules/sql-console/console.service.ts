import type { Knex } from 'knex';
import { AppError } from '../../middleware/error-handler.js';
import { validateSchema, validateSchemaAccess } from '../../utils/sql-guard.js';

export class ConsoleService {
  constructor(private db: Knex) {}

  async execute(schema: string, query: string, role: string, timeoutMs: number = 30000) {
    // Validate schema name
    validateSchema(schema);

    // Role-based restrictions
    if (role === 'editor') {
      // Only allow SELECT for editors
      const normalized = query.trim().toUpperCase();
      if (!normalized.startsWith('SELECT') && !normalized.startsWith('EXPLAIN') && !normalized.startsWith('WITH')) {
        throw new AppError(403, 'Your role only allows SELECT queries');
      }
      // Block system catalog access for editors
      const lower = query.toLowerCase();
      if (lower.includes('pg_catalog') || lower.includes('information_schema') || lower.includes('pg_stat')) {
        throw new AppError(403, 'Access to system catalogs denied');
      }
    }

    // Block cross-schema access (catches WITH, subqueries, function calls, etc.)
    validateSchemaAccess(query, schema);

    // viewers should never reach here (blocked by route)

    const start = Date.now();
    try {
      // Use a transaction with SET LOCAL for safe search_path scoping
      const result = await this.db.transaction(async (trx) => {
        await trx.raw(`SET LOCAL search_path TO "${schema}"`);
        await trx.raw(`SET LOCAL statement_timeout = ${Math.max(1000, Math.min(timeoutMs, 120000))}`);
        return trx.raw(query) as any;
      });

      const duration = Date.now() - start;

      const rows = Array.isArray(result) ? result[result.length - 1]?.rows : result.rows;
      const rowCount = rows?.length ?? 0;
      const fields = rows?.[0] ? Object.keys(rows[0]) : [];

      return {
        rows: rows ?? [],
        fields,
        rowCount,
        duration_ms: duration,
      };
    } catch (err) {
      const message = (err as Error).message;
      throw new AppError(400, message);
    }
  }

  async explain(schema: string, query: string) {
    // Validate schema name
    validateSchema(schema);

    // Block cross-schema access (catches WITH, subqueries, function calls, etc.)
    validateSchemaAccess(query, schema);

    const start = Date.now();
    try {
      const result = await this.db.transaction(async (trx) => {
        await trx.raw(`SET LOCAL search_path TO "${schema}"`);
        return trx.raw(`EXPLAIN ANALYZE ${query}`) as any;
      });

      const duration = Date.now() - start;
      const rows = Array.isArray(result) ? result[result.length - 1]?.rows : result.rows;

      return {
        plan: rows?.map((r: Record<string, string>) => r['QUERY PLAN'] ?? Object.values(r)[0]) ?? [],
        duration_ms: duration,
      };
    } catch (err) {
      throw new AppError(400, (err as Error).message);
    }
  }
}
