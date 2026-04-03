import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('webhooks', (table) => {
    table.string('name', 255).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('webhooks', (table) => {
    table.dropColumn('name');
  });
}
