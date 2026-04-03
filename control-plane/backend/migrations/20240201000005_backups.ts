import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('backups', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('project_id').references('id').inTable('projects').onDelete('CASCADE');
    table.varchar('type', 20).notNullable(); // 'manual' | 'scheduled'
    table.varchar('status', 20).notNullable().defaultTo('pending'); // 'pending' | 'running' | 'completed' | 'failed'
    table.text('file_path');
    table.bigInteger('file_size');
    table.varchar('encryption_key_hash', 255);
    table.text('error');
    table.uuid('created_by').references('id').inTable('users');
    table.timestamp('started_at', { useTz: true });
    table.timestamp('completed_at', { useTz: true });
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('backup_schedules', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('project_id').references('id').inTable('projects').onDelete('CASCADE').unique();
    table.varchar('cron_expression', 100);
    table.boolean('is_active').defaultTo(true);
    table.integer('max_backups').defaultTo(5);
    table.timestamp('last_run_at', { useTz: true });
    table.timestamp('next_run_at', { useTz: true });
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('backup_schedules');
  await knex.schema.dropTableIfExists('backups');
}
