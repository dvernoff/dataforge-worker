import type { Knex } from 'knex';
import { AppError } from '../../middleware/error-handler.js';
import { validateSchema, validateSchemaAccess, validateMutationSql } from '../../utils/sql-guard.js';

class DryRunRollback extends Error {
  constructor(public payload: { rows: unknown[]; rowCount: number }) {
    super('__dryrun__');
  }
}

export class ConsoleService {
  constructor(private db: Knex) {}

  async execute(schema: string, query: string, role: string, timeoutMs: number = 30000) {
    validateSchema(schema);

    const normalizedAll = query.trim().toUpperCase();

    // Detect TimescaleDB autocommit-required procedures and redirect to dedicated MCP tools.
    // execute_sql wraps queries in a transaction, but these CALLs commit internally and
    // refuse to run inside a transaction block — there is no way to make them work here.
    if (normalizedAll.startsWith('CALL ')) {
      const procMatch = query.match(/CALL\s+([a-zA-Z_][a-zA-Z0-9_]*)/i);
      const proc = procMatch?.[1]?.toLowerCase() ?? 'this procedure';
      const redirect: Record<string, string> = {
        refresh_continuous_aggregate: 'refresh_continuous_aggregate',
        compress_chunk: 'compress_chunk',
        decompress_chunk: 'decompress_chunk',
        recompress_chunk: 'recompress_chunk',
        run_job: 'run_timescaledb_job',
      };
      const tool = redirect[proc];
      const hint = tool
        ? `Use the dedicated MCP tool "${tool}" instead — it runs the CALL on a non-transactional connection.`
        : `TimescaleDB procedures that commit internally (e.g. refresh_continuous_aggregate, compress_chunk, decompress_chunk) cannot run via execute_sql because it wraps in a transaction. If a dedicated MCP tool exists for "${proc}" use it; otherwise file a request to add one.`;
      throw new AppError(400, `${proc} cannot be invoked through execute_sql. ${hint}`);
    }

    if (role === 'editor') {
      if (!normalizedAll.startsWith('SELECT') && !normalizedAll.startsWith('EXPLAIN') && !normalizedAll.startsWith('WITH')) {
        throw new AppError(403, 'Your role only allows SELECT queries');
      }
      if (normalizedAll.startsWith('WITH')) {
        const dangerousPattern = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE)\b/i;
        if (dangerousPattern.test(query)) {
          throw new AppError(403, 'Your role only allows SELECT queries (WITH clause cannot contain mutations)');
        }
      }
    }

    await validateSchemaAccess(query, schema, this.db);

    const start = Date.now();
    try {
      const result = await this.db.transaction(async (trx) => {
        await trx.raw(`SET LOCAL search_path TO "${schema}", public`);
        await trx.raw(`SET LOCAL statement_timeout = '${Math.max(1000, Math.min(timeoutMs, 120000))}'`);
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

  async executeMutation(
    schema: string,
    query: string,
    options: {
      params?: Record<string, unknown>;
      returning?: boolean;
      dryRun?: boolean;
      timeoutMs?: number;
      trx?: Knex.Transaction;
    } = {}
  ) {
    validateSchema(schema);
    await validateMutationSql(query, schema, this.db);

    // Default `returning` to true: caller almost always wants to see what was
    // actually changed, and the cost of returning a few extra rows is negligible
    // compared to the class of "I ran an UPDATE and now don't know what hit"
    // bugs that the silent-default caused. Pass returning: false to opt out.
    const { params = {}, returning = true, dryRun = false, timeoutMs = 30000, trx: externalTrx } = options;

    const bindings: unknown[] = [];
    let finalQuery = query.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_, name) => {
      if (!(name in params)) {
        throw new AppError(400, `Missing parameter: ${name}. Provide it in "params" or remove {{${name}}} from query.`);
      }
      bindings.push(params[name]);
      return '?';
    });

    if (returning && !/\bRETURNING\b/i.test(finalQuery)) {
      finalQuery = finalQuery.replace(/;*\s*$/, '') + ' RETURNING *';
    }

    const effectiveTimeout = Math.max(1000, Math.min(timeoutMs, 120000));
    const start = Date.now();

    if (externalTrx) {
      if (dryRun) throw new AppError(400, 'dry_run cannot be combined with txn_id (use begin_transaction then rollback_transaction to simulate)');
      const r: any = await externalTrx.raw(finalQuery, bindings);
      const duration = Date.now() - start;
      const rows = Array.isArray(r) ? r[r.length - 1]?.rows : r.rows;
      return {
        rows: rows ?? [],
        rowCount: r.rowCount ?? rows?.length ?? 0,
        duration_ms: duration,
        dry_run: false,
      };
    }

    try {
      const result: any = await this.db.transaction(async (trx) => {
        await trx.raw(`SET LOCAL search_path TO "${schema}", public`);
        await trx.raw(`SET LOCAL statement_timeout = '${effectiveTimeout}'`);
        const r = await trx.raw(finalQuery, bindings);
        if (dryRun) {
          const rows = Array.isArray(r) ? r[r.length - 1]?.rows : r.rows;
          throw new DryRunRollback({
            rows: rows ?? [],
            rowCount: r.rowCount ?? rows?.length ?? 0,
          });
        }
        return r;
      });

      const duration = Date.now() - start;
      const rows = Array.isArray(result) ? result[result.length - 1]?.rows : result.rows;
      const rowCount = result.rowCount ?? rows?.length ?? 0;

      return {
        rows: rows ?? [],
        rowCount,
        duration_ms: duration,
        dry_run: false,
      };
    } catch (err) {
      if (err instanceof DryRunRollback) {
        return {
          rows: err.payload.rows,
          rowCount: err.payload.rowCount,
          duration_ms: Date.now() - start,
          dry_run: true,
        };
      }
      if (err instanceof AppError) throw err;
      throw new AppError(400, (err as Error).message);
    }
  }

  async explain(schema: string, query: string) {
    validateSchema(schema);

    await validateSchemaAccess(query, schema, this.db);

    const start = Date.now();
    try {
      const result = await this.db.transaction(async (trx) => {
        await trx.raw(`SET LOCAL search_path TO "${schema}", public`);
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
