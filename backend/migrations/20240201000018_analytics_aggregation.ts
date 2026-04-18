import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('api_request_stats', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('project_id').notNullable();
    table.varchar('method', 10).notNullable();
    table.text('path').notNullable();
    table.integer('status_group').notNullable();
    table.timestamp('hour', { useTz: true }).notNullable();
    table.integer('total_count').notNullable().defaultTo(0);
    table.integer('error_count').notNullable().defaultTo(0);
    table.bigInteger('total_response_time_ms').notNullable().defaultTo(0);
    table.integer('max_response_time_ms').notNullable().defaultTo(0);
    table.integer('cache_hits').notNullable().defaultTo(0);
    table.integer('cache_misses').notNullable().defaultTo(0);
    table.specificType('unique_ips', 'text[]').defaultTo('{}');
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());

    table.unique(['project_id', 'method', 'path', 'status_group', 'hour']);
    table.index(['project_id', 'hour']);
    table.index(['hour']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('api_request_stats');
}
