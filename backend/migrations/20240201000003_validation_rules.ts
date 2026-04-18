import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('validation_rules', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('project_id').notNullable();
    table.string('table_name', 255).notNullable();
    table.string('column_name', 255).nullable();
    table.string('rule_type', 50).notNullable()
      .checkIn(['unique_combo', 'regex', 'range', 'enum', 'custom_expression', 'state_machine']);
    table.jsonb('config').notNullable().defaultTo('{}');
    table.string('error_message', 500).notNullable();
    table.boolean('is_active').defaultTo(true);
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  await knex.raw('CREATE INDEX idx_validation_rules_lookup ON validation_rules(project_id, table_name)');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('validation_rules');
}
