import type { Knex } from 'knex';
import { AppError } from '../../middleware/error-handler.js';

export interface ValidationRule {
  id: string;
  project_id: string;
  table_name: string;
  column_name: string | null;
  rule_type: 'unique_combo' | 'regex' | 'range' | 'enum' | 'custom_expression' | 'state_machine';
  config: Record<string, unknown>;
  error_message: string;
  is_active: boolean;
  created_at: string;
}

export interface ValidationError {
  rule_id: string;
  rule_type: string;
  message: string;
}

export class ValidationService {
  private rulesCache = new Map<string, { rules: ValidationRule[]; ts: number }>();
  private typesCache = new Map<string, { types: Map<string, string>; ts: number }>();

  constructor(private db: Knex) {}

  private async getCachedRules(projectId: string, tableName: string): Promise<ValidationRule[]> {
    const key = `${projectId}:${tableName}`;
    const cached = this.rulesCache.get(key);
    if (cached && Date.now() - cached.ts < 10_000) return cached.rules;

    const rules = await this.db('validation_rules')
      .where({ project_id: projectId, table_name: tableName, is_active: true });
    this.rulesCache.set(key, { rules, ts: Date.now() });
    return rules;
  }

  private async getCachedColumnTypes(schema: string, tableName: string): Promise<Map<string, string>> {
    const key = `${schema}:${tableName}`;
    const cached = this.typesCache.get(key);
    if (cached && Date.now() - cached.ts < 30_000) return cached.types;

    const result = await this.db.raw(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = ? AND table_name = ?`,
      [schema, tableName]
    );
    const types = new Map<string, string>(result.rows.map((r: any) => [r.column_name as string, r.data_type as string]));
    this.typesCache.set(key, { types, ts: Date.now() });
    return types;
  }

  private invalidateRulesCache(projectId: string, tableName: string): void {
    this.rulesCache.delete(`${projectId}:${tableName}`);
  }

  async getRules(projectId: string, tableName: string): Promise<ValidationRule[]> {
    return this.db('validation_rules')
      .where({ project_id: projectId, table_name: tableName })
      .orderBy('created_at', 'desc');
  }

  private static validateExpression(expression: string): void {
    const forbidden = /\b(DROP|ALTER|CREATE|TRUNCATE|INSERT|UPDATE|DELETE|GRANT|REVOKE|COPY|EXECUTE|CALL|SET\s+ROLE|SET\s+SESSION|pg_read_file|pg_write_file|lo_import|lo_export|dblink|pg_sleep)\b/i;
    if (forbidden.test(expression)) {
      throw new AppError(400, 'Expression contains forbidden SQL keywords (DROP, ALTER, DELETE, etc.)');
    }
    if (/[;]|--|\/\*/.test(expression)) {
      throw new AppError(400, 'Expression cannot contain semicolons or SQL comments');
    }
  }

  async createRule(input: {
    project_id: string;
    table_name: string;
    column_name?: string | null;
    rule_type: string;
    config: Record<string, unknown>;
    error_message: string;
  }): Promise<ValidationRule> {
    if (input.rule_type === 'custom_expression' && input.config.expression) {
      ValidationService.validateExpression(String(input.config.expression));
    }

    const [rule] = await this.db('validation_rules')
      .insert({
        project_id: input.project_id,
        table_name: input.table_name,
        column_name: input.column_name ?? null,
        rule_type: input.rule_type,
        config: JSON.stringify(input.config),
        error_message: input.error_message,
      })
      .returning('*');
    this.invalidateRulesCache(input.project_id, input.table_name);
    return rule;
  }

  async deleteRule(id: string, projectId: string): Promise<void> {
    const rule = await this.db('validation_rules').where({ id, project_id: projectId }).first();
    if (!rule) {
      throw new AppError(404, 'Validation rule not found');
    }
    await this.db('validation_rules').where({ id, project_id: projectId }).delete();
    this.invalidateRulesCache(rule.project_id, rule.table_name);
  }

  private table(schema: string, tableName: string) {
    return this.db.raw(`"${schema}"."${tableName}"`);
  }

  async validateRecord(
    projectId: string,
    schema: string,
    tableName: string,
    record: Record<string, unknown>,
    existingId?: string
  ): Promise<ValidationError[]> {
    const rules = await this.getCachedRules(projectId, tableName);

    const errors: ValidationError[] = [];

    for (const rule of rules) {
      const config = typeof rule.config === 'string' ? JSON.parse(rule.config) : rule.config;

      try {
        switch (rule.rule_type) {
          case 'unique_combo': {
            const columns = config.columns as string[];
            if (columns && columns.length > 0) {
              const conditions: string[] = [];
              const bindings: unknown[] = [];
              for (const col of columns) {
                const val = record[col];
                if (val === null || val === undefined) {
                  conditions.push(`"${col}" IS NULL`);
                } else {
                  conditions.push(`"${col}" = ?`);
                  bindings.push(val);
                }
              }
              if (existingId) {
                conditions.push(`"id" != ?`);
                bindings.push(existingId);
              }

              const sql = `SELECT 1 FROM "${schema}"."${tableName}" WHERE ${conditions.join(' AND ')} LIMIT 1`;
              const result = await this.db.raw(sql, bindings);
              if (result.rows && result.rows.length > 0) {
                errors.push({ rule_id: rule.id, rule_type: rule.rule_type, message: rule.error_message });
              }
            }
            break;
          }

          case 'regex': {
            const pattern = config.pattern as string;
            const columnName = config.column_name as string ?? rule.column_name;
            if (columnName && pattern && record[columnName] != null) {
              const value = String(record[columnName]);
              const regex = new RegExp(pattern);
              if (!regex.test(value)) {
                errors.push({ rule_id: rule.id, rule_type: rule.rule_type, message: rule.error_message });
              }
            }
            break;
          }

          case 'range': {
            const columnName = config.column_name as string ?? rule.column_name;
            const min = config.min as number | undefined;
            const max = config.max as number | undefined;
            if (columnName && record[columnName] != null) {
              const value = Number(record[columnName]);
              if ((min !== undefined && value < min) || (max !== undefined && value > max)) {
                errors.push({ rule_id: rule.id, rule_type: rule.rule_type, message: rule.error_message });
              }
            }
            break;
          }

          case 'enum': {
            const columnName = config.column_name as string ?? rule.column_name;
            const allowedValues = config.values as string[];
            if (columnName && allowedValues && record[columnName] != null) {
              if (!allowedValues.includes(String(record[columnName]))) {
                errors.push({ rule_id: rule.id, rule_type: rule.rule_type, message: rule.error_message });
              }
            }
            break;
          }

          case 'custom_expression': {
            const expression = config.expression as string;
            if (expression) {
              const forbidden = /\b(DROP|ALTER|CREATE|TRUNCATE|INSERT|UPDATE|DELETE|GRANT|REVOKE|COPY|EXECUTE|CALL|SET\s+ROLE|SET\s+SESSION|pg_read_file|pg_write_file|lo_import|lo_export|dblink|pg_sleep)\b/i;
              if (forbidden.test(expression)) {
                console.warn(`[Validation] Blocked dangerous expression: ${expression}`);
                break;
              }
              if (/[;]|--|\/\*/.test(expression)) {
                console.warn(`[Validation] Blocked expression with forbidden chars: ${expression}`);
                break;
              }

              try {
                const colNames: string[] = [];
                const colValues: unknown[] = [];
                const colCasts: string[] = [];

                const typeMap = await this.getCachedColumnTypes(schema, tableName);

                for (const [key, val] of Object.entries(record)) {
                  if (val === undefined) continue;
                  const pgType = typeMap.get(key);
                  if (!pgType) continue;
                  colNames.push(`"${key}"`);
                  colValues.push(val);
                  colCasts.push(`?::${pgType}`);
                }

                if (colNames.length === 0) break;

                const sql = `
                  WITH _row AS (SELECT ${colCasts.map((c, i) => `${c} AS ${colNames[i]}`).join(', ')})
                  SELECT (${expression})::boolean AS valid FROM _row
                `;

                const result = await this.db.transaction(async (trx) => {
                  await trx.raw('SET LOCAL transaction_read_only = on');
                  await trx.raw(`SET LOCAL search_path = "${schema}"`);
                  await trx.raw('SET LOCAL statement_timeout = 1000');
                  return trx.raw(sql, colValues) as any;
                });
                if (result.rows[0] && !result.rows[0].valid) {
                  errors.push({ rule_id: rule.id, rule_type: rule.rule_type, message: rule.error_message });
                }
              } catch (err) {
                console.error(`[Validation] Expression evaluation failed:`, err);
              }
            }
            break;
          }

          case 'state_machine': {
            const columnName = config.column_name as string ?? rule.column_name;
            const transitions = config.transitions as Record<string, string[]>;
            if (columnName && transitions && existingId) {
              const result = await this.db.raw(
                `SELECT * FROM "${schema}"."${tableName}" WHERE "id" = ? LIMIT 1`,
                [existingId]
              );
              const existing = result.rows?.[0];
              if (existing) {
                const oldState = String(existing[columnName]);
                const newState = String(record[columnName]);
                const allowedTransitions = transitions[oldState];
                if (allowedTransitions && !allowedTransitions.includes(newState)) {
                  errors.push({ rule_id: rule.id, rule_type: rule.rule_type, message: rule.error_message });
                }
              }
            }
            break;
          }
        }
      } catch (err) {
        console.error(`[Validation] Rule ${rule.id} (${rule.rule_type}) failed:`, err);
      }
    }

    return errors;
  }
}
