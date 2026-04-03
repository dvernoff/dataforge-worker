import { api } from './client';

export const auditApi = {
  getByProject: (projectId: string, params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return api.get<{ data: Record<string, unknown>[]; pagination: Record<string, number> }>(
      `/projects/${projectId}/audit${qs}`
    );
  },

  getGlobal: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return api.get<{ data: Record<string, unknown>[]; pagination: Record<string, number> }>(
      `/projects/system/audit${qs}`
    );
  },
};
