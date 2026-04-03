import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('tracked_errors', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('project_id').nullable();
    table.uuid('node_id').nullable();
    table.varchar('source', 50).notNullable(); // 'api' | 'webhook' | 'cron' | 'node' | 'system'
    table.varchar('severity', 20).notNullable(); // 'error' | 'warning' | 'critical'
    table.varchar('title', 500).notNullable();
    table.text('message');
    table.text('stack_trace');
    table.jsonb('metadata');
    table.varchar('status', 20).notNullable().defaultTo('open'); // 'open' | 'acknowledged' | 'resolved'
    table.uuid('acknowledged_by').nullable().references('id').inTable('users');
    table.timestamp('resolved_at', { useTz: true }).nullable();
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('tracked_errors');
}
