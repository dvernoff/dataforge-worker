import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('api_endpoints', (table) => {
    table.integer('version').notNullable().defaultTo(1);
    table.timestamp('deprecated_at', { useTz: true }).nullable();
  });

  await knex.raw('CREATE INDEX idx_api_endpoints_version ON api_endpoints(project_id, path, version)');
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS idx_api_endpoints_version');
  await knex.schema.alterTable('api_endpoints', (table) => {
    table.dropColumn('version');
    table.dropColumn('deprecated_at');
  });
}
