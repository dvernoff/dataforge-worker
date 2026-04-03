import { api } from './client';
import type { ApiEndpoint } from '@shared/types/api.types';

export const endpointsApi = {
  list: (projectId: string) =>
    api.get<{ endpoints: ApiEndpoint[] }>(`/projects/${projectId}/endpoints`),

  getById: (projectId: string, endpointId: string) =>
    api.get<{ endpoint: ApiEndpoint }>(`/projects/${projectId}/endpoints/${endpointId}`),

  create: (projectId: string, data: Record<string, unknown>) =>
    api.post<{ endpoint: ApiEndpoint }>(`/projects/${projectId}/endpoints`, data),

  update: (projectId: string, endpointId: string, data: Record<string, unknown>) =>
    api.put<{ endpoint: ApiEndpoint }>(`/projects/${projectId}/endpoints/${endpointId}`, data),

  delete: (projectId: string, endpointId: string) =>
    api.delete(`/projects/${projectId}/endpoints/${endpointId}`),

  toggle: (projectId: string, endpointId: string) =>
    api.post<{ endpoint: ApiEndpoint }>(`/projects/${projectId}/endpoints/${endpointId}/toggle`),

  createVersion: (projectId: string, endpointId: string) =>
    api.post<{ endpoint: ApiEndpoint }>(`/projects/${projectId}/endpoints/${endpointId}/version`),

  test: (projectId: string, endpointId: string, testData: Record<string, unknown>) =>
    api.post<{ status: number; data?: unknown; error?: string; duration_ms: number }>(
      `/projects/${projectId}/endpoints/${endpointId}/test`, testData
    ),

  getOpenApiSpec: (projectId: string) =>
    api.get<Record<string, unknown>>(`/projects/${projectId}/openapi-spec`),
};
