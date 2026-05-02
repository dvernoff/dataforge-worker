import type { FastifyInstance } from 'fastify';
import { nodeAuthMiddleware } from '../../middleware/node-auth.middleware.js';
import { requireWorkerRole } from '../../middleware/worker-rbac.middleware.js';
import { AppError } from '../../middleware/error-handler.js';

const SAFE_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

const ALLOWED_PG_TYPES = new Set([
  'integer', 'bigint', 'smallint', 'serial', 'bigserial',
  'real', 'double precision', 'numeric', 'decimal',
  'boolean', 'text', 'character varying', 'character', 'varchar', 'char',
  'uuid', 'jsonb', 'json',
  'timestamp with time zone', 'timestamp without time zone',
  'date', 'time with time zone', 'time without time zone',
  'interval', 'bytea', 'inet', 'cidr', 'macaddr',
  'point', 'line', 'lseg', 'box', 'path', 'polygon', 'circle',
  'tsquery', 'tsvector', 'xml', 'money',
]);

const SYSTEM_TABLES_TO_BACKUP = [
  'api_endpoints',
  'validation_rules',
  'webhooks',
  'saved_queries',
  'record_comments',
];

function resolveProjectSchema(request: any): string {
  const schema = request.projectSchema;
  if (!schema || !SAFE_NAME_RE.test(schema)) throw new AppError(400, 'Invalid project schema');
  return schema;
}

function resolveProjectId(request: any): string {
  const id = (request.params as any)?.projectId;
  if (!id) throw new AppError(400, 'Missing projectId');
  return id;
}

function validateName(name: string): boolean {
  return SAFE_NAME_RE.test(name) && name.length <= 63;
}

function sanitizeType(type: string): string {
  const t = type.toLowerCase().trim();
  if (ALLOWED_PG_TYPES.has(t)) return t;
  if (t === 'array' || t.endsWith('[]')) return 'jsonb';
  if (t === 'user-defined') return 'text';
  return 'text';
}

export async function backupExportRoutes(app: FastifyInstance) {
  app.addHook('preHandler', nodeAuthMiddleware);
  app.addHook('preHandler', requireWorkerRole('admin'));

  // Streaming NDJSON export.
  //
  // The old /backups/export-data loaded every row into memory, JSON.stringified it, and
  // returned a single huge response. On 5M rows / 400 MB this ballooned to ~2-3 GB and
  // routinely exceeded nginx's 60s proxy_read_timeout, producing 504s.
  //
  // This endpoint writes the backup as NDJSON events so CP can pipe them straight into
  // gzip + disk without ever holding the full payload in memory. Each line is one JSON
  // object with a discriminator `kind`:
  //   {kind:"meta", version, exportedAt, tables, schema, indexes, constraints, checkDefs}
  //   {kind:"row", table, data: <row>}
  //   {kind:"system_row", table, data: <row>}
  //   {kind:"end"}
  app.get('/:projectId/backups/export-stream', async (request: any, reply: any) => {
    const dbSchema = resolveProjectSchema(request);
    const projectId = resolveProjectId(request);

    const tablesResult = await app.db.raw(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = ? AND table_type = 'BASE TABLE'
       AND table_name NOT LIKE '__history_%'
       ORDER BY table_name`,
      [dbSchema],
    );
    const tableNames: string[] = tablesResult.rows.map((r: any) => r.table_name).filter((n: string) => validateName(n));

    // Collect schema + indexes + constraints upfront (small, safe to buffer)
    const schemaMeta: Record<string, { name: string; type: string; nullable: boolean; default_value: string | null }[]> = {};
    for (const table of tableNames) {
      const cols = await app.db.raw(
        `SELECT column_name as name, data_type as type,
                is_nullable = 'YES' as nullable, column_default as default_value
         FROM information_schema.columns
         WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position`,
        [dbSchema, table],
      );
      schemaMeta[table] = cols.rows;
    }
    const indexesResult = await app.db.raw(
      `SELECT indexname, indexdef FROM pg_indexes
       WHERE schemaname = ? AND indexname NOT LIKE '%_pkey'
       ORDER BY tablename, indexname`,
      [dbSchema],
    );
    const constraintsResult = await app.db.raw(
      `SELECT tc.constraint_name, tc.table_name, tc.constraint_type, kcu.column_name,
              ccu.table_schema AS foreign_table_schema, ccu.table_name AS foreign_table_name,
              ccu.column_name AS foreign_column_name, rc.update_rule, rc.delete_rule
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       LEFT JOIN information_schema.constraint_column_usage ccu
         ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
       LEFT JOIN information_schema.referential_constraints rc
         ON tc.constraint_name = rc.constraint_name AND tc.constraint_schema = rc.constraint_schema
       WHERE tc.table_schema = ? AND tc.constraint_type IN ('FOREIGN KEY', 'UNIQUE', 'CHECK')
       ORDER BY tc.table_name, tc.constraint_name`,
      [dbSchema],
    );
    const checkDefsResult = await app.db.raw(
      `SELECT conname AS constraint_name, pg_get_constraintdef(c.oid) AS check_definition
       FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
       WHERE n.nspname = ? AND c.contype = 'c'`,
      [dbSchema],
    );
    const checkDefs: Record<string, string> = {};
    for (const row of checkDefsResult.rows) checkDefs[row.constraint_name] = row.check_definition;

    reply.raw.writeHead(200, {
      'content-type': 'application/x-ndjson',
      'cache-control': 'no-cache',
      'transfer-encoding': 'chunked',
    });

    const write = (obj: unknown) => new Promise<void>((resolve, reject) => {
      reply.raw.write(JSON.stringify(obj) + '\n', (err: Error | null | undefined) => err ? reject(err) : resolve());
    });

    try {
      await write({
        kind: 'meta',
        version: 2,
        exportedAt: new Date().toISOString(),
        tables: tableNames,
        schema: schemaMeta,
        indexes: indexesResult.rows,
        constraints: constraintsResult.rows,
        checkDefs,
      });

      // Stream rows per table using a server-side cursor to avoid loading entire table into memory.
      for (const table of tableNames) {
        const stream = app.db(`${dbSchema}.${table}`).stream({ batchSize: 1000 });
        for await (const row of stream) {
          await write({ kind: 'row', table, data: row });
        }
      }

      // System tables (small, can load directly)
      for (const sysTable of SYSTEM_TABLES_TO_BACKUP) {
        try {
          const stream = app.db(sysTable).where({ project_id: projectId }).stream({ batchSize: 500 });
          for await (const row of stream) {
            await write({ kind: 'system_row', table: sysTable, data: row });
          }
        } catch {}
      }

      await write({ kind: 'end' });
    } catch (err) {
      await write({ kind: 'error', message: (err as Error).message }).catch(() => {});
    } finally {
      reply.raw.end();
    }
  });

  app.get('/:projectId/backups/export-data', async (request) => {
    const dbSchema = resolveProjectSchema(request);
    const projectId = resolveProjectId(request);

    const tablesResult = await app.db.raw(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = ? AND table_type = 'BASE TABLE'
       AND table_name NOT LIKE '__history_%'
       ORDER BY table_name`,
      [dbSchema],
    );

    const tableNames: string[] = tablesResult.rows.map((r: any) => r.table_name);
    const data: Record<string, unknown[]> = {};
    const schema: Record<string, { name: string; type: string; nullable: boolean; default_value: string | null }[]> = {};

    for (const table of tableNames) {
      if (!validateName(table)) continue;
      const rows = await app.db.raw(`SELECT * FROM "${dbSchema}"."${table}"`);
      data[table] = rows.rows;

      const cols = await app.db.raw(
        `SELECT column_name as name, data_type as type,
                is_nullable = 'YES' as nullable,
                column_default as default_value
         FROM information_schema.columns
         WHERE table_schema = ? AND table_name = ?
         ORDER BY ordinal_position`,
        [dbSchema, table],
      );
      schema[table] = cols.rows;
    }

    const indexesResult = await app.db.raw(
      `SELECT indexname, indexdef
       FROM pg_indexes
       WHERE schemaname = ?
       AND indexname NOT LIKE '%_pkey'
       ORDER BY tablename, indexname`,
      [dbSchema],
    );
    const indexes: { indexname: string; indexdef: string }[] = indexesResult.rows;

    const constraintsResult = await app.db.raw(
      `SELECT
         tc.constraint_name,
         tc.table_name,
         tc.constraint_type,
         kcu.column_name,
         ccu.table_schema AS foreign_table_schema,
         ccu.table_name AS foreign_table_name,
         ccu.column_name AS foreign_column_name,
         rc.update_rule,
         rc.delete_rule
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       LEFT JOIN information_schema.constraint_column_usage ccu
         ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
       LEFT JOIN information_schema.referential_constraints rc
         ON tc.constraint_name = rc.constraint_name AND tc.constraint_schema = rc.constraint_schema
       WHERE tc.table_schema = ?
       AND tc.constraint_type IN ('FOREIGN KEY', 'UNIQUE', 'CHECK')
       ORDER BY tc.table_name, tc.constraint_name`,
      [dbSchema],
    );
    const constraints: any[] = constraintsResult.rows;

    const checkDefsResult = await app.db.raw(
      `SELECT conname AS constraint_name, pg_get_constraintdef(c.oid) AS check_definition
       FROM pg_constraint c
       JOIN pg_namespace n ON n.oid = c.connamespace
       WHERE n.nspname = ? AND c.contype = 'c'`,
      [dbSchema],
    );
    const checkDefs: Record<string, string> = {};
    for (const row of checkDefsResult.rows) {
      checkDefs[row.constraint_name] = row.check_definition;
    }

    const systemTables: Record<string, unknown[]> = {};
    for (const sysTable of SYSTEM_TABLES_TO_BACKUP) {
      try {
        const rows = await app.db(sysTable).where({ project_id: projectId });
        if (rows.length > 0) {
          systemTables[sysTable] = rows;
        }
      } catch {}
    }

    return {
      version: 2,
      tables: tableNames,
      schema,
      data,
      indexes,
      constraints,
      checkDefs,
      systemTables,
      exportedAt: new Date().toISOString(),
    };
  });

  // Streaming NDJSON restore — counterpart to /backups/export-stream.
  // Accepts the same NDJSON event stream (meta / row / system_row / end) via POST body
  // and applies it incrementally in ONE transaction. No full-body buffering, so restore
  // of multi-GB backups works without OOM.
  //
  // Body is raw NDJSON (Content-Type: application/x-ndjson). Request body parsing is
  // skipped via `config.rawBody = true` pattern — we consume `request.raw` directly.
  app.post('/:projectId/backups/restore-stream', {
    bodyLimit: 50 * 1024 * 1024 * 1024, // 50 GB upper bound — body is streamed, this is just a safety ceiling
    config: { rawBody: true },
  }, async (request: any, reply: any) => {
    const dbSchema = resolveProjectSchema(request);
    const projectId = resolveProjectId(request);

    // Stats to report at the end
    let metaSeen = false;
    let totalRows = 0;
    let totalSystemRows = 0;
    const tablesRestored = new Set<string>();
    let errorEvent: string | null = null;

    const BATCH_SIZE = 500;

    // Per-table row buffer. Flushed on batch overflow, on table switch, or at end.
    const buffers = new Map<string, Record<string, unknown>[]>();
    const sysBuffers = new Map<string, Record<string, unknown>[]>();

    // State collected from the meta event
    let meta: {
      version?: number;
      tables?: string[];
      schema?: Record<string, { name: string; type: string; nullable: boolean; default_value: string | null }[]>;
      indexes?: { indexname: string; indexdef: string }[];
      constraints?: any[];
      checkDefs?: Record<string, string>;
    } | null = null;

    try {
      await app.db.transaction(async (trx: any) => {
        // --- Helpers ---

        // Per-table column-type cache. 'array' columns are native PG arrays (knex takes JS array
        // as-is); 'jsonb'/'json' columns need JSON.stringify. Everything else passes through.
        const colTypeCache = new Map<string, Map<string, 'array' | 'json' | 'other'>>();
        const getColTypes = async (schemaName: string, tableName: string): Promise<Map<string, 'array' | 'json' | 'other'>> => {
          const key = `${schemaName}.${tableName}`;
          let cached = colTypeCache.get(key);
          if (cached) return cached;
          const r: any = await trx.raw(
            `SELECT column_name, data_type FROM information_schema.columns
             WHERE table_schema = ? AND table_name = ?`,
            [schemaName, tableName],
          );
          cached = new Map();
          for (const row of r.rows as { column_name: string; data_type: string }[]) {
            if (row.data_type === 'ARRAY') cached.set(row.column_name, 'array');
            else if (row.data_type === 'json' || row.data_type === 'jsonb') cached.set(row.column_name, 'json');
            else cached.set(row.column_name, 'other');
          }
          colTypeCache.set(key, cached);
          return cached;
        };
        const normalizeRow = (row: Record<string, unknown>, types: Map<string, 'array' | 'json' | 'other'>) => {
          const fixed: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(row)) {
            if (v === null || v === undefined) { fixed[k] = v; continue; }
            const t = types.get(k);
            if (t === 'array') {
              // Native PG array: accept JS array directly; if it arrived as stringified JSON array, parse it back
              fixed[k] = Array.isArray(v) ? v : (typeof v === 'string' && v.startsWith('[') ? JSON.parse(v) : v);
            } else if (t === 'json') {
              fixed[k] = typeof v === 'object' ? JSON.stringify(v) : v;
            } else {
              fixed[k] = v;
            }
          }
          return fixed;
        };

        const flushBuffer = async (table: string) => {
          const rows = buffers.get(table);
          if (!rows || rows.length === 0) return;
          const types = await getColTypes(dbSchema, table);
          const cleaned = rows.map((r) => normalizeRow(r, types));
          await trx(`${dbSchema}.${table}`).insert(cleaned);
          totalRows += rows.length;
          rows.length = 0;
        };

        const flushSysBuffer = async (sysTable: string) => {
          const rows = sysBuffers.get(sysTable);
          if (!rows || rows.length === 0) return;
          const types = await getColTypes('public', sysTable);
          const cleaned = rows.map((r) => normalizeRow(r, types));
          await trx(sysTable).insert(cleaned);
          totalSystemRows += rows.length;
          rows.length = 0;
        };

        // Called on the FIRST meta event — drops FKs and prepares target tables.
        const applyMeta = async (m: typeof meta) => {
          if (!m) return;
          meta = m;
          metaSeen = true;

          const existingTables = await trx.raw(
            `SELECT table_name FROM information_schema.tables
             WHERE table_schema = ? AND table_type = 'BASE TABLE'`,
            [dbSchema],
          );
          const existingSet = new Set(existingTables.rows.map((r: any) => r.table_name));
          const plannedTables = m.tables ?? Object.keys(m.schema ?? {});

          // Drop FKs on tables we'll repopulate (only for V2 backups with constraints meta)
          if (m.version === 2 && Array.isArray(m.constraints)) {
            const fkTableNames = new Set(
              m.constraints.filter((c: any) => c.constraint_type === 'FOREIGN KEY').map((c: any) => c.table_name),
            );
            for (const table of plannedTables) {
              if (!validateName(table)) continue;
              if (existingSet.has(table) && fkTableNames.has(table)) {
                const existingFks = await trx.raw(
                  `SELECT tc.constraint_name FROM information_schema.table_constraints tc
                   WHERE tc.table_schema = ? AND tc.table_name = ? AND tc.constraint_type = 'FOREIGN KEY'`,
                  [dbSchema, table],
                );
                for (const fk of existingFks.rows) {
                  await trx.raw(`ALTER TABLE "${dbSchema}"."${table}" DROP CONSTRAINT IF EXISTS "${fk.constraint_name}"`);
                }
              }
            }
          }

          // Pre-delete rows in system tables for this project (otherwise we'd hit PK conflicts
          // as system_row events arrive and batch-flush)
          for (const sysTable of SYSTEM_TABLES_TO_BACKUP) {
            try { await trx(sysTable).where({ project_id: projectId }).del(); } catch {}
          }

          // Create-or-truncate target tables
          for (const table of plannedTables) {
            if (!validateName(table)) continue;
            if (!existingSet.has(table)) {
              const tableCols = m.schema?.[table];
              if (!tableCols || tableCols.length === 0) continue;
              const validCols = tableCols.filter((c) => validateName(c.name));
              if (validCols.length === 0) continue;
              const colDefs = validCols.map((c) => {
                const safeType = sanitizeType(c.type);
                const nullable = c.nullable !== false ? '' : ' NOT NULL';
                let defaultStr = '';
                if (c.default_value && !String(c.default_value).includes('nextval')) {
                  defaultStr = ` DEFAULT ${c.default_value}`;
                }
                return `"${c.name}" ${safeType}${nullable}${defaultStr}`;
              }).join(', ');
              await trx.raw(`CREATE TABLE "${dbSchema}"."${table}" (${colDefs})`);
            } else {
              await trx.raw(`DELETE FROM "${dbSchema}"."${table}"`);
            }
            tablesRestored.add(table);
          }
        };

        const applyEndOfStream = async () => {
          // Flush any leftover buffered rows
          for (const table of buffers.keys()) await flushBuffer(table);
          for (const sys of sysBuffers.keys()) await flushSysBuffer(sys);

          if (!meta) return;

          // Rebuild indexes
          if (meta.version === 2 && Array.isArray(meta.indexes)) {
            for (const idx of meta.indexes) {
              try {
                const def = idx.indexdef.replace(
                  /CREATE (UNIQUE )?INDEX (\S+) ON \S+\.(\S+)/,
                  `CREATE $1INDEX IF NOT EXISTS $2 ON "${dbSchema}".$3`,
                );
                await trx.raw('SAVEPOINT idx_sp');
                await trx.raw(def);
                await trx.raw('RELEASE SAVEPOINT idx_sp');
              } catch {
                await trx.raw('ROLLBACK TO SAVEPOINT idx_sp').catch(() => {});
              }
            }
          }

          // Rebuild constraints (UNIQUE / FK / CHECK)
          if (meta.version === 2 && Array.isArray(meta.constraints)) {
            const grouped: Record<string, any[]> = {};
            for (const c of meta.constraints) {
              const key = `${c.table_name}::${c.constraint_name}`;
              (grouped[key] ??= []).push(c);
            }
            for (const entries of Object.values(grouped)) {
              const first = entries[0];
              if (!validateName(first.table_name)) continue;
              try {
                await trx.raw('SAVEPOINT con_sp');
                if (first.constraint_type === 'UNIQUE') {
                  const cols = entries.map((e: any) => `"${e.column_name}"`).join(', ');
                  await trx.raw(
                    `ALTER TABLE "${dbSchema}"."${first.table_name}"
                     ADD CONSTRAINT "${first.constraint_name}" UNIQUE (${cols})`,
                  );
                } else if (first.constraint_type === 'FOREIGN KEY') {
                  await trx.raw(
                    `ALTER TABLE "${dbSchema}"."${first.table_name}"
                     ADD CONSTRAINT "${first.constraint_name}"
                     FOREIGN KEY ("${first.column_name}")
                     REFERENCES "${first.foreign_table_schema}"."${first.foreign_table_name}"("${first.foreign_column_name}")
                     ON UPDATE ${first.update_rule ?? 'NO ACTION'}
                     ON DELETE ${first.delete_rule ?? 'NO ACTION'}`,
                  );
                } else if (first.constraint_type === 'CHECK' && meta.checkDefs?.[first.constraint_name]) {
                  await trx.raw(
                    `ALTER TABLE "${dbSchema}"."${first.table_name}"
                     ADD CONSTRAINT "${first.constraint_name}" ${meta.checkDefs[first.constraint_name]}`,
                  );
                }
                await trx.raw('RELEASE SAVEPOINT con_sp');
              } catch {
                await trx.raw('ROLLBACK TO SAVEPOINT con_sp').catch(() => {});
              }
            }
          }

          // System tables were pre-deleted in applyMeta and rows streamed in.
          // Final flushBuffer loop above already wrote any leftovers.
        };

        // --- Stream NDJSON from request body ---
        // The passthrough parser (registered in index.ts for application/x-ndjson-stream) hands us
        // the raw payload stream as request.body. We iterate it line-by-line without buffering.
        const stream = request.body ?? request.raw;
        let buf = '';
        for await (const chunk of stream as any) {
          buf += (chunk as Buffer).toString('utf8');
          let nl: number;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl);
            buf = buf.slice(nl + 1);
            if (!line.trim()) continue;
            let ev: any;
            try { ev = JSON.parse(line); } catch { continue; }

            if (ev.kind === 'meta') {
              await applyMeta(ev);
            } else if (ev.kind === 'row' && ev.table && ev.data) {
              if (!validateName(ev.table)) continue;
              const arr = buffers.get(ev.table) ?? [];
              if (!buffers.has(ev.table)) buffers.set(ev.table, arr);
              arr.push(ev.data);
              if (arr.length >= BATCH_SIZE) await flushBuffer(ev.table);
            } else if (ev.kind === 'system_row' && ev.table && ev.data) {
              if (!SYSTEM_TABLES_TO_BACKUP.includes(ev.table)) continue;
              const arr = sysBuffers.get(ev.table) ?? [];
              if (!sysBuffers.has(ev.table)) sysBuffers.set(ev.table, arr);
              arr.push(ev.data);
              if (arr.length >= BATCH_SIZE) await flushSysBuffer(ev.table);
            } else if (ev.kind === 'error') {
              errorEvent = String(ev.message ?? 'unknown');
              throw new AppError(400, `Backup archive contains error event: ${errorEvent}`);
            } else if (ev.kind === 'end') {
              await applyEndOfStream();
            }
          }
        }

        // If no end event arrived (truncated archive), still flush + finalize
        if (meta) await applyEndOfStream();
      });

      if (!metaSeen) {
        reply.status(400);
        return { success: false, error: 'No meta event received — archive is empty or malformed' };
      }

      return {
        success: true,
        restored: {
          tables: [...tablesRestored],
          total_rows: totalRows,
          total_system_rows: totalSystemRows,
        },
      };
    } catch (err) {
      if (err instanceof AppError) throw err;
      app.log.error({ err }, 'restore-stream failed');
      const msg = (err as Error).message ?? 'Unknown restore error';
      throw new AppError(500, `Restore failed: ${msg.slice(0, 500)}`);
    }
  });

  app.post('/:projectId/backups/restore-data', { bodyLimit: 100 * 1024 * 1024 }, async (request) => {
    const dbSchema = resolveProjectSchema(request);
    const projectId = resolveProjectId(request);
    const body = request.body as {
      version?: number;
      data: Record<string, any[]>;
      schema?: Record<string, { name: string; type: string; nullable: boolean; default_value?: string | null }[]>;
      indexes?: { indexname: string; indexdef: string }[];
      constraints?: any[];
      checkDefs?: Record<string, string>;
      systemTables?: Record<string, any[]>;
    };

    if (!body.data || typeof body.data !== 'object') {
      throw new AppError(400, 'Missing data object');
    }

    const existingTables = await app.db.raw(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = ? AND table_type = 'BASE TABLE'`,
      [dbSchema],
    );
    const existingSet = new Set(existingTables.rows.map((r: any) => r.table_name));

    await app.db.transaction(async (trx) => {
      if (body.version === 2) {
        const fkConstraints = (body.constraints ?? []).filter((c: any) => c.constraint_type === 'FOREIGN KEY');
        const fkTableNames = new Set(fkConstraints.map((c: any) => c.table_name));

        for (const table of Object.keys(body.data)) {
          if (!validateName(table)) continue;
          if (existingSet.has(table) && fkTableNames.has(table)) {
            const existingFks = await trx.raw(
              `SELECT tc.constraint_name
               FROM information_schema.table_constraints tc
               WHERE tc.table_schema = ? AND tc.table_name = ? AND tc.constraint_type = 'FOREIGN KEY'`,
              [dbSchema, table],
            );
            for (const fk of existingFks.rows) {
              await trx.raw(`ALTER TABLE "${dbSchema}"."${table}" DROP CONSTRAINT IF EXISTS "${fk.constraint_name}"`);
            }
          }
        }
      }

      for (const [table, rows] of Object.entries(body.data)) {
        if (!validateName(table)) continue;

        if (!existingSet.has(table)) {
          const tableCols = body.schema?.[table];
          if (!tableCols || tableCols.length === 0) continue;

          const validCols = tableCols.filter((c) => validateName(c.name));
          if (validCols.length === 0) continue;

          const colDefs = validCols.map((c) => {
            const safeType = sanitizeType(c.type);
            const nullable = c.nullable !== false ? '' : ' NOT NULL';
            let defaultStr = '';
            if (c.default_value && !c.default_value.includes('nextval')) {
              defaultStr = ` DEFAULT ${c.default_value}`;
            }
            return `"${c.name}" ${safeType}${nullable}${defaultStr}`;
          }).join(', ');

          await trx.raw(`CREATE TABLE "${dbSchema}"."${table}" (${colDefs})`);
        } else {
          await trx.raw(`DELETE FROM "${dbSchema}"."${table}"`);
        }

        if (Array.isArray(rows) && rows.length > 0) {
          const batchSize = 500;
          for (let i = 0; i < rows.length; i += batchSize) {
            const batch = rows.slice(i, i + batchSize).map((row: Record<string, unknown>) => {
              const fixed: Record<string, unknown> = {};
              for (const [k, v] of Object.entries(row)) {
                fixed[k] = (v !== null && typeof v === 'object') ? JSON.stringify(v) : v;
              }
              return fixed;
            });
            await trx(`${dbSchema}.${table}`).insert(batch);
          }
        }
      }

      if (body.version === 2 && body.indexes) {
        for (const idx of body.indexes) {
          try {
            const def = idx.indexdef.replace(
              /CREATE (UNIQUE )?INDEX (\S+) ON \S+\.(\S+)/,
              `CREATE $1INDEX IF NOT EXISTS $2 ON "${dbSchema}".$3`,
            );
            await trx.raw('SAVEPOINT idx_sp');
            await trx.raw(def);
            await trx.raw('RELEASE SAVEPOINT idx_sp');
          } catch {
            await trx.raw('ROLLBACK TO SAVEPOINT idx_sp').catch(() => {});
          }
        }
      }

      if (body.version === 2 && body.constraints) {
        const grouped: Record<string, any[]> = {};
        for (const c of body.constraints) {
          const key = `${c.table_name}::${c.constraint_name}`;
          if (!grouped[key]) grouped[key] = [];
          grouped[key].push(c);
        }

        for (const entries of Object.values(grouped)) {
          const first = entries[0];
          if (!validateName(first.table_name)) continue;

          try {
            await trx.raw('SAVEPOINT con_sp');
            if (first.constraint_type === 'UNIQUE') {
              const cols = entries.map((e: any) => `"${e.column_name}"`).join(', ');
              await trx.raw(
                `ALTER TABLE "${dbSchema}"."${first.table_name}"
                 ADD CONSTRAINT "${first.constraint_name}" UNIQUE (${cols})`,
              );
            } else if (first.constraint_type === 'FOREIGN KEY') {
              await trx.raw(
                `ALTER TABLE "${dbSchema}"."${first.table_name}"
                 ADD CONSTRAINT "${first.constraint_name}"
                 FOREIGN KEY ("${first.column_name}")
                 REFERENCES "${first.foreign_table_schema}"."${first.foreign_table_name}"("${first.foreign_column_name}")
                 ON UPDATE ${first.update_rule ?? 'NO ACTION'}
                 ON DELETE ${first.delete_rule ?? 'NO ACTION'}`,
              );
            } else if (first.constraint_type === 'CHECK' && body.checkDefs?.[first.constraint_name]) {
              await trx.raw(
                `ALTER TABLE "${dbSchema}"."${first.table_name}"
                 ADD CONSTRAINT "${first.constraint_name}" ${body.checkDefs[first.constraint_name]}`,
              );
            }
            await trx.raw('RELEASE SAVEPOINT con_sp');
          } catch {
            await trx.raw('ROLLBACK TO SAVEPOINT con_sp').catch(() => {});
          }
        }
      }

      if (body.version === 2 && body.systemTables) {
        for (const sysTable of SYSTEM_TABLES_TO_BACKUP) {
          const rows = body.systemTables[sysTable];
          if (!rows || rows.length === 0) continue;

          try {
            await trx.raw('SAVEPOINT sys_sp');
            await trx(sysTable).where({ project_id: projectId }).del();
            const batchSize = 500;
            for (let i = 0; i < rows.length; i += batchSize) {
              const batch = rows.slice(i, i + batchSize).map((row: Record<string, unknown>) => {
                const fixed: Record<string, unknown> = {};
                for (const [k, v] of Object.entries(row)) {
                  fixed[k] = (v !== null && typeof v === 'object') ? JSON.stringify(v) : v;
                }
                return fixed;
              });
              await trx(sysTable).insert(batch);
            }
            await trx.raw('RELEASE SAVEPOINT sys_sp');
          } catch {
            await trx.raw('ROLLBACK TO SAVEPOINT sys_sp').catch(() => {});
          }
        }
      }
    });

    return { success: true };
  });
}
