import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('project_plans', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('name', 100).notNullable().unique();
    table.string('color', 7).defaultTo('#6B7280');
    table.text('description').nullable();
    table.integer('max_tables').defaultTo(20);
    table.integer('max_records').defaultTo(100000);
    table.integer('max_api_requests').defaultTo(10000);
    table.integer('max_storage_mb').defaultTo(1000);
    table.integer('max_endpoints').defaultTo(50);
    table.integer('max_webhooks').defaultTo(20);
    table.integer('max_files').defaultTo(500);
    table.integer('max_backups').defaultTo(10);
    table.integer('max_cron').defaultTo(10);
    table.integer('max_query_timeout_ms').defaultTo(30000);
    table.integer('max_concurrent_requests').defaultTo(10);
    table.integer('max_rows_per_query').defaultTo(1000);
    table.integer('max_export_rows').defaultTo(10000);
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('project_quotas', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE');
    table.unique(['project_id']);
    table.integer('max_tables').defaultTo(20);
    table.integer('max_records').defaultTo(100000);
    table.integer('max_api_requests').defaultTo(10000);
    table.integer('max_storage_mb').defaultTo(1000);
    table.integer('max_endpoints').defaultTo(50);
    table.integer('max_webhooks').defaultTo(20);
    table.integer('max_files').defaultTo(500);
    table.integer('max_backups').defaultTo(10);
    table.integer('max_cron').defaultTo(10);
    table.integer('max_query_timeout_ms').defaultTo(30000);
    table.integer('max_concurrent_requests').defaultTo(10);
    table.integer('max_rows_per_query').defaultTo(1000);
    table.integer('max_export_rows').defaultTo(10000);
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  await knex.schema.alterTable('projects', (table) => {
    table.uuid('plan_id').nullable().references('id').inTable('project_plans').onDelete('SET NULL');
  });

  const [plan] = await knex('project_plans').insert({
    name: 'Basic',
    color: '#3B82F6',
    description: 'Default plan for new projects',
  }).returning('id');

  if (plan) {
    await knex.raw(`
      UPDATE projects SET plan_id = ?
      WHERE node_id IN (SELECT id FROM nodes WHERE owner_id IS NULL)
         OR node_id IS NULL
    `, [plan.id]);
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('projects', (table) => {
    table.dropColumn('plan_id');
  });
  await knex.schema.dropTableIfExists('project_quotas');
  await knex.schema.dropTableIfExists('project_plans');
}
