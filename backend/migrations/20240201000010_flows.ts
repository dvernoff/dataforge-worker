import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('flows', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('project_id');
    table.varchar('name', 255).notNullable();
    table.text('description');
    table.varchar('trigger_type', 50).notNullable(); // manual, data_change, webhook, cron, api_call
    table.jsonb('trigger_config').defaultTo('{}');
    table.jsonb('nodes').defaultTo('[]');
    table.jsonb('edges').defaultTo('[]');
    table.boolean('is_active').defaultTo(true);
    table.integer('run_count').defaultTo(0);
    table.timestamp('last_run_at', { useTz: true });
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());

    table.index(['project_id']);
  });

  await knex.schema.createTable('flow_runs', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('flow_id').references('id').inTable('flows').onDelete('CASCADE');
    table.varchar('status', 20).notNullable();
    table.jsonb('trigger_data');
    table.jsonb('node_results');
    table.timestamp('started_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('completed_at', { useTz: true });
    table.text('error');

    table.index(['flow_id', 'started_at']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('flow_runs');
  await knex.schema.dropTableIfExists('flows');
}
