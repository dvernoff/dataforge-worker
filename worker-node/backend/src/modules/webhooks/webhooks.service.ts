import type { Knex } from 'knex';
import { AppError } from '../../middleware/error-handler.js';

export class WebhooksService {
  constructor(private db: Knex) {}

  private async validateTableInProjectSchema(projectId: string, tableName: string) {
    const project = await this.db('projects').where({ id: projectId }).select('db_schema').first();
    if (!project?.db_schema) {
      throw new AppError(400, 'Project has no database schema assigned');
    }

    const tableExists = await this.db('information_schema.tables')
      .where({
        table_schema: project.db_schema,
        table_name: tableName,
      })
      .first();

    if (!tableExists) {
      throw new AppError(400, `Table "${tableName}" does not exist in this project's schema`);
    }
  }

  async create(projectId: string, userId: string, input: {
    name?: string;
    table_name: string;
    events: string[];
    url: string;
    method?: string;
    headers?: Record<string, string>;
    payload_template?: Record<string, unknown>;
    secret?: string;
    retry_count?: number;
    is_active?: boolean;
  }) {
    // Validate that the table exists in the project's schema
    await this.validateTableInProjectSchema(projectId, input.table_name);

    const [webhook] = await this.db('webhooks')
      .insert({
        project_id: projectId,
        name: input.name ?? null,
        table_name: input.table_name,
        events: input.events,
        url: input.url,
        method: input.method ?? 'POST',
        headers: JSON.stringify(input.headers ?? {}),
        payload_template: input.payload_template ? JSON.stringify(input.payload_template) : null,
        secret: input.secret ?? null,
        retry_count: input.retry_count ?? 3,
        is_active: input.is_active ?? true,
        created_by: userId,
      })
      .returning('*');
    return webhook;
  }

  async findAll(projectId: string) {
    const webhooks = await this.db('webhooks')
      .where({ project_id: projectId })
      .orderBy('created_at', 'desc');

    // Get recent stats for each webhook
    const result = [];
    for (const wh of webhooks) {
      const [stats] = await this.db('webhook_logs')
        .where({ webhook_id: wh.id })
        .select(
          this.db.raw('COUNT(*)::int as total'),
          this.db.raw('COUNT(*) FILTER (WHERE response_status >= 200 AND response_status < 300)::int as success_count'),
          this.db.raw('MAX(sent_at) as last_triggered'),
        );

      result.push({
        ...wh,
        stats: {
          total: stats?.total ?? 0,
          success_count: stats?.success_count ?? 0,
          last_triggered: stats?.last_triggered ?? null,
        },
      });
    }

    return result;
  }

  async findById(id: string, projectId: string) {
    const wh = await this.db('webhooks').where({ id, project_id: projectId }).first();
    if (!wh) throw new AppError(404, 'Webhook not found');
    return wh;
  }

  async update(id: string, projectId: string, input: Record<string, unknown>) {
    // Validate table_name against the project's schema if it's being changed
    if (input.table_name !== undefined) {
      await this.validateTableInProjectSchema(projectId, String(input.table_name));
    }

    const updateData: Record<string, unknown> = {};
    if (input.name !== undefined) updateData.name = input.name;
    if (input.table_name !== undefined) updateData.table_name = input.table_name;
    if (input.events !== undefined) updateData.events = input.events;
    if (input.url !== undefined) updateData.url = input.url;
    if (input.method !== undefined) updateData.method = input.method;
    if (input.headers !== undefined) updateData.headers = JSON.stringify(input.headers);
    if (input.payload_template !== undefined) updateData.payload_template = input.payload_template ? JSON.stringify(input.payload_template) : null;
    if (input.secret !== undefined) updateData.secret = input.secret;
    if (input.retry_count !== undefined) updateData.retry_count = input.retry_count;
    if (input.is_active !== undefined) updateData.is_active = input.is_active;

    const [webhook] = await this.db('webhooks')
      .where({ id, project_id: projectId })
      .update(updateData)
      .returning('*');

    if (!webhook) throw new AppError(404, 'Webhook not found');
    return webhook;
  }

  async delete(id: string, projectId: string) {
    const deleted = await this.db('webhooks').where({ id, project_id: projectId }).delete();
    if (!deleted) throw new AppError(404, 'Webhook not found');
  }

  async getLogs(webhookId: string, limit = 50) {
    return this.db('webhook_logs')
      .where({ webhook_id: webhookId })
      .orderBy('sent_at', 'desc')
      .limit(limit);
  }
}
