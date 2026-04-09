import type { Knex } from 'knex';

async function tableHasColumn(knex: Knex, table: string, column: string): Promise<boolean> {
  const result = await knex.raw(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ? AND column_name = ? LIMIT 1`,
    [table, column]
  );
  return (result.rows?.length ?? 0) > 0;
}

async function tableExists(knex: Knex, table: string): Promise<boolean> {
  const result = await knex.raw(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ? LIMIT 1`,
    [table]
  );
  return (result.rows?.length ?? 0) > 0;
}

export async function up(knex: Knex): Promise<void> {
  if (await tableExists(knex, 'api_request_logs')) {
    await knex.raw(`CREATE INDEX IF NOT EXISTS idx_api_request_logs_project_created ON api_request_logs(project_id, created_at DESC)`);
    await knex.raw(`CREATE INDEX IF NOT EXISTS idx_api_request_logs_project_status ON api_request_logs(project_id, status_code, created_at DESC)`);
  }
  if (await tableExists(knex, 'validation_rules') && await tableHasColumn(knex, 'validation_rules', 'is_active')) {
    await knex.raw(`CREATE INDEX IF NOT EXISTS idx_validation_rules_lookup ON validation_rules(project_id, table_name) WHERE is_active = true`);
  }
  if (await tableExists(knex, 'rls_rules') && await tableHasColumn(knex, 'rls_rules', 'is_active')) {
    await knex.raw(`CREATE INDEX IF NOT EXISTS idx_rls_rules_lookup ON rls_rules(project_id, table_name) WHERE is_active = true`);
  }
  if (await tableExists(knex, 'webhooks')) {
    await knex.raw(`CREATE INDEX IF NOT EXISTS idx_webhooks_project_active ON webhooks(project_id, is_active)`);
  }
  if (await tableExists(knex, 'webhook_logs')) {
    await knex.raw(`CREATE INDEX IF NOT EXISTS idx_webhook_logs_webhook_id ON webhook_logs(webhook_id, sent_at DESC)`);
  }
  if (await tableExists(knex, 'api_endpoints') && await tableHasColumn(knex, 'api_endpoints', 'version')) {
    await knex.raw(`CREATE INDEX IF NOT EXISTS idx_api_endpoints_project_method ON api_endpoints(project_id, method, is_active, version)`);
  }
  if (await tableExists(knex, 'cron_jobs')) {
    await knex.raw(`CREATE INDEX IF NOT EXISTS idx_cron_jobs_project_active ON cron_jobs(project_id, is_active)`);
  }
  if (await tableExists(knex, 'data_history') && await tableHasColumn(knex, 'data_history', 'project_id')) {
    await knex.raw(`CREATE INDEX IF NOT EXISTS idx_data_history_project_table ON data_history(project_id, table_name, created_at DESC)`);
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP INDEX IF EXISTS idx_api_request_logs_project_created`);
  await knex.raw(`DROP INDEX IF EXISTS idx_api_request_logs_project_status`);
  await knex.raw(`DROP INDEX IF EXISTS idx_validation_rules_lookup`);
  await knex.raw(`DROP INDEX IF EXISTS idx_rls_rules_lookup`);
  await knex.raw(`DROP INDEX IF EXISTS idx_webhooks_project_active`);
  await knex.raw(`DROP INDEX IF EXISTS idx_webhook_logs_webhook_id`);
  await knex.raw(`DROP INDEX IF EXISTS idx_api_endpoints_project_method`);
  await knex.raw(`DROP INDEX IF EXISTS idx_cron_jobs_project_active`);
  await knex.raw(`DROP INDEX IF EXISTS idx_data_history_project_table`);
}
