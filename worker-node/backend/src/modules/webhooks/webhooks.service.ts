import type { Knex } from 'knex';
import { AppError } from '../../middleware/error-handler.js';

export class WebhooksService {
  constructor(private db: Knex) {}

  private async ensureTableNamesColumn() {
    const hasColumn = await this.db.schema.hasColumn('webhooks', 'table_names');
    if (!hasColumn) {
      await this.db.schema.alterTable('webhooks', (t) => {
        t.specificType('table_names', 'text[]').nullable();
      });
      await this.db.raw(`UPDATE webhooks SET table_names = ARRAY[table_name] WHERE table_names IS NULL`);
      await this.db.schema.alterTable('webhooks', (t) => {
        t.dropColumn('table_name');
      });
    }
  }

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

  private async validateTablesInProjectSchema(projectId: string, tableNames: string[]) {
    const project = await this.db('projects').where({ id: projectId }).select('db_schema').first();
    if (!project?.db_schema) {
      throw new AppError(400, 'Project has no database schema assigned');
    }

    const results = await Promise.all(
      tableNames.map(name =>
        this.db('information_schema.tables')
          .where({ table_schema: project.db_schema, table_name: name })
          .first()
          .then(r => ({ name, exists: !!r }))
      )
    );

    const notFound = results.filter(r => !r.exists).map(r => r.name);
    if (notFound.length > 0) {
      throw new AppError(400, `Tables not found: ${notFound.join(', ')}`);
    }
  }

  async create(projectId: string, userId: string, input: {
    name?: string;
    table_names: string[];
    events: string[];
    url: string;
    method?: string;
    headers?: Record<string, string>;
    payload_template?: Record<string, unknown>;
    secret?: string;
    retry_count?: number;
    is_active?: boolean;
  }) {
    await this.ensureTableNamesColumn();
    await this.validateTablesInProjectSchema(projectId, input.table_names);

    const [webhook] = await this.db('webhooks')
      .insert({
        project_id: projectId,
        name: input.name ?? null,
        table_names: input.table_names,
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
    await this.ensureTableNamesColumn();
    const webhooks = await this.db('webhooks')
      .where({ project_id: projectId })
      .orderBy('created_at', 'desc');

    if (webhooks.length === 0) return [];

    const stats = await this.db('webhook_logs')
      .whereIn('webhook_id', webhooks.map((w: { id: string }) => w.id))
      .groupBy('webhook_id')
      .select(
        'webhook_id',
        this.db.raw('COUNT(*)::int as total'),
        this.db.raw('COUNT(*) FILTER (WHERE response_status >= 200 AND response_status < 300)::int as success_count'),
        this.db.raw('MAX(sent_at) as last_triggered'),
      );

    const statsMap = new Map(stats.map((s: any) => [s.webhook_id, s]));

    return webhooks.map((wh: any) => {
      const s = statsMap.get(wh.id);
      return {
        ...wh,
        secret: wh.secret ? String(wh.secret).substring(0, 3) + '••••' : null,
        stats: {
          total: s?.total ?? 0,
          success_count: s?.success_count ?? 0,
          last_triggered: s?.last_triggered ?? null,
        },
      };
    });
  }

  async findById(id: string, projectId: string) {
    const wh = await this.db('webhooks').where({ id, project_id: projectId }).first();
    if (!wh) throw new AppError(404, 'Webhook not found');
    return wh;
  }

  async update(id: string, projectId: string, input: Record<string, unknown>) {
    await this.ensureTableNamesColumn();
    if (input.table_names !== undefined) {
      await this.validateTablesInProjectSchema(projectId, input.table_names as string[]);
    }

    const updateData: Record<string, unknown> = {};
    if (input.name !== undefined) updateData.name = input.name;
    if (input.table_names !== undefined) updateData.table_names = input.table_names;
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
    await this.db('webhook_logs').where({ webhook_id: id }).delete();
    const deleted = await this.db('webhooks').where({ id, project_id: projectId }).delete();
    if (!deleted) throw new AppError(404, 'Webhook not found');
  }

  async getLogs(webhookId: string, projectId: string, limit = 50) {
    const webhook = await this.db('webhooks')
      .where({ id: webhookId, project_id: projectId })
      .select('id')
      .first();
    if (!webhook) throw new AppError(404, 'Webhook not found');

    return this.db('webhook_logs')
      .where({ webhook_id: webhookId })
      .orderBy('sent_at', 'desc')
      .limit(limit);
  }
}
