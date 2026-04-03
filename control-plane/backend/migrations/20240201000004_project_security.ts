import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('project_security', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('project_id').references('id').inTable('projects').onDelete('CASCADE').unique();
    table.specificType('ip_whitelist', 'TEXT[]').defaultTo('{}');
    table.specificType('ip_blacklist', 'TEXT[]').defaultTo('{}');
    table.varchar('ip_mode', 20).defaultTo('disabled');
    table.specificType('geo_countries', 'TEXT[]').defaultTo('{}');
    table.varchar('geo_mode', 20).defaultTo('disabled');
    table.boolean('apply_to_ui').defaultTo(false);
    table.boolean('apply_to_api').defaultTo(true);
    table.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('project_security');
}
