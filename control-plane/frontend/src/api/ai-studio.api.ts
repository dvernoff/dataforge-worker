import { api } from './client';

export const aiStudioApi = {
  listEndpoints: (projectId: string) =>
    api.get<{ endpoints: Record<string, unknown>[] }>(`/projects/${projectId}/ai-studio/endpoints`),

  getEndpoint: (projectId: string, id: string) =>
    api.get<{ endpoint: Record<string, unknown> }>(`/projects/${projectId}/ai-studio/endpoints/${id}`),

  createEndpoint: (projectId: string, data: Record<string, unknown>) =>
    api.post<{ endpoint: Record<string, unknown> }>(`/projects/${projectId}/ai-studio/endpoints`, data),

  updateEndpoint: (projectId: string, id: string, data: Record<string, unknown>) =>
    api.put<{ endpoint: Record<string, unknown> }>(`/projects/${projectId}/ai-studio/endpoints/${id}`, data),

  deleteEndpoint: (projectId: string, id: string) =>
    api.delete(`/projects/${projectId}/ai-studio/endpoints/${id}`),

  testEndpoint: (projectId: string, id: string, input: Record<string, unknown>) =>
    api.post<Record<string, unknown>>(`/projects/${projectId}/ai-studio/endpoints/${id}/test`, input),

  getLogs: (projectId: string, params?: { limit?: number; offset?: number; endpointId?: string }) => {
    const q = new URLSearchParams();
    if (params?.limit) q.set('limit', String(params.limit));
    if (params?.offset) q.set('offset', String(params.offset));
    if (params?.endpointId) q.set('endpointId', params.endpointId);
    return api.get<{ logs: Record<string, unknown>[] }>(`/projects/${projectId}/ai-studio/logs?${q}`);
  },

  getStats: (projectId: string) =>
    api.get<{
      total_calls: number;
      by_provider: { provider: string; count: string }[];
      by_status: { status: string; count: string }[];
      avg_duration_ms: number;
      total_tokens: number;
    }>(`/projects/${projectId}/ai-studio/stats`),
};
