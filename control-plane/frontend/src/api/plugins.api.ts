import { api } from './client';

export const pluginsApi = {
  list: (projectId: string) =>
    api.get<{ plugins: Record<string, unknown>[] }>(`/projects/${projectId}/plugins`),

  listCpPlugins: () =>
    api.get<{ plugins: Record<string, unknown>[] }>('/cp-plugins'),

  enable: (projectId: string, pluginId: string, settings: Record<string, unknown>) =>
    api.post<{ instance: Record<string, unknown> }>(`/projects/${projectId}/plugins/${pluginId}/enable`, { settings }),

  disable: (projectId: string, pluginId: string) =>
    api.post<{ instance: Record<string, unknown> }>(`/projects/${projectId}/plugins/${pluginId}/disable`),

  getSettings: (projectId: string, pluginId: string) =>
    api.get<{ settings: Record<string, unknown>; is_enabled: boolean }>(`/projects/${projectId}/plugins/${pluginId}/settings`),

  updateSettings: (projectId: string, pluginId: string, settings: Record<string, unknown>) =>
    api.put<{ instance: Record<string, unknown> }>(`/projects/${projectId}/plugins/${pluginId}/settings`, { settings }),
};
