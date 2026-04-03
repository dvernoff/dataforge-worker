import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Default quotas (single row)
  await knex.schema.createTable('default_quotas', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.integer('max_projects').defaultTo(5);
    table.integer('max_tables').defaultTo(20);
    table.integer('max_records').defaultTo(100000);
    table.integer('max_api_requests').defaultTo(10000);
    table.integer('max_storage_mb').defaultTo(1000);
    table.integer('max_endpoints').defaultTo(50);
    table.integer('max_webhooks').defaultTo(20);
    table.integer('max_files').defaultTo(500);
    table.integer('max_backups').defaultTo(10);
    table.integer('max_cron').defaultTo(10);
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  // Per-user quota overrides
  await knex.schema.createTable('user_quotas', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').references('id').inTable('users').onDelete('CASCADE').unique().notNullable();
    table.integer('max_projects').defaultTo(5);
    table.integer('max_tables').defaultTo(20);
    table.integer('max_records').defaultTo(100000);
    table.integer('max_api_requests').defaultTo(10000);
    table.integer('max_storage_mb').defaultTo(1000);
    table.integer('max_endpoints').defaultTo(50);
    table.integer('max_webhooks').defaultTo(20);
    table.integer('max_files').defaultTo(500);
    table.integer('max_backups').defaultTo(10);
    table.integer('max_cron').defaultTo(10);
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  // Seed one default row
  await knex('default_quotas').insert({});
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('user_quotas');
  await knex.schema.dropTableIfExists('default_quotas');
}
