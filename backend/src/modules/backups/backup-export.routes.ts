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
  'rls_rules',
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
            const batch = rows.slice(i, i + batchSize);
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
              const batch = rows.slice(i, i + batchSize);
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
