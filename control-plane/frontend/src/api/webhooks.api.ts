import { api } from './client';

export const webhooksApi = {
  list: (projectId: string) =>
    api.get<{ webhooks: Record<string, unknown>[] }>(`/projects/${projectId}/webhooks`),

  getById: (projectId: string, webhookId: string) =>
    api.get<{ webhook: Record<string, unknown> }>(`/projects/${projectId}/webhooks/${webhookId}`),

  create: (projectId: string, data: Record<string, unknown>) =>
    api.post<{ webhook: Record<string, unknown> }>(`/projects/${projectId}/webhooks`, data),

  update: (projectId: string, webhookId: string, data: Record<string, unknown>) =>
    api.put<{ webhook: Record<string, unknown> }>(`/projects/${projectId}/webhooks/${webhookId}`, data),

  delete: (projectId: string, webhookId: string) =>
    api.delete(`/projects/${projectId}/webhooks/${webhookId}`),

  getLogs: (projectId: string, webhookId: string) =>
    api.get<{ logs: Record<string, unknown>[] }>(`/projects/${projectId}/webhooks/${webhookId}/logs`),
};
