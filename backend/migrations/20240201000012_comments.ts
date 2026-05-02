import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('record_comments', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('project_id').notNullable();
    table.varchar('table_name', 255).notNullable();
    table.uuid('record_id').notNullable();
    table.varchar('user_id', 255).notNullable();
    table.varchar('user_name', 255).notNullable();
    table.text('content').notNullable();
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());

    table.index(['project_id', 'table_name', 'record_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('record_comments');
}
