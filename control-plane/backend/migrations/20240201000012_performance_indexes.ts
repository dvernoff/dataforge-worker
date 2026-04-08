import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_project_members_user_project ON project_members(user_id, project_id)`);
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_project_members_project_role ON project_members(project_id, role)`);
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_projects_node_id ON projects(node_id)`);
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_audit_logs_project_created ON audit_logs(project_id, created_at DESC)`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP INDEX IF EXISTS idx_project_members_user_project`);
  await knex.raw(`DROP INDEX IF EXISTS idx_project_members_project_role`);
  await knex.raw(`DROP INDEX IF EXISTS idx_projects_node_id`);
  await knex.raw(`DROP INDEX IF EXISTS idx_audit_logs_project_created`);
}
