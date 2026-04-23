import type { Knex } from 'knex';
import { validateSchemaAccess } from '../../utils/sql-guard.js';

export interface Widget {
  id: string;
  type: 'number' | 'chart' | 'table' | 'text';
  title: string;
  sql?: string;
  config?: Record<string, unknown>;
  content?: string;
}

export class DashboardsService {
  constructor(private db: Knex) {}

  async list(projectId: string) {
    return this.db('custom_dashboards')
      .where({ project_id: projectId })
      .orderBy('created_at', 'desc');
  }

  async getById(dashboardId: string, projectId?: string) {
    const query = this.db('custom_dashboards').where({ id: dashboardId });
    if (projectId) query.andWhere({ project_id: projectId });
    return query.first();
  }

  async create(input: {
    project_id: string;
    name: string;
    description?: string;
    created_by?: string;
  }) {
    const [dashboard] = await this.db('custom_dashboards')
      .insert({
        project_id: input.project_id,
        name: input.name,
        description: input.description,
        created_by: input.created_by,
      })
      .returning('*');
    return dashboard;
  }

  async update(dashboardId: string, projectId: string, input: {
    name?: string;
    description?: string;
    widgets?: Widget[];
    layout?: Record<string, unknown>;
    is_public?: boolean;
    public_slug?: string | null;
  }) {
    const updateData: Record<string, unknown> = {};
    if (input.name !== undefined) updateData.name = input.name;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.widgets !== undefined) updateData.widgets = JSON.stringify(input.widgets);
    if (input.layout !== undefined) updateData.layout = JSON.stringify(input.layout);
    if (input.is_public !== undefined) updateData.is_public = input.is_public;
    if (input.public_slug !== undefined) updateData.public_slug = input.public_slug;

    const [dashboard] = await this.db('custom_dashboards')
      .where({ id: dashboardId, project_id: projectId })
      .update(updateData)
      .returning('*');
    return dashboard;
  }

  async delete(dashboardId: string, projectId: string) {
    const deleted = await this.db('custom_dashboards')
      .where({ id: dashboardId, project_id: projectId })
      .delete();
    if (!deleted) throw new Error('Dashboard not found');
  }

  async executeWidget(widget: Widget, dbSchema: string, timeoutMs = 10_000): Promise<Record<string, unknown>> {
    if (!widget.sql) {
      return { data: null };
    }

    const normalized = widget.sql.trim().toUpperCase();
    if (!normalized.startsWith('SELECT') && !normalized.startsWith('WITH')) {
      return { error: 'Only SELECT queries allowed in widgets' };
    }

    try { await validateSchemaAccess(widget.sql, dbSchema, this.db); } catch {
      return { error: 'Cross-schema access is not allowed in dashboard widgets' };
    }

    try {
      const schemaRegex = /^[a-z_][a-z0-9_]*$/;
      if (!schemaRegex.test(dbSchema)) {
        return { error: 'Invalid schema name' };
      }
      const result = await this.db.transaction(async (trx) => {
        await trx.raw(`SET LOCAL search_path TO "${dbSchema}", public`);
        await trx.raw(`SET LOCAL statement_timeout = ${Math.max(1000, Math.min(timeoutMs, 120000))}`);
        await trx.raw('SET LOCAL transaction_read_only = on');
        return trx.raw(widget.sql!) as any;
      });
      return {
        rows: result.rows ?? [],
        fields: result.fields?.map((f: { name: string }) => f.name) ?? [],
        rowCount: result.rowCount ?? 0,
      };
    } catch (err) {
      return { error: (err as Error).message };
    }
  }

  async executeAllWidgets(dashboardId: string, dbSchema: string) {
    const dashboard = await this.getById(dashboardId);
    if (!dashboard) throw new Error('Dashboard not found');

    const widgets = (dashboard.widgets as Widget[]) ?? [];
    const results: Record<string, Record<string, unknown>> = {};

    for (const widget of widgets) {
      results[widget.id] = await this.executeWidget(widget, dbSchema);
    }

    return results;
  }
}
