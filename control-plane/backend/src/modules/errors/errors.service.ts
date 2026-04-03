import type { Knex } from 'knex';

export interface CreateErrorInput {
  project_id?: string;
  node_id?: string;
  source: 'api' | 'webhook' | 'cron' | 'node' | 'system';
  severity: 'error' | 'warning' | 'critical';
  title: string;
  message?: string;
  stack_trace?: string;
  metadata?: Record<string, unknown>;
}

export interface ErrorFilters {
  source?: string;
  severity?: string;
  status?: string;
  page?: number;
  limit?: number;
}

export class ErrorsService {
  constructor(private db: Knex) {}

  async list(filters: ErrorFilters) {
    const page = filters.page ?? 1;
    const limit = Math.min(filters.limit ?? 50, 100);
    const offset = (page - 1) * limit;

    let qb = this.db('tracked_errors');

    if (filters.source) {
      qb = qb.where('source', filters.source);
    }
    if (filters.severity) {
      qb = qb.where('severity', filters.severity);
    }
    if (filters.status) {
      qb = qb.where('status', filters.status);
    }

    const [{ count: total }] = await qb.clone().count('id as count');

    const errors = await qb
      .select('*')
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset);

    return {
      errors,
      total: Number(total),
      page,
      limit,
    };
  }

  async getById(id: string) {
    const error = await this.db('tracked_errors').where({ id }).first();
    if (!error) {
      throw Object.assign(new Error('Error not found'), { statusCode: 404 });
    }
    return error;
  }

  async acknowledge(id: string, userId: string) {
    const [error] = await this.db('tracked_errors')
      .where({ id })
      .update({
        status: 'acknowledged',
        acknowledged_by: userId,
      })
      .returning('*');

    if (!error) {
      throw Object.assign(new Error('Error not found'), { statusCode: 404 });
    }
    return error;
  }

  async resolve(id: string) {
    const [error] = await this.db('tracked_errors')
      .where({ id })
      .update({
        status: 'resolved',
        resolved_at: new Date(),
      })
      .returning('*');

    if (!error) {
      throw Object.assign(new Error('Error not found'), { statusCode: 404 });
    }
    return error;
  }

  async create(input: CreateErrorInput) {
    const [error] = await this.db('tracked_errors')
      .insert({
        project_id: input.project_id ?? null,
        node_id: input.node_id ?? null,
        source: input.source,
        severity: input.severity,
        title: input.title,
        message: input.message ?? null,
        stack_trace: input.stack_trace ?? null,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      })
      .returning('*');

    return error;
  }
}
