import { api } from './client';

export const quotasApi = {
  getDefaults: () => api.get<{ quotas: Record<string, number> }>('/quotas/defaults'),
  updateDefaults: (data: Record<string, number>) => api.put<{ quotas: Record<string, number> }>('/quotas/defaults', data),
  getUserQuota: (userId: string) => api.get<{ quota: Record<string, number>; usage: Record<string, number> }>(`/quotas/users/${userId}`),
  setUserQuota: (userId: string, data: Record<string, number>) => api.put(`/quotas/users/${userId}`, data),
  deleteUserQuota: (userId: string) => api.delete(`/quotas/users/${userId}`),
  getMyQuota: () => api.get<{ quota: Record<string, number>; usage: Record<string, number> }>('/quotas/me'),
};
