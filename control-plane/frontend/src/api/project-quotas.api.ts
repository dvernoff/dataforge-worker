import { api } from './client';

export const projectQuotasApi = {
  getProjectQuota: (projectId: string) =>
    api.get<{ quota: Record<string, number>; usage: Record<string, number>; source: string; plan_name?: string; plan_color?: string }>(`/projects/${projectId}/quotas`),

  setProjectQuota: (projectId: string, data: Record<string, number>) =>
    api.put(`/projects/${projectId}/quotas`, data),

  deleteProjectQuota: (projectId: string) =>
    api.delete(`/projects/${projectId}/quotas`),

  assignPlan: (projectId: string, planId: string) =>
    api.put(`/projects/${projectId}/plan`, { plan_id: planId }),
};

export const projectPlansApi = {
  list: () =>
    api.get<{ plans: Array<{ id: string; name: string; color: string; description?: string; projects_count: number; [key: string]: unknown }> }>('/system/project-plans'),

  create: (data: Record<string, unknown>) =>
    api.post<{ plan: Record<string, unknown> }>('/system/project-plans', data),

  update: (id: string, data: Record<string, unknown>) =>
    api.put<{ plan: Record<string, unknown> }>(`/system/project-plans/${id}`, data),

  delete: (id: string) =>
    api.delete(`/system/project-plans/${id}`),
};
