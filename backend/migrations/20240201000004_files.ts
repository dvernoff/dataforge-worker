import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('files', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('project_id').notNullable();
    table.string('table_name', 255).notNullable();
    table.uuid('record_id').notNullable();
    table.string('column_name', 255).notNullable();
    table.string('original_name', 500).notNullable();
    table.string('mime_type', 100).notNullable();
    table.bigInteger('size').notNullable();
    table.text('storage_path').notNullable();
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  await knex.raw('CREATE INDEX idx_files_lookup ON files(project_id, table_name, record_id)');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('files');
}
