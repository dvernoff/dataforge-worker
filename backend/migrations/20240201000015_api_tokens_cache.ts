import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('api_tokens_cache', (t) => {
    t.string('token_hash', 128).primary();
    t.uuid('project_id').notNullable().index();
    t.jsonb('scopes').notNullable().defaultTo('["read"]');
    t.jsonb('allowed_ips').notNullable().defaultTo('[]');
    t.timestamp('expires_at').nullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('api_tokens_cache');
}
