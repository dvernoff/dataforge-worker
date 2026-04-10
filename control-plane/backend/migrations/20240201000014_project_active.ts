import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('projects', (table) => {
    table.boolean('is_active').defaultTo(true);
    table.text('disabled_reason').nullable();
    table.timestamp('disabled_at', { useTz: true }).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('projects', (table) => {
    table.dropColumn('is_active');
    table.dropColumn('disabled_reason');
    table.dropColumn('disabled_at');
  });
}
