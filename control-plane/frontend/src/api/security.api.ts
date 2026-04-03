import { api } from './client';

export const securityApi = {
  get: (projectId: string) =>
    api.get<{ security: Record<string, unknown> }>(`/projects/${projectId}/security`),

  update: (projectId: string, data: Record<string, unknown>) =>
    api.put<{ security: Record<string, unknown> }>(`/projects/${projectId}/security`, data),
};
