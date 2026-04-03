import { api } from './client';

export interface Widget {
  id: string;
  type: 'number' | 'chart' | 'table' | 'text';
  title: string;
  sql?: string;
  config?: Record<string, unknown>;
  content?: string;
}

export interface Dashboard {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  widgets: Widget[];
  layout: Record<string, unknown>;
  is_public: boolean;
  public_slug: string | null;
  created_by: string;
  created_at: string;
}

export const dashboardsApi = {
  list: (projectId: string) =>
    api.get<{ dashboards: Dashboard[] }>(`/projects/${projectId}/dashboards`),

  getById: (projectId: string, dashboardId: string) =>
    api.get<{ dashboard: Dashboard }>(`/projects/${projectId}/dashboards/${dashboardId}`),

  create: (projectId: string, data: { name: string; description?: string }) =>
    api.post<{ dashboard: Dashboard }>(`/projects/${projectId}/dashboards`, data),

  update: (projectId: string, dashboardId: string, data: Partial<Dashboard>) =>
    api.put<{ dashboard: Dashboard }>(`/projects/${projectId}/dashboards/${dashboardId}`, data),

  delete: (projectId: string, dashboardId: string) =>
    api.delete(`/projects/${projectId}/dashboards/${dashboardId}`),

  execute: (projectId: string, dashboardId: string) =>
    api.post<{ results: Record<string, Record<string, unknown>> }>(`/projects/${projectId}/dashboards/${dashboardId}/execute`),
};
