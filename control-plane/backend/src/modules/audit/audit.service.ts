import type { Knex } from 'knex';

export class AuditService {
  constructor(private db: Knex) {}

  async log(entry: {
    project_id?: string;
    user_id?: string;
    user_email?: string;
    is_superadmin_action?: boolean;
    action: string;
    resource_type?: string;
    resource_id?: string;
    details?: Record<string, unknown>;
    ip_address?: string;
    user_agent?: string;
  }) {
    await this.db('audit_logs').insert({
      project_id: entry.project_id ?? null,
      user_id: entry.user_id ?? null,
      user_email: entry.user_email ?? null,
      is_superadmin_action: entry.is_superadmin_action ?? false,
      action: entry.action,
      resource_type: entry.resource_type ?? null,
      resource_id: entry.resource_id ?? null,
      details: entry.details ? JSON.stringify(entry.details) : null,
      ip_address: entry.ip_address ?? null,
      user_agent: entry.user_agent ?? null,
    });
  }

  async findByProject(projectId: string, params: {
    page: number;
    limit: number;
    action?: string;
    userId?: string;
    search?: string;
    dateFrom?: string;
    dateTo?: string;
  }) {
    let query = this.db('audit_logs').where({ project_id: projectId });

    if (params.action) query = query.where('action', 'LIKE', `${params.action}%`);
    if (params.userId) query = query.where({ user_id: params.userId });
    if (params.search) query = query.whereRaw('details::text ILIKE ?', [`%${params.search}%`]);
    if (params.dateFrom) query = query.where('created_at', '>=', params.dateFrom);
    if (params.dateTo) query = query.where('created_at', '<=', params.dateTo);

    const countQuery = query.clone();
    const [{ count }] = await countQuery.count('* as count');
    const total = Number(count);

    const offset = (params.page - 1) * params.limit;
    const logs = await query
      .orderBy('created_at', 'desc')
      .offset(offset)
      .limit(params.limit);

    return {
      data: logs,
      pagination: {
        page: params.page,
        limit: params.limit,
        total,
        totalPages: Math.ceil(total / params.limit),
      },
    };
  }

  async findAll(params: {
    page: number;
    limit: number;
    projectId?: string;
    action?: string;
    userId?: string;
  }) {
    let query = this.db('audit_logs');

    if (params.projectId) query = query.where({ project_id: params.projectId });
    if (params.action) query = query.where('action', 'LIKE', `${params.action}%`);
    if (params.userId) query = query.where({ user_id: params.userId });

    const countQuery = query.clone();
    const [{ count }] = await countQuery.count('* as count');
    const total = Number(count);

    const offset = (params.page - 1) * params.limit;
    const logs = await query
      .orderBy('created_at', 'desc')
      .offset(offset)
      .limit(params.limit);

    return {
      data: logs,
      pagination: {
        page: params.page,
        limit: params.limit,
        total,
        totalPages: Math.ceil(total / params.limit),
      },
    };
  }
}
