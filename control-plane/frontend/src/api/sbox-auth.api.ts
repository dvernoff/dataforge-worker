import { api } from './client';

export interface SboxAuthStats {
  total: number;
  online: number;
  newToday: number;
}

export interface SboxAuthSession {
  [key: string]: unknown;
}

export const sboxAuthApi = {
  getStats: (projectId: string) =>
    api.get<SboxAuthStats>(`/projects/${projectId}/sbox-auth/stats`),

  getSessions: (projectId: string) =>
    api.get<{ sessions: SboxAuthSession[] }>(`/projects/${projectId}/sbox-auth/sessions`),

  getPlayerProfile: (projectId: string, steamId: string) =>
    api.get<{ player: SboxAuthSession }>(`/projects/${projectId}/sbox-auth/sessions/${steamId}`),

  revokeSession: (projectId: string, steamId: string) =>
    api.post<{ success: boolean }>(`/projects/${projectId}/sbox-auth/sessions/${steamId}/revoke`, {}),

  revokeAll: (projectId: string) =>
    api.post<{ revoked: number }>(`/projects/${projectId}/sbox-auth/sessions/revoke-all`, {}),

  cleanup: (projectId: string) =>
    api.post<{ cleaned: number }>(`/projects/${projectId}/sbox-auth/cleanup`, {}),
};
