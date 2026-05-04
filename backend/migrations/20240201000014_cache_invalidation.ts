import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('api_endpoints', (t) => {
    t.jsonb('cache_invalidation').nullable().defaultTo(null);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('api_endpoints', (t) => {
    t.dropColumn('cache_invalidation');
  });
}
