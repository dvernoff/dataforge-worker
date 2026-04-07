import type { Knex } from 'knex';

export class HistoryService {
  constructor(private db: Knex) {}

  async setupHistoryTracking(schema: string, tableName: string) {
    const historyTable = `__history_${tableName}`;

    await this.db.raw(`
      CREATE TABLE IF NOT EXISTS "${schema}"."${historyTable}" (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        record_id TEXT NOT NULL,
        operation VARCHAR(10) NOT NULL,
        old_values JSONB,
        new_values JSONB,
        changed_by UUID,
        changed_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await this.db.raw(`
      CREATE INDEX IF NOT EXISTS "idx_${historyTable}_record"
      ON "${schema}"."${historyTable}" (record_id, changed_at DESC)
    `);

    await this.db.raw(`
      CREATE OR REPLACE FUNCTION "${schema}"."${historyTable}_trigger_fn"()
      RETURNS TRIGGER AS $$
      BEGIN
        IF TG_OP = 'INSERT' THEN
          INSERT INTO "${schema}"."${historyTable}" (record_id, operation, new_values)
          VALUES (NEW.id::TEXT, 'INSERT', to_jsonb(NEW));
          RETURN NEW;
        ELSIF TG_OP = 'UPDATE' THEN
          INSERT INTO "${schema}"."${historyTable}" (record_id, operation, old_values, new_values)
          VALUES (OLD.id::TEXT, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW));
          RETURN NEW;
        ELSIF TG_OP = 'DELETE' THEN
          INSERT INTO "${schema}"."${historyTable}" (record_id, operation, old_values)
          VALUES (OLD.id::TEXT, 'DELETE', to_jsonb(OLD));
          RETURN OLD;
        END IF;
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await this.db.raw(`
      DROP TRIGGER IF EXISTS "${historyTable}_trigger" ON "${schema}"."${tableName}";
      CREATE TRIGGER "${historyTable}_trigger"
      AFTER INSERT OR UPDATE OR DELETE ON "${schema}"."${tableName}"
      FOR EACH ROW EXECUTE FUNCTION "${schema}"."${historyTable}_trigger_fn"();
    `);
  }

  async getHistory(schema: string, tableName: string, recordId: string) {
    const historyTable = `__history_${tableName}`;

    try {
      return await this.db(`${schema}.${historyTable}`)
        .where({ record_id: recordId })
        .orderBy('changed_at', 'desc');
    } catch {
      return [];
    }
  }

  async purgeOldHistory(schema: string, tableName: string, days: number) {
    const historyTable = `__history_${tableName}`;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    try {
      const result = await this.db(`${schema}.${historyTable}`)
        .where('changed_at', '<', cutoff)
        .delete();
      return result;
    } catch {
      return 0;
    }
  }

  async purgeAllOldHistory(schema: string, days: number) {
    try {
      const tables = await this.db.raw(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = ? AND table_name LIKE '__history_%'
      `, [schema]);
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      let total = 0;
      for (const row of tables.rows) {
        const deleted = await this.db(`${schema}.${row.table_name}`)
          .where('changed_at', '<', cutoff)
          .delete();
        total += deleted;
      }
      return total;
    } catch {
      return 0;
    }
  }

  async rollback(schema: string, tableName: string, recordId: string, historyId: string) {
    const historyTable = `__history_${tableName}`;

    const entry = await this.db(`${schema}.${historyTable}`)
      .where({ id: historyId })
      .first();

    if (!entry) {
      throw new Error('History entry not found');
    }

    const values = entry.old_values ?? entry.new_values;
    if (!values) {
      throw new Error('No values to rollback to');
    }

    const { id: _id, created_at: _ca, ...updateData } = values;

    await this.db(`${schema}.${tableName}`)
      .where({ id: recordId })
      .update(updateData);

    return values;
  }
}
