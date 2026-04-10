import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('schema_versions', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('project_id').notNullable();
    table.integer('version').notNullable();
    table.string('description', 500).notNullable();
    table.jsonb('diff').notNullable().defaultTo('{}');
    table.jsonb('full_schema').notNullable().defaultTo('{}');
    table.string('created_by', 255).notNullable();
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  await knex.raw('CREATE INDEX idx_schema_versions_project ON schema_versions(project_id, version DESC)');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('schema_versions');
}
