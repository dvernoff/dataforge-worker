import type { Knex } from 'knex';
import { safeFetch } from '../../utils/safe-fetch.js';
import { validateSchemaAccess } from '../../utils/sql-guard.js';

export interface FlowNode {
  id: string;
  type: string; // action_sql, action_http, action_webhook, action_transform, condition
  config: Record<string, unknown>;
  next?: string | null;         // next node id (for linear flow)
  trueBranch?: string | null;   // for condition nodes
  falseBranch?: string | null;  // for condition nodes
}

export interface FlowContext {
  trigger: unknown;
  results: Record<string, unknown>;
  variables: Record<string, unknown>;
}

export class FlowExecutor {
  constructor(private db: Knex) {}

  async executeNode(node: FlowNode, context: FlowContext, projectSchema: string, timeoutMs = 30_000): Promise<{ result: unknown; nextNodeId: string | null }> {
    switch (node.type) {
      case 'action_sql':
        return this.executeSql(node, context, projectSchema, timeoutMs);
      case 'action_http':
        return this.executeHttp(node, context);
      case 'action_webhook':
        return this.executeWebhook(node, context);
      case 'action_transform':
        return this.executeTransform(node, context);
      case 'condition':
        return this.evaluateCondition(node, context);
      default:
        throw new Error(`Unknown node type: ${node.type}`);
    }
  }

  private async executeSql(node: FlowNode, context: FlowContext, projectSchema: string, timeoutMs = 30_000): Promise<{ result: unknown; nextNodeId: string | null }> {
    let query = String(node.config.query ?? '');
    // Simple variable interpolation: {{variableName}}
    query = this.interpolate(query, context);

    // Validate: SELECT only
    const normalized = query.trim().toUpperCase();
    if (!normalized.startsWith('SELECT') && !normalized.startsWith('WITH')) {
      throw new Error('Only SELECT queries are allowed in flow SQL nodes');
    }

    // Always use the project's schema — ignore node.config.schema to prevent cross-schema access
    if (!projectSchema || !/^[a-z_][a-z0-9_]*$/.test(projectSchema)) {
      throw new Error('Invalid or missing project schema');
    }

    // Block cross-schema access
    validateSchemaAccess(query, projectSchema);

    const result = await this.db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL search_path TO ?, 'public'`, [projectSchema]);
      await trx.raw(`SET LOCAL statement_timeout = ${Math.max(1000, Math.min(timeoutMs, 120000))}`);
      return trx.raw(query) as any;
    });

    return {
      result: { rows: result.rows ?? [], rowCount: result.rowCount ?? 0 },
      nextNodeId: node.next ?? null,
    };
  }

  private async executeHttp(node: FlowNode, context: FlowContext): Promise<{ result: unknown; nextNodeId: string | null }> {
    const url = this.interpolate(String(node.config.url ?? ''), context);
    const method = String(node.config.method ?? 'GET').toUpperCase();
    const headers = (node.config.headers as Record<string, string>) ?? {};
    const body = node.config.body;

    const fetchOptions: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
    };

    if (body && method !== 'GET') {
      const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
      fetchOptions.body = this.interpolate(bodyStr, context);
    }

    const response = await safeFetch(url, fetchOptions);
    let responseBody: unknown;
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      responseBody = await response.json();
    } else {
      responseBody = await response.text();
    }

    return {
      result: { status: response.status, body: responseBody },
      nextNodeId: node.next ?? null,
    };
  }

  private async executeWebhook(node: FlowNode, context: FlowContext): Promise<{ result: unknown; nextNodeId: string | null }> {
    const url = this.interpolate(String(node.config.url ?? ''), context);
    const payload = node.config.payload ?? context.results;

    const response = await safeFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    return {
      result: { status: response.status, ok: response.ok },
      nextNodeId: node.next ?? null,
    };
  }

  private async executeTransform(node: FlowNode, context: FlowContext): Promise<{ result: unknown; nextNodeId: string | null }> {
    const expression = String(node.config.expression ?? '');
    // Simple safe transform: supports basic mapping and filtering via JSON path-like syntax
    // For security, we use a limited evaluator rather than eval()
    let result: unknown;

    try {
      const inputKey = String(node.config.input ?? '');
      const input = inputKey ? context.results[inputKey] : context.results;

      const operation = String(node.config.operation ?? 'passthrough');
      switch (operation) {
        case 'pick_fields': {
          const fields = (node.config.fields as string[]) ?? [];
          if (Array.isArray(input)) {
            result = (input as Record<string, unknown>[]).map((item) => {
              const picked: Record<string, unknown> = {};
              for (const f of fields) picked[f] = item[f];
              return picked;
            });
          } else if (typeof input === 'object' && input !== null) {
            const picked: Record<string, unknown> = {};
            for (const f of fields) picked[f] = (input as Record<string, unknown>)[f];
            result = picked;
          } else {
            result = input;
          }
          break;
        }
        case 'set_variable': {
          const varName = String(node.config.variable ?? 'temp');
          context.variables[varName] = input;
          result = input;
          break;
        }
        case 'passthrough':
        default:
          result = input;
          break;
      }
    } catch (err) {
      result = { error: err instanceof Error ? err.message : String(err) };
    }

    return { result, nextNodeId: node.next ?? null };
  }

  private async evaluateCondition(node: FlowNode, context: FlowContext): Promise<{ result: unknown; nextNodeId: string | null }> {
    const field = String(node.config.field ?? '');
    const operator = String(node.config.operator ?? 'eq');
    const value = node.config.value;

    // Get the value to compare from context
    const inputKey = String(node.config.input ?? '');
    const inputData = inputKey ? context.results[inputKey] : context.results;
    let fieldValue: unknown;

    if (typeof inputData === 'object' && inputData !== null) {
      fieldValue = (inputData as Record<string, unknown>)[field];
    }

    let conditionMet = false;
    switch (operator) {
      case 'eq': conditionMet = fieldValue === value; break;
      case 'neq': conditionMet = fieldValue !== value; break;
      case 'gt': conditionMet = Number(fieldValue) > Number(value); break;
      case 'gte': conditionMet = Number(fieldValue) >= Number(value); break;
      case 'lt': conditionMet = Number(fieldValue) < Number(value); break;
      case 'lte': conditionMet = Number(fieldValue) <= Number(value); break;
      case 'contains': conditionMet = String(fieldValue).includes(String(value)); break;
      case 'exists': conditionMet = fieldValue !== undefined && fieldValue !== null; break;
      case 'empty': conditionMet = fieldValue === undefined || fieldValue === null || fieldValue === ''; break;
      default: conditionMet = false;
    }

    return {
      result: { conditionMet, field, operator, fieldValue, compareValue: value },
      nextNodeId: conditionMet ? (node.trueBranch ?? null) : (node.falseBranch ?? null),
    };
  }

  private interpolate(template: string, context: FlowContext): string {
    return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_match, path: string) => {
      const parts = path.split('.');
      let value: unknown = { trigger: context.trigger, results: context.results, variables: context.variables };
      for (const part of parts) {
        if (typeof value === 'object' && value !== null) {
          value = (value as Record<string, unknown>)[part];
        } else {
          return '';
        }
      }
      return String(value ?? '');
    });
  }
}
