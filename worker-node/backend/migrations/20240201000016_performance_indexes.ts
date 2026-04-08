import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_api_request_logs_project_created ON api_request_logs(project_id, created_at DESC)`);
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_api_request_logs_project_status ON api_request_logs(project_id, status_code, created_at DESC)`);
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_validation_rules_lookup ON validation_rules(project_id, table_name) WHERE is_active = true`);
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_rls_rules_lookup ON rls_rules(project_id, table_name) WHERE is_active = true`);
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_webhooks_project_active ON webhooks(project_id, is_active)`);
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_webhook_logs_webhook_id ON webhook_logs(webhook_id, sent_at DESC)`);
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_api_endpoints_project_method ON api_endpoints(project_id, method, is_active, version)`);
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_cron_jobs_project_active ON cron_jobs(project_id, is_active)`);
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_data_history_project_table ON data_history(project_id, table_name, created_at DESC)`);
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
