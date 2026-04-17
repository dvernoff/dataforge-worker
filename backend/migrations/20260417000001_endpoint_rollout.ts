import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('api_endpoints', (t) => {
    t.jsonb('rollout').nullable();
    t.jsonb('deprecates').nullable();
    t.timestamp('sunset_at', { useTz: true }).nullable();
  });
  await knex.schema.raw(`ALTER TABLE api_endpoints DROP CONSTRAINT IF EXISTS api_endpoints_project_id_method_path_unique`);
  await knex.schema.raw(`CREATE UNIQUE INDEX IF NOT EXISTS api_endpoints_project_method_path_version_unique ON api_endpoints (project_id, method, path, version) WHERE deprecated_at IS NULL`);
  await knex.schema.raw(`CREATE INDEX IF NOT EXISTS idx_api_endpoints_method_path_active ON api_endpoints (method, path, is_active) WHERE deprecated_at IS NULL`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('api_endpoints', (t) => {
    t.dropColumn('rollout');
    t.dropColumn('deprecates');
    t.dropColumn('sunset_at');
  });
  await knex.schema.raw(`DROP INDEX IF EXISTS api_endpoints_project_method_path_version_unique`);
  await knex.schema.raw(`DROP INDEX IF EXISTS idx_api_endpoints_method_path_active`);
}
