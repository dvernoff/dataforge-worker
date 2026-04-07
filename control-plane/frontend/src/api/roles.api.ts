import { api } from './client';

export interface Role {
  id: string;
  name: string;
  color: string;
  description: string | null;
  max_projects: number;
  max_tables: number;
  max_records: number;
  max_api_requests: number;
  max_storage_mb: number;
  max_endpoints: number;
  max_webhooks: number;
  max_files: number;
  max_backups: number;
  max_cron: number;
  max_query_timeout_ms: number;
  max_concurrent_requests: number;
  max_rows_per_query: number;
  max_export_rows: number;
  users_count: number;
  created_at: string;
  updated_at: string;
}

export interface CreateRoleInput {
  name: string;
  color?: string;
  description?: string;
  max_projects?: number;
  max_tables?: number;
  max_records?: number;
  max_api_requests?: number;
  max_storage_mb?: number;
  max_endpoints?: number;
  max_webhooks?: number;
  max_files?: number;
  max_backups?: number;
  max_cron?: number;
  max_query_timeout_ms?: number;
  max_concurrent_requests?: number;
  max_rows_per_query?: number;
  max_export_rows?: number;
}

export const rolesApi = {
  getAll: () => api.get<{ roles: Role[] }>('/system/roles'),
  create: (data: CreateRoleInput) => api.post<{ role: Role }>('/system/roles', data),
  update: (id: string, data: Partial<CreateRoleInput>) => api.put<{ role: Role }>(`/system/roles/${id}`, data),
  delete: (id: string) => api.delete(`/system/roles/${id}`),
};
