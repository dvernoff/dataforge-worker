import { api } from './client';

export interface FilterCondition {
  field: string;
  operator: string;
  value?: unknown;
  values?: unknown[];
}

export interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface DataResponse {
  data: Record<string, unknown>[];
  pagination: PaginationInfo;
}

export const dataApi = {
  list: (projectId: string, tableName: string, params?: {
    page?: number;
    limit?: number;
    sort?: string;
    order?: string;
    search?: string;
    searchColumns?: string[];
    filters?: FilterCondition[];
    include_deleted?: boolean;
    only_deleted?: boolean;
  }) => {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.sort) searchParams.set('sort', params.sort);
    if (params?.order) searchParams.set('order', params.order);
    if (params?.search) searchParams.set('search', params.search);
    if (params?.searchColumns) searchParams.set('searchColumns', params.searchColumns.join(','));
    if (params?.filters?.length) searchParams.set('filters', JSON.stringify(params.filters));
    if (params?.include_deleted) searchParams.set('include_deleted', 'true');
    if (params?.only_deleted) searchParams.set('only_deleted', 'true');

    const qs = searchParams.toString();
    return api.get<DataResponse>(
      `/projects/${projectId}/tables/${tableName}/data${qs ? `?${qs}` : ''}`
    );
  },

  getById: (projectId: string, tableName: string, id: string) =>
    api.get<{ record: Record<string, unknown> }>(
      `/projects/${projectId}/tables/${tableName}/data/${id}`
    ),

  create: (projectId: string, tableName: string, data: Record<string, unknown>) =>
    api.post<{ record: Record<string, unknown> }>(
      `/projects/${projectId}/tables/${tableName}/data`, data
    ),

  update: (projectId: string, tableName: string, id: string, data: Record<string, unknown>) =>
    api.put<{ record: Record<string, unknown> }>(
      `/projects/${projectId}/tables/${tableName}/data/${id}`, data
    ),

  updateField: (projectId: string, tableName: string, id: string, field: string, value: unknown) =>
    api.request<{ record: Record<string, unknown> }>(
      `/projects/${projectId}/tables/${tableName}/data/${id}/field`,
      { method: 'PATCH', body: { field, value } }
    ),

  delete: (projectId: string, tableName: string, id: string) =>
    api.delete(`/projects/${projectId}/tables/${tableName}/data/${id}`),

  bulkDelete: (projectId: string, tableName: string, ids: string[]) =>
    api.post<{ deleted: number }>(
      `/projects/${projectId}/tables/${tableName}/data/bulk-delete`, { ids }
    ),

  bulkUpdate: (projectId: string, tableName: string, ids: string[], field: string, value: unknown) =>
    api.post<{ updated: number }>(
      `/projects/${projectId}/tables/${tableName}/data/bulk-update`, { ids, field, value }
    ),

  import: (projectId: string, tableName: string, records: Record<string, unknown>[]) =>
    api.post<{ inserted: number; errors: { index: number; error: string }[]; total: number }>(
      `/projects/${projectId}/tables/${tableName}/import`, { records }
    ),

  export: (projectId: string, tableName: string, filters?: FilterCondition[]) => {
    const qs = filters?.length ? `?filters=${encodeURIComponent(JSON.stringify(filters))}` : '';
    return api.get<{ records: Record<string, unknown>[] }>(
      `/projects/${projectId}/tables/${tableName}/export${qs}`
    );
  },

  restore: (projectId: string, tableName: string, id: string) =>
    api.post<{ record: Record<string, unknown> }>(
      `/projects/${projectId}/tables/${tableName}/data/${id}/restore`
    ),

  permanentDelete: (projectId: string, tableName: string, id: string) =>
    api.delete(`/projects/${projectId}/tables/${tableName}/data/${id}/permanent`),

  getHistory: (projectId: string, tableName: string, id: string) =>
    api.get<{ history: Record<string, unknown>[] }>(
      `/projects/${projectId}/tables/${tableName}/data/${id}/history`
    ),

  // RLS Rules
  listRLSRules: (projectId: string) =>
    api.get<{ rules: RLSRule[] }>(`/projects/${projectId}/rls`),

  createRLSRule: (projectId: string, data: Omit<RLSRule, 'id' | 'project_id' | 'is_active' | 'created_at'>) =>
    api.post<{ rule: RLSRule }>(`/projects/${projectId}/rls`, data),

  deleteRLSRule: (projectId: string, ruleId: string) =>
    api.delete(`/projects/${projectId}/rls/${ruleId}`),

  // Validation Rules
  listValidationRules: (projectId: string, tableName: string) =>
    api.get<{ rules: ValidationRule[] }>(`/projects/${projectId}/tables/${tableName}/validations`),

  createValidationRule: (projectId: string, tableName: string, data: {
    column_name?: string | null;
    rule_type: string;
    config: Record<string, unknown>;
    error_message: string;
  }) => api.post<{ rule: ValidationRule }>(`/projects/${projectId}/tables/${tableName}/validations`, data),

  deleteValidationRule: (projectId: string, tableName: string, ruleId: string) =>
    api.delete(`/projects/${projectId}/tables/${tableName}/validations/${ruleId}`),

  // Seeding
  seedTable: (projectId: string, tableName: string, data: {
    count: number;
    generators: Record<string, string>;
  }) => api.post<{ inserted: number; total: number }>(
    `/projects/${projectId}/tables/${tableName}/seed`, data
  ),

  // Batch operations
  batch: (projectId: string, operations: BatchOperation[], transaction = false) =>
    api.post<{ results: BatchResult[] }>(
      `/projects/${projectId}/batch`, { operations, transaction }
    ),

  // Files
  listFiles: (projectId: string, tableName: string, recordId: string) =>
    api.get<{ files: FileRecord[] }>(`/projects/${projectId}/files?table=${tableName}&record=${recordId}`),

  deleteFile: (projectId: string, fileId: string) =>
    api.delete(`/projects/${projectId}/files/${fileId}`),
};

export interface ValidationRule {
  id: string;
  project_id: string;
  table_name: string;
  column_name: string | null;
  rule_type: string;
  config: Record<string, unknown>;
  error_message: string;
  is_active: boolean;
  created_at: string;
}

export interface FileRecord {
  id: string;
  project_id: string;
  table_name: string;
  record_id: string;
  column_name: string;
  original_name: string;
  mime_type: string;
  size: number;
  storage_path: string;
  created_at: string;
}

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

export interface RLSRule {
  id: string;
  project_id: string;
  table_name: string;
  column_name: string;
  operator: string;
  value_source: string;
  value_static: string | null;
  is_active: boolean;
  created_at: string;
}
