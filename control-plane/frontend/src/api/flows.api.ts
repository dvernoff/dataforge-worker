import { api } from './client';

export const flowsApi = {
  list: (projectId: string) =>
    api.get<{ flows: Record<string, unknown>[] }>(`/projects/${projectId}/flows`),

  getById: (projectId: string, flowId: string) =>
    api.get<{ flow: Record<string, unknown>; runs: Record<string, unknown>[] }>(`/projects/${projectId}/flows/${flowId}`),

  create: (projectId: string, data: Record<string, unknown>) =>
    api.post<{ flow: Record<string, unknown> }>(`/projects/${projectId}/flows`, data),

  update: (projectId: string, flowId: string, data: Record<string, unknown>) =>
    api.put<{ flow: Record<string, unknown> }>(`/projects/${projectId}/flows/${flowId}`, data),

  delete: (projectId: string, flowId: string) =>
    api.delete(`/projects/${projectId}/flows/${flowId}`),

  run: (projectId: string, flowId: string, triggerData?: Record<string, unknown>) =>
    api.post<{ result: Record<string, unknown> }>(`/projects/${projectId}/flows/${flowId}/run`, triggerData),

  getRuns: (projectId: string, flowId: string) =>
    api.get<{ runs: Record<string, unknown>[] }>(`/projects/${projectId}/flows/${flowId}/runs`),
};
