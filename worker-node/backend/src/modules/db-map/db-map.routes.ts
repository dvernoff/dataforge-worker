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
          'nullable', c.is_nullable = 'YES',
          'default', c.column_default,
          'maxLength', c.character_maximum_length
        ) ORDER BY c.ordinal_position)
         FROM information_schema.columns c
         WHERE c.table_schema = t.table_schema AND c.table_name = t.table_name
        ) as columns,
        COALESCE(
          (SELECT GREATEST(cl.reltuples::bigint, 0)
           FROM pg_class cl
           JOIN pg_namespace ns ON ns.oid = cl.relnamespace
           WHERE ns.nspname = t.table_schema AND cl.relname = t.table_name),
          0
        ) as row_count,
        (SELECT pg_total_relation_size(quote_ident(t.table_schema) || '.' || quote_ident(t.table_name))) as total_size,
        (SELECT json_agg(kcu.column_name ORDER BY kcu.ordinal_position)
         FROM information_schema.table_constraints tc2
         JOIN information_schema.key_column_usage kcu
           ON tc2.constraint_name = kcu.constraint_name
           AND tc2.table_schema = kcu.table_schema
         WHERE tc2.table_schema = t.table_schema
           AND tc2.table_name = t.table_name
           AND tc2.constraint_type = 'PRIMARY KEY'
        ) as primary_keys,
        (SELECT json_agg(sub)
         FROM (
           SELECT DISTINCT ON (ix.indexname)
             json_build_object(
               'name', ix.indexname,
               'definition', ix.indexdef,
               'isUnique', i.indisunique
             ) as sub
           FROM pg_indexes ix
           JOIN pg_class cl ON cl.relname = ix.indexname
           JOIN pg_index i ON i.indexrelid = cl.oid
           WHERE ix.schemaname = t.table_schema AND ix.tablename = t.table_name
             AND NOT i.indisprimary
         ) idx_sub
        ) as indexes
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
      totalSize: Number(t.total_size ?? 0),
      primaryKeys: t.primary_keys ?? [],
      indexes: t.indexes ?? [],
    }));

    let needsCount = tables.filter((t: any) => t.rowCount <= 0);
    if (needsCount.length > 0 && needsCount.length <= 50) {
      for (const table of needsCount) {
        try {
          const countResult = await app.db.raw(
            `SELECT COUNT(*)::int as cnt FROM ${app.db.client.config.client === 'pg' ? `"${dbSchema}"."${table.name}"` : `\`${dbSchema}\`.\`${table.name}\``}`
          );
          table.rowCount = Number(countResult.rows?.[0]?.cnt ?? 0);
        } catch {
        }
      }
    }

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
