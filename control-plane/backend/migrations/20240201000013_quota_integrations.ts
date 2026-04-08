import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const newCols = ['max_discord_webhooks', 'max_telegram_bots', 'max_uptime_monitors'];

  for (const table of ['project_plans', 'project_quotas']) {
    for (const col of newCols) {
      const hasCol = await knex.schema.hasColumn(table, col);
      if (!hasCol) {
        await knex.schema.alterTable(table, (t) => {
          const defaults: Record<string, number> = {
            max_discord_webhooks: 3,
            max_telegram_bots: 2,
            max_uptime_monitors: 10,
          };
          t.integer(col).defaultTo(defaults[col]);
        });
      }
    }
  }

  await knex('project_plans')
    .where({ name: 'Basic' })
    .update({
      max_webhooks: 10,
      max_discord_webhooks: 3,
      max_telegram_bots: 2,
      max_uptime_monitors: 10,
    });
}

export async function down(knex: Knex): Promise<void> {
  const cols = ['max_discord_webhooks', 'max_telegram_bots', 'max_uptime_monitors'];
  for (const table of ['project_plans', 'project_quotas']) {
    for (const col of cols) {
      const hasCol = await knex.schema.hasColumn(table, col);
      if (hasCol) {
        await knex.schema.alterTable(table, (t) => {
          t.dropColumn(col);
        });
      }
    }
  }
}
