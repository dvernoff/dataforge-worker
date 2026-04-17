import type { Knex } from 'knex';
import { AppError } from '../../middleware/error-handler.js';

export interface BatchOperation {
  method: 'insert' | 'update' | 'delete';
  table: string;
  id?: string;
  data?: Record<string, unknown>;
}

export interface BatchResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

export class BatchService {
  constructor(private db: Knex) {}

  async executeBatch(
    schema: string,
    operations: BatchOperation[],
    useTransaction: boolean
  ): Promise<BatchResult[]> {
    if (useTransaction) {
      return this.executeInTransaction(schema, operations);
    }
    return this.executeSequential(schema, operations);
  }

  private async executeInTransaction(
    schema: string,
    operations: BatchOperation[]
  ): Promise<BatchResult[]> {
    const results: BatchResult[] = [];

    await this.db.transaction(async (trx) => {
      for (const op of operations) {
        const result = await this.executeSingle(trx, schema, op);
        if (!result.success) {
          throw new AppError(400, result.error ?? 'Batch operation failed');
        }
        results.push(result);
      }
    });

    return results;
  }

  private async executeSequential(
    schema: string,
    operations: BatchOperation[]
  ): Promise<BatchResult[]> {
    const results: BatchResult[] = [];

    for (const op of operations) {
      const result = await this.executeSingle(this.db, schema, op);
      results.push(result);
    }

    return results;
  }

  private async executeSingle(
    db: Knex | Knex.Transaction,
    schema: string,
    op: BatchOperation
  ): Promise<BatchResult> {
    try {
      const fullTable = `${schema}.${op.table}`;

      switch (op.method) {
        case 'insert': {
          if (!op.data) {
            return { success: false, error: 'Data is required for insert' };
          }
          const [row] = await db(fullTable).insert(op.data).returning('*');
          return { success: true, data: row };
        }

        case 'update': {
          if (!op.id) {
            return { success: false, error: 'ID is required for update' };
          }
          if (!op.data) {
            return { success: false, error: 'Data is required for update' };
          }
          const { id: _id, created_at: _ca, updated_at: _ua, ...updateData } = op.data;
          const [row] = await db(fullTable)
            .where({ id: op.id })
            .update(updateData)
            .returning('*');
          if (!row) {
            return { success: false, error: `Record ${op.id} not found in ${op.table}` };
          }
          return { success: true, data: row };
        }

        case 'delete': {
          if (!op.id) {
            return { success: false, error: 'ID is required for delete' };
          }
          const deleted = await db(fullTable).where({ id: op.id }).delete();
          if (!deleted) {
            return { success: false, error: `Record ${op.id} not found in ${op.table}` };
          }
          return { success: true };
        }

        default:
          return { success: false, error: `Unknown method: ${op.method}` };
      }
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }
}
