import type { Knex } from 'knex';

const NEW_QUOTA_COLUMNS = {
  max_query_timeout_ms: 30000,      // 30s default
  max_concurrent_requests: 10,       // 10 concurrent requests
  max_rows_per_query: 1000,          // 1000 rows per SELECT
  max_export_rows: 10000,            // 10000 rows per export
} as const;

export async function up(knex: Knex): Promise<void> {
  // Add to default_quotas
  const hasCol = await knex.schema.hasColumn('default_quotas', 'max_query_timeout_ms');
  if (!hasCol) {
    await knex.schema.alterTable('default_quotas', (t) => {
      for (const [col, def] of Object.entries(NEW_QUOTA_COLUMNS)) {
        t.integer(col).defaultTo(def);
      }
    });
  }

  // Add to user_quotas
  const hasCol2 = await knex.schema.hasColumn('user_quotas', 'max_query_timeout_ms');
  if (!hasCol2) {
    await knex.schema.alterTable('user_quotas', (t) => {
      for (const [col, def] of Object.entries(NEW_QUOTA_COLUMNS)) {
        t.integer(col).defaultTo(def);
      }
    });
  }

  // Add to custom_roles (if table exists)
  const hasRoles = await knex.schema.hasTable('custom_roles');
  if (hasRoles) {
    const hasCol3 = await knex.schema.hasColumn('custom_roles', 'max_query_timeout_ms');
    if (!hasCol3) {
      await knex.schema.alterTable('custom_roles', (t) => {
        for (const [col, def] of Object.entries(NEW_QUOTA_COLUMNS)) {
          t.integer(col).defaultTo(def);
        }
      });
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  const cols = Object.keys(NEW_QUOTA_COLUMNS);

  for (const table of ['default_quotas', 'user_quotas']) {
    await knex.schema.alterTable(table, (t) => {
      for (const col of cols) t.dropColumn(col);
    });
  }

  const hasRoles = await knex.schema.hasTable('custom_roles');
  if (hasRoles) {
    await knex.schema.alterTable('custom_roles', (t) => {
      for (const col of cols) t.dropColumn(col);
    });
  }
}
