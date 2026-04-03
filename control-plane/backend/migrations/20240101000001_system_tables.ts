import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Enable uuid extension
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');

  // Users
  await knex.schema.createTable('users', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('email', 255).unique().notNullable();
    table.string('password_hash', 255).notNullable();
    table.string('name', 255).notNullable();
    table.boolean('is_superadmin').defaultTo(false);
    table.boolean('is_active').defaultTo(true);
    table.timestamp('last_login_at', { useTz: true });
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  // Projects
  await knex.schema.createTable('projects', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('name', 255).notNullable();
    table.string('slug', 255).unique().notNullable();
    table.text('description');
    table.string('db_schema', 63).unique().notNullable();
    table.jsonb('settings').defaultTo('{}');
    table.uuid('created_by').references('id').inTable('users');
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  // Project members
  await knex.schema.createTable('project_members', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('project_id').references('id').inTable('projects').onDelete('CASCADE').notNullable();
    table.uuid('user_id').references('id').inTable('users').onDelete('CASCADE').notNullable();
    table.string('role', 20).notNullable().checkIn(['admin', 'editor', 'viewer']);
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.unique(['project_id', 'user_id']);
  });

  // Invite keys
  await knex.schema.createTable('invite_keys', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('key', 64).unique().notNullable();
    table.uuid('created_by').references('id').inTable('users');
    table.string('role', 20).defaultTo('viewer').checkIn(['admin', 'editor', 'viewer']);
    table.integer('max_uses').defaultTo(1);
    table.integer('current_uses').defaultTo(0);
    table.timestamp('expires_at', { useTz: true });
    table.uuid('project_id').references('id').inTable('projects').onDelete('CASCADE');
    table.boolean('is_active').defaultTo(true);
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  // API tokens
  await knex.schema.createTable('api_tokens', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('project_id').references('id').inTable('projects').onDelete('CASCADE');
    table.uuid('user_id').references('id').inTable('users');
    table.string('name', 255).notNullable();
    table.string('token_hash', 255).notNullable();
    table.string('prefix', 12).notNullable();
    table.jsonb('scopes').defaultTo('["read"]');
    table.specificType('allowed_ips', 'text[]');
    table.boolean('is_active').defaultTo(true);
    table.timestamp('expires_at', { useTz: true });
    table.timestamp('last_used_at', { useTz: true });
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  // Refresh tokens
  await knex.schema.createTable('refresh_tokens', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').references('id').inTable('users').onDelete('CASCADE').notNullable();
    table.string('token_hash', 255).notNullable();
    table.timestamp('expires_at', { useTz: true }).notNullable();
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
    table.uuid('created_by').references('id').inTable('users');
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
    table.unique(['project_id', 'method', 'path']);
  });

  // Webhooks
  await knex.schema.createTable('webhooks', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('project_id').references('id').inTable('projects').onDelete('CASCADE');
    table.string('table_name', 255).notNullable();
    table.specificType('events', 'text[]').notNullable();
    table.string('url', 2000).notNullable();
    table.string('method', 10).defaultTo('POST');
    table.jsonb('headers').defaultTo('{}');
    table.jsonb('payload_template');
    table.string('secret', 255);
    table.integer('retry_count').defaultTo(3);
    table.boolean('is_active').defaultTo(true);
    table.uuid('created_by').references('id').inTable('users');
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

  // Audit logs
  await knex.schema.createTable('audit_logs', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('project_id');
    table.uuid('user_id');
    table.string('user_email', 255);
    table.boolean('is_superadmin_action').defaultTo(false);
    table.string('action', 100).notNullable();
    table.string('resource_type', 50);
    table.string('resource_id', 255);
    table.jsonb('details');
    table.specificType('ip_address', 'inet');
    table.text('user_agent');
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  // Audit log indexes
  await knex.raw('CREATE INDEX idx_audit_logs_project ON audit_logs(project_id, created_at DESC)');
  await knex.raw('CREATE INDEX idx_audit_logs_user ON audit_logs(user_id, created_at DESC)');
  await knex.raw('CREATE INDEX idx_audit_logs_action ON audit_logs(action)');

  // Saved queries
  await knex.schema.createTable('saved_queries', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('project_id').references('id').inTable('projects').onDelete('CASCADE');
    table.uuid('user_id').references('id').inTable('users');
    table.string('name', 255).notNullable();
    table.text('query').notNullable();
    table.text('description');
    table.boolean('is_shared').defaultTo(false);
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('saved_queries');
  await knex.schema.dropTableIfExists('audit_logs');
  await knex.schema.dropTableIfExists('webhook_logs');
  await knex.schema.dropTableIfExists('webhooks');
  await knex.schema.dropTableIfExists('api_endpoints');
  await knex.schema.dropTableIfExists('refresh_tokens');
  await knex.schema.dropTableIfExists('api_tokens');
  await knex.schema.dropTableIfExists('invite_keys');
  await knex.schema.dropTableIfExists('project_members');
  await knex.schema.dropTableIfExists('projects');
  await knex.schema.dropTableIfExists('users');
}
