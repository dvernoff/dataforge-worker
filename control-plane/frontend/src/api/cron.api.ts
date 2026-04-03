import { api } from './client';

export const cronApi = {
  list: (projectId: string) =>
    api.get<{ jobs: Record<string, unknown>[] }>(`/projects/${projectId}/cron`),

  getById: (projectId: string, jobId: string) =>
    api.get<{ job: Record<string, unknown> }>(`/projects/${projectId}/cron/${jobId}`),

  create: (projectId: string, data: Record<string, unknown>) =>
    api.post<{ job: Record<string, unknown> }>(`/projects/${projectId}/cron`, data),

  update: (projectId: string, jobId: string, data: Record<string, unknown>) =>
    api.put<{ job: Record<string, unknown> }>(`/projects/${projectId}/cron/${jobId}`, data),

  delete: (projectId: string, jobId: string) =>
    api.delete(`/projects/${projectId}/cron/${jobId}`),

  toggle: (projectId: string, jobId: string) =>
    api.post<{ job: Record<string, unknown> }>(`/projects/${projectId}/cron/${jobId}/toggle`),

  runNow: (projectId: string, jobId: string) =>
    api.post<{ result: Record<string, unknown> }>(`/projects/${projectId}/cron/${jobId}/run`),

  getRuns: (projectId: string, jobId: string) =>
    api.get<{ runs: Record<string, unknown>[] }>(`/projects/${projectId}/cron/${jobId}/runs`),
};
