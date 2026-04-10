import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Enable uuid extension
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');

  // Projects (minimal — synced from CP)
  await knex.schema.createTable('projects', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('slug', 255).unique().notNullable();
    table.string('db_schema', 255).notNullable();
    table.jsonb('settings').defaultTo('{}');
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  // API endpoints
  await knex.schema.createTable('api_endpoints', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('project_id').references('id').inTable('projects').onDelete('CASCADE');
    table.string('method', 10).notNullable();
    table.string('path', 500).notNullable();
    table.text('description');
    table.specificType('tags', 'text[]');
    table.string('source_type', 20).notNullable().checkIn(['table', 'custom_sql', 'composite']);
    table.jsonb('source_config').notNullable();
    table.jsonb('validation_schema');
    table.jsonb('response_config');
    table.boolean('cache_enabled').defaultTo(false);
    table.integer('cache_ttl').defaultTo(60);
    table.string('cache_key_template', 500);
    table.jsonb('rate_limit');
    table.string('auth_type', 20).defaultTo('api_token').checkIn(['public', 'api_token', 'session']);
    table.jsonb('middleware').defaultTo('[]');
    table.boolean('is_active').defaultTo(true);
    table.uuid('created_by');
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
    table.unique(['project_id', 'method', 'path']);
  });

  // Webhooks
  await knex.schema.createTable('webhooks', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('project_id').references('id').inTable('projects').onDelete('CASCADE');
    table.string('name', 255);
    table.string('table_name', 255).notNullable();
    table.specificType('events', 'text[]').notNullable();
    table.string('url', 2000).notNullable();
    table.string('method', 10).defaultTo('POST');
    table.jsonb('headers').defaultTo('{}');
    table.jsonb('payload_template');
    table.string('secret', 255);
    table.integer('retry_count').defaultTo(3);
    table.boolean('is_active').defaultTo(true);
    table.uuid('created_by');
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  // Webhook logs
  await knex.schema.createTable('webhook_logs', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('webhook_id').references('id').inTable('webhooks').onDelete('CASCADE');
    table.string('event', 20).notNullable();
    table.jsonb('payload');
    table.integer('response_status');
    table.text('response_body');
    table.integer('attempt').defaultTo(1);
    table.timestamp('sent_at', { useTz: true }).defaultTo(knex.fn.now());
    table.integer('duration_ms');
  });

  // Saved queries
  await knex.schema.createTable('saved_queries', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('project_id').references('id').inTable('projects').onDelete('CASCADE');
    table.uuid('user_id');
    table.string('name', 255).notNullable();
    table.text('query').notNullable();
    table.text('description');
    table.boolean('is_shared').defaultTo(false);
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  // Data history
  await knex.schema.createTable('data_history', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('schema_name', 255).notNullable();
    table.string('table_name', 255).notNullable();
    table.string('record_id', 255).notNullable();
    table.string('operation', 10).notNullable().checkIn(['INSERT', 'UPDATE', 'DELETE']);
    table.jsonb('old_data');
    table.jsonb('new_data');
    table.uuid('changed_by');
    table.timestamp('changed_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  // Indexes for data_history
  await knex.raw('CREATE INDEX idx_data_history_lookup ON data_history(schema_name, table_name, record_id, changed_at DESC)');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('data_history');
  await knex.schema.dropTableIfExists('saved_queries');
  await knex.schema.dropTableIfExists('webhook_logs');
  await knex.schema.dropTableIfExists('webhooks');
  await knex.schema.dropTableIfExists('api_endpoints');
  await knex.schema.dropTableIfExists('projects');
}
