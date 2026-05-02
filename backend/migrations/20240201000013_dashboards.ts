import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('custom_dashboards', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('project_id').notNullable();
    table.varchar('name', 255).notNullable();
    table.text('description').nullable();
    table.jsonb('widgets').defaultTo('[]');
    table.jsonb('layout').defaultTo('{}');
    table.boolean('is_public').defaultTo(false);
    table.varchar('public_slug', 100).unique().nullable();
    table.varchar('created_by', 255);
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());

    table.index(['project_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('custom_dashboards');
}
