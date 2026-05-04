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
    refresh_policy?: { start_offset: string; end_offset: string; schedule_interval: string; initial_start?: string };
    materialized_only?: boolean;
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
    // GROUP BY by ordinal position 1 (the time_bucket column) — using the alias
    // "bucket" by name is ambiguous when the source table already has a column
    // named "bucket" (cascading CAG-on-CAG case): PostgreSQL resolves the
    // GROUP BY against the source column instead of the SELECT alias and
    // TimescaleDB rejects the view with "must include a valid time bucket
    // function". GROUP BY 1 always points at the first SELECT expression.
    const groupByClause = groupByCols.length ? `1, ${groupByCols.join(', ')}` : '1';

    const withParts = ['timescaledb.continuous'];
    if (input.materialized_only === false) {
      withParts.push('timescaledb.materialized_only = false');
    }

    const createSql = `
      CREATE MATERIALIZED VIEW "${schema}"."${input.view_name}"
      WITH (${withParts.join(', ')}) AS
      SELECT time_bucket(INTERVAL '${input.time_bucket}', "${input.time_column}") AS bucket${selectExtra}, ${aggExprs}
      FROM "${schema}"."${input.source_table}"
      GROUP BY ${groupByClause}
      WITH NO DATA
    `;
    await this.db.raw(createSql);

    let policy: unknown = null;
    if (input.refresh_policy) {
      const rp = input.refresh_policy;
      validateInterval(rp.start_offset, 'refresh_policy.start_offset');
      validateInterval(rp.end_offset, 'refresh_policy.end_offset');
      validateInterval(rp.schedule_interval, 'refresh_policy.schedule_interval');
      const policyParts = [
        `start_offset => INTERVAL '${rp.start_offset}'`,
        `end_offset => INTERVAL '${rp.end_offset}'`,
        `schedule_interval => INTERVAL '${rp.schedule_interval}'`,
      ];
      if (rp.initial_start) {
        // Validate as ISO 8601-ish timestamp before inlining: Knex's `?`
        // binding collides with `::` cast syntax (parses `:timestamptz` as a
        // named binding), so we inline the literal after a strict whitelist.
        if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.test(rp.initial_start)) {
          throw new AppError(400, `Invalid initial_start "${rp.initial_start}". Use ISO 8601, e.g. "2026-05-04T20:00:00Z".`);
        }
        policyParts.push(`initial_start => '${rp.initial_start}'::timestamptz`);
      }
      const policySql = `SELECT add_continuous_aggregate_policy('${schema}.${input.view_name}', ${policyParts.join(', ')})`;
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
    dry_run?: boolean;
  }) {
    validateSchema(schema);
    validateIdentifier(input.table, 'table');
    validateInterval(input.compress_after, 'compress_after');
    if (Array.isArray(input.segment_by)) for (const c of input.segment_by) validateIdentifier(c, 'segment_by');
    if (input.order_by && !/^[a-zA-Z_][a-zA-Z0-9_]*(\s+(ASC|DESC))?$/i.test(input.order_by)) {
      throw new AppError(400, `Invalid order_by: "${input.order_by}". Use a column name with optional ASC/DESC.`);
    }
    await this.ensureExtension();

    if (input.dry_run) {
      const preview: any = await this.db.raw(`
        SELECT
          chunk_schema || '.' || chunk_name AS chunk,
          range_end::text AS range_end,
          pg_total_relation_size(format('%I.%I', chunk_schema, chunk_name)::regclass) AS size_bytes
        FROM timescaledb_information.chunks
        WHERE hypertable_schema = ? AND hypertable_name = ?
          AND NOT is_compressed
          AND range_end::timestamptz < NOW() - INTERVAL '${input.compress_after}'
        ORDER BY range_end
      `, [schema, input.table]);
      const chunks = (preview.rows ?? []).map((r: Record<string, unknown>) => ({
        chunk: r.chunk,
        range_end: r.range_end,
        size_bytes: Number(r.size_bytes ?? 0),
      }));
      const totalBytes = chunks.reduce((acc: number, c: { size_bytes: number }) => acc + c.size_bytes, 0);
      const oldest = chunks[0]?.range_end ?? null;
      const newest = chunks[chunks.length - 1]?.range_end ?? null;
      return {
        dry_run: true,
        table: `${schema}.${input.table}`,
        compress_after: input.compress_after,
        chunks_to_compress: chunks.length,
        bytes_currently_used: totalBytes,
        estimated_bytes_after_compression: Math.round(totalBytes * 0.1),
        oldest_chunk_being_compressed: oldest,
        newest_chunk_being_compressed: newest,
        note: 'Estimate assumes ~10x ratio (typical for time-series). Actual depends on cardinality and column types.',
        chunks,
      };
    }

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

  async addRetentionPolicy(schema: string, input: { table: string; drop_after: string; dry_run?: boolean }) {
    validateSchema(schema);
    validateIdentifier(input.table, 'table');
    validateInterval(input.drop_after, 'drop_after');
    await this.ensureExtension();

    if (input.dry_run) {
      const preview: any = await this.db.raw(`
        SELECT
          chunk_schema || '.' || chunk_name AS chunk,
          range_end::text AS range_end,
          pg_total_relation_size(format('%I.%I', chunk_schema, chunk_name)::regclass) AS size_bytes,
          is_compressed
        FROM timescaledb_information.chunks
        WHERE hypertable_schema = ? AND hypertable_name = ?
          AND range_end::timestamptz < NOW() - INTERVAL '${input.drop_after}'
        ORDER BY range_end
      `, [schema, input.table]);
      const chunks = (preview.rows ?? []).map((r: Record<string, unknown>) => ({
        chunk: r.chunk,
        range_end: r.range_end,
        size_bytes: Number(r.size_bytes ?? 0),
        is_compressed: !!r.is_compressed,
      }));
      const totalBytes = chunks.reduce((acc: number, c: { size_bytes: number }) => acc + c.size_bytes, 0);
      const oldest = chunks[0]?.range_end ?? null;
      const newest = chunks[chunks.length - 1]?.range_end ?? null;
      return {
        dry_run: true,
        table: `${schema}.${input.table}`,
        drop_after: input.drop_after,
        chunks_to_drop: chunks.length,
        bytes_to_free: totalBytes,
        oldest_chunk_being_dropped: oldest,
        newest_chunk_being_dropped: newest,
        chunks,
      };
    }

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
    // `finalized` column was removed in TimescaleDB 2.13; finalized form is the
    // only mode in 2.7+ so the field carries no information anymore. We expose
    // materialized_only and compression_enabled instead — both useful for
    // diagnostics and present in modern TS versions.
    const r: any = await this.db.raw(`
      SELECT
        view_name AS name,
        hypertable_schema AS source_schema,
        hypertable_name AS source_table,
        materialization_hypertable_schema AS materialization_schema,
        materialization_hypertable_name AS materialization_table,
        materialized_only,
        compression_enabled
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
        s.last_run_started_at,
        s.last_successful_finish,
        s.next_start,
        s.total_runs,
        s.total_successes,
        s.total_failures
      FROM timescaledb_information.jobs j
      LEFT JOIN timescaledb_information.job_stats s ON s.job_id = j.job_id
      WHERE j.hypertable_schema = ? OR j.hypertable_schema IS NULL
      ORDER BY j.job_id
    `, [schema]).catch(() => ({ rows: [] }));
    return r.rows;
  }

  async listRetentionPolicies(schema: string) {
    const jobs = await this.listJobs(schema);
    return jobs
      .filter((j: Record<string, unknown>) => j.proc_name === 'policy_retention')
      .map((j: Record<string, unknown>) => {
        const cfg = (typeof j.config === 'string' ? JSON.parse(j.config as string) : j.config) as Record<string, unknown> ?? {};
        return {
          job_id: j.job_id,
          table: j.hypertable_schema && j.hypertable_name ? `${j.hypertable_schema}.${j.hypertable_name}` : null,
          drop_after: cfg.drop_after ?? null,
          schedule_interval: j.schedule_interval,
          last_run_at: j.last_run_started_at ?? null,
          last_run_status: j.last_run_status ?? null,
          last_successful_finish: j.last_successful_finish ?? null,
          next_run_at: j.next_start ?? null,
          total_runs: j.total_runs ?? 0,
          total_failures: j.total_failures ?? 0,
        };
      });
  }

  async listCompressionPolicies(schema: string) {
    const jobs = await this.listJobs(schema);
    return jobs
      .filter((j: Record<string, unknown>) => j.proc_name === 'policy_compression')
      .map((j: Record<string, unknown>) => {
        const cfg = (typeof j.config === 'string' ? JSON.parse(j.config as string) : j.config) as Record<string, unknown> ?? {};
        return {
          job_id: j.job_id,
          table: j.hypertable_schema && j.hypertable_name ? `${j.hypertable_schema}.${j.hypertable_name}` : null,
          compress_after: cfg.compress_after ?? null,
          schedule_interval: j.schedule_interval,
          last_run_at: j.last_run_started_at ?? null,
          last_run_status: j.last_run_status ?? null,
          last_successful_finish: j.last_successful_finish ?? null,
          next_run_at: j.next_start ?? null,
          total_runs: j.total_runs ?? 0,
          total_failures: j.total_failures ?? 0,
        };
      });
  }

  // CALL refresh_continuous_aggregate(...) commits internally for each chunk
  // and PostgreSQL refuses to run it inside a transaction block. Knex's
  // `db.raw()` and `db.transaction()` both wrap statements in an implicit
  // transaction, so we acquire a raw pool connection and run the CALL in
  // autocommit mode. SET (not SET LOCAL) is used because there is no enclosing
  // transaction; we RESET on the way out so the pooled connection is clean for
  // the next caller.
  private async runAutocommit<T>(
    schema: string,
    timeoutMs: number,
    fn: (q: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>) => Promise<T>,
  ): Promise<T> {
    const conn: any = await (this.db as any).client.acquireConnection();
    try {
      const q = async (sql: string, params: unknown[] = []) => {
        const r = await conn.query(sql, params);
        return { rows: r.rows ?? [] };
      };
      await q(`SET statement_timeout = ${Math.floor(timeoutMs)}`);
      await q(`SET search_path TO "${schema}", public`);
      return await fn(q);
    } finally {
      try { await conn.query('RESET statement_timeout'); } catch {}
      try { await conn.query('RESET search_path'); } catch {}
      try { (this.db as any).client.releaseConnection(conn); } catch {}
    }
  }

  async removeRetentionPolicy(schema: string, table: string) {
    validateSchema(schema);
    validateIdentifier(table, 'table');
    await this.ensureExtension();
    await this.db.raw(
      `SELECT remove_retention_policy(?::regclass, if_exists => TRUE)`,
      [`${schema}.${table}`],
    );
    return { table: `${schema}.${table}`, removed: true };
  }

  async removeCompressionPolicy(schema: string, table: string) {
    validateSchema(schema);
    validateIdentifier(table, 'table');
    await this.ensureExtension();
    const r: any = await this.db.raw(
      `SELECT remove_compression_policy(?::regclass, if_exists => TRUE) AS removed`,
      [`${schema}.${table}`],
    );
    // remove_compression_policy returns boolean (whether something was removed)
    return { table: `${schema}.${table}`, removed: !!r.rows?.[0]?.removed };
  }

  async removeContinuousAggregatePolicy(schema: string, viewName: string) {
    validateSchema(schema);
    validateIdentifier(viewName, 'view_name');
    await this.ensureExtension();
    // remove_continuous_aggregate_policy(regclass, if_exists) returns void —
    // the SELECT yields a single empty-row result. Treat success as `removed:
    // true` so the caller doesn't see an empty string.
    await this.db.raw(
      `SELECT remove_continuous_aggregate_policy(?::regclass, if_exists => TRUE)`,
      [`${schema}.${viewName}`],
    );
    return { view: `${schema}.${viewName}`, removed: true };
  }

  async updateRetentionPolicy(schema: string, input: { table: string; drop_after: string }) {
    validateSchema(schema);
    validateIdentifier(input.table, 'table');
    validateInterval(input.drop_after, 'drop_after');
    await this.ensureExtension();
    return this.db.transaction(async (trx) => {
      await trx.raw(`SELECT remove_retention_policy(?::regclass, if_exists => TRUE)`, [`${schema}.${input.table}`]);
      const r: any = await trx.raw(
        `SELECT add_retention_policy(?::regclass, INTERVAL '${input.drop_after}') AS job_id`,
        [`${schema}.${input.table}`],
      );
      return { table: `${schema}.${input.table}`, drop_after: input.drop_after, job_id: r.rows?.[0]?.job_id ?? null };
    });
  }

  async updateCompressionPolicy(schema: string, input: { table: string; compress_after: string }) {
    validateSchema(schema);
    validateIdentifier(input.table, 'table');
    validateInterval(input.compress_after, 'compress_after');
    await this.ensureExtension();
    return this.db.transaction(async (trx) => {
      await trx.raw(`SELECT remove_compression_policy(?::regclass, if_exists => TRUE)`, [`${schema}.${input.table}`]);
      const r: any = await trx.raw(
        `SELECT add_compression_policy(?::regclass, INTERVAL '${input.compress_after}') AS job_id`,
        [`${schema}.${input.table}`],
      );
      return { table: `${schema}.${input.table}`, compress_after: input.compress_after, job_id: r.rows?.[0]?.job_id ?? null };
    });
  }

  async updateContinuousAggregatePolicy(
    schema: string,
    input: { view_name: string; start_offset: string; end_offset: string; schedule_interval: string },
  ) {
    validateSchema(schema);
    validateIdentifier(input.view_name, 'view_name');
    validateInterval(input.start_offset, 'start_offset');
    validateInterval(input.end_offset, 'end_offset');
    validateInterval(input.schedule_interval, 'schedule_interval');
    await this.ensureExtension();
    return this.db.transaction(async (trx) => {
      await trx.raw(`SELECT remove_continuous_aggregate_policy(?::regclass, if_exists => TRUE)`, [`${schema}.${input.view_name}`]);
      const r: any = await trx.raw(
        `SELECT add_continuous_aggregate_policy('${schema}.${input.view_name}',
          start_offset => INTERVAL '${input.start_offset}',
          end_offset => INTERVAL '${input.end_offset}',
          schedule_interval => INTERVAL '${input.schedule_interval}') AS job_id`,
      );
      return {
        view: `${schema}.${input.view_name}`,
        start_offset: input.start_offset,
        end_offset: input.end_offset,
        schedule_interval: input.schedule_interval,
        job_id: r.rows?.[0]?.job_id ?? null,
      };
    });
  }

  async dropContinuousAggregate(schema: string, viewName: string, cascade = false) {
    validateSchema(schema);
    validateIdentifier(viewName, 'view_name');
    await this.ensureExtension();
    const cas = cascade ? 'CASCADE' : 'RESTRICT';
    await this.db.raw(`DROP MATERIALIZED VIEW IF EXISTS "${schema}"."${viewName}" ${cas}`);
    return { view: `${schema}.${viewName}`, dropped: true, cascade };
  }

  async dropHypertable(schema: string, table: string, cascade = false) {
    validateSchema(schema);
    validateIdentifier(table, 'table');
    await this.ensureExtension();
    const cas = cascade ? 'CASCADE' : 'RESTRICT';
    await this.db.raw(`DROP TABLE IF EXISTS "${schema}"."${table}" ${cas}`);
    return { table: `${schema}.${table}`, dropped: true, cascade };
  }

  async dropChunks(schema: string, input: { hypertable: string; older_than: string }) {
    validateSchema(schema);
    validateIdentifier(input.hypertable, 'hypertable');
    validateInterval(input.older_than, 'older_than');
    await this.ensureExtension();
    const r: any = await this.db.raw(
      `SELECT drop_chunks(?::regclass, INTERVAL '${input.older_than}') AS chunk`,
      [`${schema}.${input.hypertable}`],
    );
    const dropped = (r.rows ?? []).map((row: { chunk: string }) => row.chunk);
    return { table: `${schema}.${input.hypertable}`, older_than: input.older_than, chunks_dropped: dropped.length, chunks: dropped };
  }

  async alterTimescaleJob(
    schema: string,
    input: { job_id: number; schedule_interval?: string; next_start?: string },
  ) {
    validateSchema(schema);
    if (typeof input.job_id !== 'number' || !Number.isInteger(input.job_id) || input.job_id <= 0) {
      throw new AppError(400, 'job_id must be a positive integer');
    }
    if (!input.schedule_interval && !input.next_start) {
      throw new AppError(400, 'At least one of schedule_interval or next_start must be provided');
    }
    if (input.schedule_interval) validateInterval(input.schedule_interval, 'schedule_interval');
    await this.ensureExtension();

    // Strict ownership: only jobs whose hypertable_schema matches the project
    // schema are alterable. System-wide jobs (policy_telemetry, job_stat_history
    // retention) have hypertable_schema = NULL and must not be alterable from a
    // project context — list_timescaledb_jobs still surfaces them for visibility,
    // but they're owned by the TimescaleDB extension, not the project.
    const ownsJob: any = await this.db.raw(
      `SELECT 1 FROM timescaledb_information.jobs
       WHERE job_id = ? AND hypertable_schema = ?`,
      [input.job_id, schema],
    );
    if (!ownsJob.rows?.length) {
      throw new AppError(404, `Job ${input.job_id} not found in schema "${schema}", or it is a system-wide TimescaleDB job (not alterable from a project). Use list_timescaledb_jobs to find a project-scoped job_id.`);
    }

    const parts: string[] = [`${input.job_id}`];
    if (input.schedule_interval) parts.push(`schedule_interval => INTERVAL '${input.schedule_interval}'`);
    if (input.next_start) parts.push(`next_start => '${input.next_start}'::timestamptz`);
    const r: any = await this.db.raw(`SELECT alter_job(${parts.join(', ')}) AS row`);
    return { job_id: input.job_id, ...(r.rows?.[0] ?? {}) };
  }

  // Validate that a chunk identifier passed by the user actually belongs to
  // the project schema. Chunks live in `_timescaledb_internal` but are
  // associated with hypertables in user schemas; without this check a
  // project-scoped operator could compress / decompress chunks of an
  // unrelated tenant. Accepts either "schema.chunk" or just "chunk" — if no
  // schema is provided, defaults to _timescaledb_internal.
  private async resolveChunk(schema: string, chunkName: string): Promise<string> {
    const cleaned = chunkName.replace(/"/g, '');
    const parts = cleaned.split('.');
    const chunkSchema = parts.length === 2 ? parts[0] : '_timescaledb_internal';
    const chunkRel = parts.length === 2 ? parts[1] : parts[0];
    if (!/^[a-z_][a-z0-9_]*$/.test(chunkSchema) || !/^[a-z_][a-z0-9_]*$/.test(chunkRel)) {
      throw new AppError(400, `Invalid chunk name "${chunkName}". Use "_timescaledb_internal._hyper_..._chunk" or just the chunk relname.`);
    }
    const r: any = await this.db.raw(
      `SELECT chunk_schema, chunk_name, hypertable_schema, hypertable_name
       FROM timescaledb_information.chunks
       WHERE chunk_schema = ? AND chunk_name = ?`,
      [chunkSchema, chunkRel],
    );
    const row = r.rows?.[0];
    if (!row) {
      throw new AppError(404, `Chunk "${chunkSchema}.${chunkRel}" not found in TimescaleDB catalog.`);
    }
    if (row.hypertable_schema !== schema) {
      throw new AppError(403, `Chunk "${chunkSchema}.${chunkRel}" belongs to hypertable "${row.hypertable_schema}.${row.hypertable_name}", not the current project schema "${schema}".`);
    }
    return `${row.chunk_schema}.${row.chunk_name}`;
  }

  async compressChunk(schema: string, input: { chunk_name: string; if_not_compressed?: boolean }) {
    validateSchema(schema);
    await this.ensureExtension();
    const fqChunk = await this.resolveChunk(schema, input.chunk_name);
    const ifNotCompressed = input.if_not_compressed ?? true;
    // compress_chunk is a FUNCTION (returns regclass), not a procedure, so we
    // invoke via SELECT — but we still run on the autocommit connection because
    // TimescaleDB takes its own internal locks and benefits from being outside
    // an outer transaction (and to stay consistent with decompress/recompress).
    return this.runAutocommit(schema, 600_000, async (q) => {
      const start = Date.now();
      const r = await q(
        `SELECT compress_chunk('${fqChunk}'::regclass, if_not_compressed => ${ifNotCompressed ? 'TRUE' : 'FALSE'}) AS compressed_chunk`,
      );
      const row = (r.rows?.[0] ?? {}) as Record<string, unknown>;
      return { chunk: fqChunk, compressed_chunk: row.compressed_chunk ?? null, duration_ms: Date.now() - start };
    });
  }

  async decompressChunk(schema: string, input: { chunk_name: string; if_compressed?: boolean }) {
    validateSchema(schema);
    await this.ensureExtension();
    const fqChunk = await this.resolveChunk(schema, input.chunk_name);
    const ifCompressed = input.if_compressed ?? true;
    return this.runAutocommit(schema, 600_000, async (q) => {
      const start = Date.now();
      const r = await q(
        `SELECT decompress_chunk('${fqChunk}'::regclass, if_compressed => ${ifCompressed ? 'TRUE' : 'FALSE'}) AS decompressed_chunk`,
      );
      const row = (r.rows?.[0] ?? {}) as Record<string, unknown>;
      return { chunk: fqChunk, decompressed_chunk: row.decompressed_chunk ?? null, duration_ms: Date.now() - start };
    });
  }

  async recompressChunk(schema: string, input: { chunk_name: string }) {
    validateSchema(schema);
    await this.ensureExtension();
    const fqChunk = await this.resolveChunk(schema, input.chunk_name);
    // recompress_chunk was deprecated in TS 2.18 in favor of policy refresh —
    // but it's still available. We forward to it; if the function is missing
    // (very recent TS), surface a helpful error.
    return this.runAutocommit(schema, 600_000, async (q) => {
      const start = Date.now();
      try {
        await q(`CALL recompress_chunk('${fqChunk}'::regclass)`);
      } catch (err) {
        const msg = (err as Error).message ?? '';
        if (/does not exist|undefined function/i.test(msg)) {
          throw new AppError(501, 'recompress_chunk is not available in this TimescaleDB version. Use decompress_chunk + compress_chunk as a workaround, or wait for the compression policy to recompress.');
        }
        throw err;
      }
      return { chunk: fqChunk, recompressed: true, duration_ms: Date.now() - start };
    });
  }

  async runTimescaleJob(schema: string, input: { job_id: number }) {
    validateSchema(schema);
    if (typeof input.job_id !== 'number' || !Number.isInteger(input.job_id) || input.job_id <= 0) {
      throw new AppError(400, 'job_id must be a positive integer');
    }
    await this.ensureExtension();

    // Strict project ownership: same rule as alter_timescaledb_job. System-wide
    // jobs (telemetry, job_stat_history) cannot be triggered from a project
    // context — they have hypertable_schema = NULL.
    const ownsJob: any = await this.db.raw(
      `SELECT 1 FROM timescaledb_information.jobs
       WHERE job_id = ? AND hypertable_schema = ?`,
      [input.job_id, schema],
    );
    if (!ownsJob.rows?.length) {
      throw new AppError(404, `Job ${input.job_id} not found in schema "${schema}", or it is a system-wide TimescaleDB job (not runnable from a project). Use list_timescaledb_jobs to find a project-scoped job_id.`);
    }

    return this.runAutocommit(schema, 1_800_000, async (q) => {
      const start = Date.now();
      await q(`CALL run_job(${input.job_id})`);
      return { job_id: input.job_id, ran: true, duration_ms: Date.now() - start };
    });
  }

  async setChunkTimeInterval(schema: string, input: { hypertable: string; new_interval: string }) {
    validateSchema(schema);
    validateIdentifier(input.hypertable, 'hypertable');
    validateInterval(input.new_interval, 'new_interval');
    await this.ensureExtension();
    const r: any = await this.db.raw(
      `SELECT set_chunk_time_interval(?::regclass, INTERVAL '${input.new_interval}')`,
      [`${schema}.${input.hypertable}`],
    );
    return {
      hypertable: `${schema}.${input.hypertable}`,
      new_interval: input.new_interval,
      result: r.rows?.[0]?.set_chunk_time_interval ?? null,
      note: 'Existing chunks keep their current width; only chunks created from now on will use the new interval.',
    };
  }

  async refreshContinuousAggregate(
    schema: string,
    input: {
      view_name: string;
      window_start?: string | null;
      window_end?: string | null;
      wait?: boolean;
      statement_timeout_ms?: number;
    },
  ) {
    validateSchema(schema);
    validateIdentifier(input.view_name, 'view_name');
    await this.ensureExtension();

    const wait = input.wait ?? true;
    const timeoutMs = Math.min(Math.max(input.statement_timeout_ms ?? 300_000, 5_000), 1_800_000);
    const fqView = `"${schema}"."${input.view_name}"`;
    const windowStart = input.window_start ?? null;
    const windowEnd = input.window_end ?? null;

    const callRefresh = async (q: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>) => {
      await q(
        `CALL refresh_continuous_aggregate($1::regclass, $2::timestamptz, $3::timestamptz)`,
        [`${schema}.${input.view_name}`, windowStart, windowEnd],
      );
    };

    if (wait) {
      const start = Date.now();
      try {
        await this.runAutocommit(schema, timeoutMs, callRefresh);
      } catch (err) {
        const msg = (err as Error).message ?? '';
        if (/cannot run inside a transaction/i.test(msg)) {
          throw new AppError(500, `refresh_continuous_aggregate hit transaction-block error despite autocommit runner: ${msg}. Report this — the connection pool may be misconfigured.`);
        }
        throw err;
      }
      return {
        view: `${schema}.${input.view_name}`,
        window_start: windowStart,
        window_end: windowEnd,
        duration_ms: Date.now() - start,
        mode: 'sync' as const,
      };
    }

    void this.runAutocommit(schema, timeoutMs, callRefresh).catch(() => {});
    return {
      view: `${schema}.${input.view_name}`,
      window_start: windowStart,
      window_end: windowEnd,
      mode: 'async' as const,
      note: 'Refresh dispatched in background. There is no job_id for one-shot refreshes — verify completion by querying the view or watching size growth via list_continuous_aggregates.',
    };
  }
}
