import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const has = await knex.schema.hasColumn('api_request_logs', 'cache_status');
  if (!has) {
    await knex.schema.alterTable('api_request_logs', (t) => {
      t.varchar('cache_status', 10).nullable();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('api_request_logs', (t) => {
    t.dropColumn('cache_status');
  });
}
