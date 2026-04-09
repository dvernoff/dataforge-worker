import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('api_request_logs', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('project_id');
    table.uuid('endpoint_id');
    table.varchar('method', 10);
    table.text('path');
    table.integer('status_code');
    table.integer('response_time_ms');
    table.varchar('ip_address', 45);
    table.text('user_agent');
    table.text('error');
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());

    table.index(['project_id', 'created_at']);
    table.index(['created_at']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('api_request_logs');
}
