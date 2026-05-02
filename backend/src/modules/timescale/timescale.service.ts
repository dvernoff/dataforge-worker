import type { Knex } from 'knex';
import { AppError } from '../../middleware/error-handler.js';
import { validateSchema, validateIdentifier } from '../../utils/sql-guard.js';

const INTERVAL_RE = /^\s*\d+\s+(second|minute|hour|day|week|month|year)s?\s*$/i;
const ALLOWED_AGG = new Set(['count', 'sum', 'avg', 'min', 'max', 'first', 'last', 'stddev', 'variance']);

function validateInterval(value: string, label = 'interval'): void {
  if (!INTERVAL_RE.test(value)) {
    throw new AppError(400, `Invalid ${label}: "${value}". Format: "1 day", "7 days", "1 hour".`);
  }
}

export class TimescaleService {
  constructor(private db: Knex) {}

  private async ensureExtension() {
    try {
      await this.db.raw(`CREATE EXTENSION IF NOT EXISTS timescaledb`);
    } catch (err) {
      throw new AppError(
        503,
        `TimescaleDB extension is unavailable: ${(err as Error).message}. Worker must run against a TimescaleDB-enabled PostgreSQL (base image: timescale/timescaledb:latest-pg16).`,
      );
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const r: any = await this.db.raw(`SELECT 1 AS ok FROM pg_extension WHERE extname = 'timescaledb'`);
      return r.rows.length > 0;
    } catch {
      return false;
    }
  }

  async createHypertable(schema: string, input: { table: string; time_column: string; chunk_time_interval?: string }) {
    validateSchema(schema);
    validateIdentifier(input.table, 'table');
    validateIdentifier(input.time_column, 'time_column');
    await this.ensureExtension();

    const interval = input.chunk_time_interval ?? '1 day';
    validateInterval(interval, 'chunk_time_interval');

    const sql = `SELECT create_hypertable(?::regclass, ?, chunk_time_interval => INTERVAL '${interval}', if_not_exists => TRUE, migrate_data => TRUE)`;
    const fq = `"${schema}"."${input.table}"`;
    const res: any = await this.db.raw(sql, [fq, input.time_column]);
    return {
      table: fq,
      time_column: input.time_column,
      chunk_time_interval: interval,
      hypertable: res.rows?.[0]?.create_hypertable ?? null,
    };
  }

  async addContinuousAggregate(schema: string, input: {
    view_name: string;
    source_table: string;
    time_column: string;
    time_bucket: string;
    aggregations: Array<{ column: string; function: string; alias?: string }>;
    group_by?: string[];
    refresh_policy?: { start_offset: string; end_offset: string; schedule_interval: string };
  }) {
    validateSchema(schema);
    validateIdentifier(input.view_name, 'view_name');
    validateIdentifier(input.source_table, 'source_table');
    validateIdentifier(input.time_column, 'time_column');
    validateInterval(input.time_bucket, 'time_bucket');
    if (!Array.isArray(input.aggregations) || input.aggregations.length === 0) {
      throw new AppError(400, 'At least one aggregation is required');
    }
    for (const a of input.aggregations) {
      if (a.column !== '*') validateIdentifier(a.column, 'aggregation column');
      const fn = String(a.function).toLowerCase();
      if (!ALLOWED_AGG.has(fn)) {
        throw new AppError(400, `Unsupported aggregation function: ${a.function}. Allowed: ${Array.from(ALLOWED_AGG).join(', ')}`);
      }
      if (a.alias) validateIdentifier(a.alias, 'aggregation alias');
    }
    if (Array.isArray(input.group_by)) {
      for (const g of input.group_by) validateIdentifier(g, 'group_by column');
    }
    await this.ensureExtension();

    const aggExprs = input.aggregations.map(a => {
      const fn = a.function.toLowerCase();
      const colExpr = a.column === '*' ? '*' : `"${a.column}"`;
      const alias = a.alias ?? `${fn}_${a.column === '*' ? 'all' : a.column}`;
      return `${fn}(${colExpr}) AS "${alias}"`;
    }).join(', ');

    const groupByCols = (input.group_by ?? []).map(c => `"${c}"`);
    const selectExtra = groupByCols.length ? `, ${groupByCols.join(', ')}` : '';
    const groupByClause = groupByCols.length ? `, ${groupByCols.join(', ')}` : '';

    const createSql = `
      CREATE MATERIALIZED VIEW "${schema}"."${input.view_name}"
      WITH (timescaledb.continuous) AS
      SELECT time_bucket(INTERVAL '${input.time_bucket}', "${input.time_column}") AS bucket${selectExtra}, ${aggExprs}
      FROM "${schema}"."${input.source_table}"
      GROUP BY bucket${groupByClause}
      WITH NO DATA
    `;
    await this.db.raw(createSql);

    let policy: unknown = null;
    if (input.refresh_policy) {
      const rp = input.refresh_policy;
      validateInterval(rp.start_offset, 'refresh_policy.start_offset');
      validateInterval(rp.end_offset, 'refresh_policy.end_offset');
      validateInterval(rp.schedule_interval, 'refresh_policy.schedule_interval');
      const policySql = `SELECT add_continuous_aggregate_policy('${schema}.${input.view_name}',
        start_offset => INTERVAL '${rp.start_offset}',
        end_offset => INTERVAL '${rp.end_offset}',
        schedule_interval => INTERVAL '${rp.schedule_interval}')`;
      const r: any = await this.db.raw(policySql);
      policy = r.rows?.[0] ?? null;
    }

    return { view: `${schema}.${input.view_name}`, refresh_policy: policy };
  }

  async addCompressionPolicy(schema: string, input: {
    table: string;
    compress_after: string;
    segment_by?: string[];
    order_by?: string;
  }) {
    validateSchema(schema);
    validateIdentifier(input.table, 'table');
    validateInterval(input.compress_after, 'compress_after');
    if (Array.isArray(input.segment_by)) for (const c of input.segment_by) validateIdentifier(c, 'segment_by');
    if (input.order_by && !/^[a-zA-Z_][a-zA-Z0-9_]*(\s+(ASC|DESC))?$/i.test(input.order_by)) {
      throw new AppError(400, `Invalid order_by: "${input.order_by}". Use a column name with optional ASC/DESC.`);
    }
    await this.ensureExtension();

    const segmentBy = Array.isArray(input.segment_by) && input.segment_by.length > 0
      ? input.segment_by.map(c => `"${c}"`).join(', ')
      : '';
    const settings: string[] = ['timescaledb.compress'];
    if (segmentBy) settings.push(`timescaledb.compress_segmentby = '${segmentBy.replace(/"/g, '')}'`);
    if (input.order_by) settings.push(`timescaledb.compress_orderby = '${input.order_by.replace(/"/g, '')}'`);

    await this.db.raw(`ALTER TABLE "${schema}"."${input.table}" SET (${settings.join(', ')})`);

    const r: any = await this.db.raw(
      `SELECT add_compression_policy(?::regclass, INTERVAL '${input.compress_after}')`,
      [`${schema}.${input.table}`],
    );
    return { table: `${schema}.${input.table}`, compress_after: input.compress_after, job_id: r.rows?.[0]?.add_compression_policy ?? null };
  }

  async addRetentionPolicy(schema: string, input: { table: string; drop_after: string }) {
    validateSchema(schema);
    validateIdentifier(input.table, 'table');
    validateInterval(input.drop_after, 'drop_after');
    await this.ensureExtension();

    const r: any = await this.db.raw(
      `SELECT add_retention_policy(?::regclass, INTERVAL '${input.drop_after}')`,
      [`${schema}.${input.table}`],
    );
    return { table: `${schema}.${input.table}`, drop_after: input.drop_after, job_id: r.rows?.[0]?.add_retention_policy ?? null };
  }

  async listHypertables(schema: string) {
    validateSchema(schema);
    if (!(await this.isAvailable())) return [];
    const r: any = await this.db.raw(`
      SELECT
        h.hypertable_name AS name,
        h.num_chunks,
        h.compression_enabled,
        d.column_name AS time_column,
        d.time_interval::text AS chunk_time_interval,
        pg_size_pretty(COALESCE((SELECT SUM(total_bytes) FROM chunks_detailed_size(format('%I.%I', h.hypertable_schema, h.hypertable_name)::regclass)), 0)) AS total_size,
        pg_size_pretty(COALESCE((SELECT SUM(before_compression_total_bytes) FROM hypertable_compression_stats(format('%I.%I', h.hypertable_schema, h.hypertable_name)::regclass)), 0)) AS size_before_compression,
        pg_size_pretty(COALESCE((SELECT SUM(after_compression_total_bytes) FROM hypertable_compression_stats(format('%I.%I', h.hypertable_schema, h.hypertable_name)::regclass)), 0)) AS size_after_compression
      FROM timescaledb_information.hypertables h
      LEFT JOIN timescaledb_information.dimensions d
        ON d.hypertable_schema = h.hypertable_schema AND d.hypertable_name = h.hypertable_name AND d.dimension_number = 1
      WHERE h.hypertable_schema = ?
      ORDER BY h.hypertable_name
    `, [schema]).catch(() => ({ rows: [] }));
    return r.rows;
  }

  async listContinuousAggregates(schema: string) {
    validateSchema(schema);
    if (!(await this.isAvailable())) return [];
    const r: any = await this.db.raw(`
      SELECT
        view_name AS name,
        hypertable_name AS source_table,
        materialization_hypertable_name AS materialization_table,
        finalized
      FROM timescaledb_information.continuous_aggregates
      WHERE view_schema = ?
      ORDER BY view_name
    `, [schema]).catch(() => ({ rows: [] }));
    return r.rows;
  }

  async listJobs(schema: string) {
    validateSchema(schema);
    if (!(await this.isAvailable())) return [];
    const r: any = await this.db.raw(`
      SELECT
        j.job_id,
        j.proc_name,
        j.hypertable_schema,
        j.hypertable_name,
        j.schedule_interval::text,
        j.config,
        s.last_run_status,
        s.last_run_started_at
      FROM timescaledb_information.jobs j
      LEFT JOIN timescaledb_information.job_stats s ON s.job_id = j.job_id
      WHERE j.hypertable_schema = ? OR j.hypertable_schema IS NULL
      ORDER BY j.job_id
    `, [schema]).catch(() => ({ rows: [] }));
    return r.rows;
  }
}
