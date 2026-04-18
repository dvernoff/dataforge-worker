import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasCol = await knex.schema.hasColumn('api_endpoints', 'required_scopes');
  if (!hasCol) {
    await knex.schema.alterTable('api_endpoints', (t) => {
      t.jsonb('required_scopes').notNullable().defaultTo('[]');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasCol = await knex.schema.hasColumn('api_endpoints', 'required_scopes');
  if (hasCol) {
    await knex.schema.alterTable('api_endpoints', (t) => {
      t.dropColumn('required_scopes');
    });
  }
}
