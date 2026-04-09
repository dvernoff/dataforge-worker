import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('cron_jobs', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('project_id');
    table.varchar('name', 255).notNullable();
    table.varchar('cron_expression', 100).notNullable();
    table.varchar('action_type', 50).notNullable(); // sql, api_call, webhook
    table.jsonb('action_config').defaultTo('{}');
    table.boolean('is_active').defaultTo(true);
    table.timestamp('last_run_at', { useTz: true });
    table.timestamp('next_run_at', { useTz: true });
    table.varchar('last_status', 20);
    table.text('last_error');
    table.integer('run_count').defaultTo(0);
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());

    table.index(['project_id']);
  });

  await knex.schema.createTable('cron_job_runs', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('cron_job_id').references('id').inTable('cron_jobs').onDelete('CASCADE');
    table.varchar('status', 20).notNullable(); // success, failed, running
    table.timestamp('started_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('completed_at', { useTz: true });
    table.jsonb('result');
    table.text('error');

    table.index(['cron_job_id', 'started_at']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('cron_job_runs');
  await knex.schema.dropTableIfExists('cron_jobs');
}
