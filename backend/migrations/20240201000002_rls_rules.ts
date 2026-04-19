import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('rls_rules', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('project_id').notNullable();
    table.varchar('table_name', 255).notNullable();
    table.varchar('column_name', 255).notNullable();
    table.varchar('operator', 20).notNullable();
    table.varchar('value_source', 50).notNullable();
    table.text('value_static').nullable();
    table.boolean('is_active').defaultTo(true);
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('rls_rules');
}
