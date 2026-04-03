import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Create nodes table
  await knex.schema.createTable('nodes', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('name', 255).notNullable();
    table.string('slug', 255).unique().notNullable();
    table.string('url', 2000).notNullable();
    table.string('region', 100).defaultTo('default');
    table.string('status', 20).defaultTo('offline');
    table.boolean('is_local').defaultTo(false);
    table.integer('max_projects').defaultTo(50);
    table.float('cpu_usage').defaultTo(0);
    table.float('ram_usage').defaultTo(0);
    table.float('disk_usage').defaultTo(0);
    table.timestamp('last_heartbeat', { useTz: true });
    table.string('api_key_hash', 255);
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  // Add node_id to projects (NULL = no node assigned yet)
  await knex.schema.alterTable('projects', (table) => {
    table.uuid('node_id').references('id').inTable('nodes').onDelete('SET NULL');
  });
}

export async function down(knex: Knex): Promise<void> {
  // Remove node_id from projects
  await knex.schema.alterTable('projects', (table) => {
    table.dropColumn('node_id');
  });

  // Drop nodes table
  await knex.schema.dropTableIfExists('nodes');
}
