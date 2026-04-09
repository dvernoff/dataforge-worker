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

function resolveProjectSchema(request: any): string {
  const schema = request.projectSchema;
  if (!schema || !SAFE_NAME_RE.test(schema)) throw new AppError(400, 'Invalid project schema');
  return schema;
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

    const tablesResult = await app.db.raw(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = ? AND table_type = 'BASE TABLE'
       AND table_name NOT LIKE '__history_%'
       ORDER BY table_name`,
      [dbSchema],
    );

    const tableNames: string[] = tablesResult.rows.map((r: any) => r.table_name);
    const data: Record<string, unknown[]> = {};
    const schema: Record<string, { name: string; type: string; nullable: boolean }[]> = {};

    for (const table of tableNames) {
      if (!validateName(table)) continue;
      const rows = await app.db.raw(`SELECT * FROM "${dbSchema}"."${table}"`);
      data[table] = rows.rows;

      const cols = await app.db.raw(
        `SELECT column_name as name, data_type as type, is_nullable = 'YES' as nullable
         FROM information_schema.columns
         WHERE table_schema = ? AND table_name = ?
         ORDER BY ordinal_position`,
        [dbSchema, table],
      );
      schema[table] = cols.rows;
    }

    return { tables: tableNames, schema, data, exportedAt: new Date().toISOString() };
  });

  app.post('/:projectId/backups/restore-data', { bodyLimit: 100 * 1024 * 1024 }, async (request) => {
    const dbSchema = resolveProjectSchema(request);
    const body = request.body as {
      data: Record<string, any[]>;
      schema?: Record<string, { name: string; type: string; nullable: boolean }[]>;
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
            return `"${c.name}" ${safeType}${nullable}`;
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
    });

    return { success: true };
  });
}
