import type { Knex } from 'knex';
import { AppError } from '../../middleware/error-handler.js';
import { validateSchema, validateSchemaAccess } from '../../utils/sql-guard.js';

interface PgPlanNode {
  'Node Type': string;
  'Total Cost'?: number;
  'Actual Total Time'?: number;
  'Plan Rows'?: number;
  'Actual Rows'?: number;
  'Relation Name'?: string;
  'Index Name'?: string;
  'Filter'?: string;
  'Index Cond'?: string;
  'Hash Cond'?: string;
  'Join Type'?: string;
  'Sort Key'?: string[];
  'Plans'?: PgPlanNode[];
}

export interface Bottleneck {
  node_type: string;
  table?: string;
  rows_scanned: number;
  severity: 'low' | 'medium' | 'high';
  suggestion: string;
}

export interface SuggestedIndex {
  sql: string;
  estimated_improvement_percent: number;
  reason: string;
}

export interface AnalyzeResult {
  plan: PgPlanNode;
  total_cost: number;
  actual_time_ms: number | null;
  bottlenecks: Bottleneck[];
  suggested_indexes: SuggestedIndex[];
}

function extractColumnsFromFilter(filter: string): string[] {
  const cols = new Set<string>();
  const re = /(?:^|[\s(])([a-zA-Z_][a-zA-Z0-9_]*)\s*[<>=!]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(filter)) !== null) cols.add(m[1]);
  return [...cols];
}

export class AnalyzerService {
  constructor(private db: Knex) {}

  async analyze(
    schema: string,
    sql: string,
    params: Record<string, unknown> = {},
    analyze = false,
  ): Promise<AnalyzeResult> {
    validateSchema(schema);
    await validateSchemaAccess(sql, schema, this.db);

    const normalized = sql.trim().toUpperCase();
    if (!normalized.startsWith('SELECT') && !normalized.startsWith('WITH') && !normalized.startsWith('INSERT') && !normalized.startsWith('UPDATE') && !normalized.startsWith('DELETE')) {
      throw new AppError(400, 'explain_query accepts SELECT/WITH/INSERT/UPDATE/DELETE only');
    }

    const bindings: unknown[] = [];
    const substituted = sql.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_, name) => {
      if (!(name in params)) throw new AppError(400, `Missing parameter: ${name}`);
      bindings.push(params[name]);
      return '?';
    });

    const opts = analyze
      ? 'ANALYZE TRUE, FORMAT JSON, BUFFERS TRUE, TIMING TRUE'
      : 'FORMAT JSON';

    const explainSql = `EXPLAIN (${opts}) ${substituted}`;

    const planRow: any = await this.runExplain(schema, explainSql, bindings);
    const planJson = planRow.rows?.[0]?.['QUERY PLAN']?.[0] ?? planRow.rows?.[0];
    const rootPlan: PgPlanNode = planJson?.Plan ?? planJson;

    const bottlenecks: Bottleneck[] = [];
    const suggested: SuggestedIndex[] = [];

    const walk = (node: PgPlanNode) => {
      const rows = Number(node['Actual Rows'] ?? node['Plan Rows'] ?? 0);
      const nt = node['Node Type'];

      if (nt === 'Seq Scan' && rows > 10_000) {
        const table = node['Relation Name'];
        const filter = node['Filter'];
        const cols = filter ? extractColumnsFromFilter(filter) : [];
        bottlenecks.push({
          node_type: nt,
          table,
          rows_scanned: rows,
          severity: rows > 100_000 ? 'high' : 'medium',
          suggestion: cols.length > 0
            ? `Sequential scan of ${rows} rows filtering on ${cols.join(', ')} — consider index on ${cols.slice(0, 3).join(', ')}.`
            : `Sequential scan of ${rows} rows — consider indexing WHERE/JOIN columns.`,
        });
        if (table && cols.length > 0) {
          suggested.push({
            sql: `CREATE INDEX idx_${table}_${cols[0]} ON "${schema}"."${table}" (${cols.map(c => `"${c}"`).join(', ')})`,
            estimated_improvement_percent: Math.min(95, Math.round((1 - 1000 / rows) * 100)),
            reason: `Filter on ${cols.join(', ')} scans ${rows} rows sequentially.`,
          });
        }
      }

      if (nt === 'Nested Loop' && rows > 1000) {
        const hashCond = node['Hash Cond'];
        if (!hashCond) {
          bottlenecks.push({
            node_type: nt,
            rows_scanned: rows,
            severity: 'medium',
            suggestion: `Nested loop over ${rows} rows without hash — add index on the join column.`,
          });
        }
      }

      if (nt === 'Sort' && rows > 1_000_000) {
        bottlenecks.push({
          node_type: nt,
          rows_scanned: rows,
          severity: 'medium',
          suggestion: `Sort over ${rows} rows — consider index that matches ORDER BY.`,
        });
      }

      if (nt.includes('Scan') && node['Filter'] && (Number(node['Plan Rows'] ?? 0) > 10_000)) {
        // detected
      }

      for (const child of node['Plans'] ?? []) walk(child);
    };

    walk(rootPlan);

    return {
      plan: rootPlan,
      total_cost: Number(rootPlan['Total Cost'] ?? 0),
      actual_time_ms: rootPlan['Actual Total Time'] !== undefined ? Number(rootPlan['Actual Total Time']) : null,
      bottlenecks,
      suggested_indexes: suggested,
    };
  }

  private async runExplain(schema: string, explainSql: string, bindings: unknown[]): Promise<any> {
    return this.db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL search_path TO "${schema}", public`);
      await trx.raw(`SET LOCAL statement_timeout = '30000'`);
      const r: any = await trx.raw(explainSql, bindings);
      throw Object.assign(new Error('__rollback_analyze__'), { __result: r });
    }).catch((err: any) => {
      if (err?.message === '__rollback_analyze__' && err.__result) return err.__result;
      throw err;
    });
  }
}
