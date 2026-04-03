import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (table) => {
    table.string('totp_secret', 255).nullable();
    table.boolean('totp_enabled').defaultTo(false);
    table.specificType('backup_codes', 'TEXT[]').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (table) => {
    table.dropColumn('totp_secret');
    table.dropColumn('totp_enabled');
    table.dropColumn('backup_codes');
  });
}
