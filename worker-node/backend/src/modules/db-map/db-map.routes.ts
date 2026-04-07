import type { FastifyInstance } from 'fastify';
import { nodeAuthMiddleware } from '../../middleware/node-auth.middleware.js';
import { requireWorkerRole } from '../../middleware/worker-rbac.middleware.js';
import { AppError } from '../../middleware/error-handler.js';

function resolveProjectSchema(request: any): string {
  const schema = request.projectSchema;
  if (!schema) throw new AppError(400, 'Missing project schema header');
  return schema;
}

export async function dbMapRoutes(app: FastifyInstance) {
  app.addHook('preHandler', nodeAuthMiddleware);
  app.addHook('preHandler', requireWorkerRole('viewer'));

  app.get('/:projectId/db-map', async (request) => {
    const dbSchema = resolveProjectSchema(request);

    const tablesResult = await app.db.raw(`
      SELECT
        t.table_name,
        (SELECT json_agg(json_build_object(
          'name', c.column_name,
          'type', c.data_type,
          'nullable', c.is_nullable = 'YES'
        ) ORDER BY c.ordinal_position)
         FROM information_schema.columns c
         WHERE c.table_schema = t.table_schema AND c.table_name = t.table_name
        ) as columns,
        (SELECT n_live_tup FROM pg_stat_user_tables
         WHERE schemaname = t.table_schema AND relname = t.table_name
        ) as row_count
      FROM information_schema.tables t
      WHERE t.table_schema = ? AND t.table_type = 'BASE TABLE'
        AND t.table_name NOT LIKE '__history_%'
      ORDER BY t.table_name
    `, [dbSchema]);

    const fksResult = await app.db.raw(`
      SELECT
        tc.table_name as source_table,
        kcu.column_name as source_column,
        ccu.table_name as target_table,
        ccu.column_name as target_column,
        tc.constraint_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = ?
    `, [dbSchema]);

    const tables = (tablesResult.rows ?? []).map((t: any) => ({
      name: t.table_name,
      columns: t.columns ?? [],
      rowCount: Number(t.row_count ?? 0),
    }));

    const relationships = (fksResult.rows ?? []).map((fk: any) => ({
      sourceTable: fk.source_table,
      sourceColumn: fk.source_column,
      targetTable: fk.target_table,
      targetColumn: fk.target_column,
      constraintName: fk.constraint_name,
    }));

    return { tables, relationships };
  });
}
