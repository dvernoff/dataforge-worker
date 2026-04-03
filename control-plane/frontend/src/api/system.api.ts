import { api } from './client';

export const systemApi = {
  getAllUsers: () =>
    api.get<{ users: Record<string, unknown>[] }>('/users'),

  getUser: (userId: string) =>
    api.get<{ user: Record<string, unknown> }>(`/users/${userId}`),

  createUser: (data: { email: string; password: string; name: string; is_superadmin?: boolean }) =>
    api.post<{ user: Record<string, unknown> }>('/users', data),

  assignRole: (userId: string, roleId: string | null) =>
    api.post<{ user: Record<string, unknown> }>(`/users/${userId}/assign-role`, { role_id: roleId }),

  getUserProjects: (userId: string) =>
    api.get<{ projects: { project_id: string; project_name: string; project_slug: string; role: string; joined_at: string }[] }>(`/users/${userId}/projects`),

  promoteUser: (userId: string) =>
    api.post<{ user: Record<string, unknown> }>(`/users/${userId}/promote`),

  demoteUser: (userId: string) =>
    api.post<{ user: Record<string, unknown> }>(`/users/${userId}/demote`),

  deactivateUser: (userId: string) =>
    api.post<{ user: Record<string, unknown> }>(`/users/${userId}/deactivate`),

  blockUser: (userId: string, reason?: string) =>
    api.post<{ user: Record<string, unknown> }>(`/users/${userId}/block`, { reason }),

  unblockUser: (userId: string) =>
    api.post<{ user: Record<string, unknown> }>(`/users/${userId}/unblock`),

  resetPassword: (userId: string) =>
    api.post<{ password: string }>(`/users/${userId}/reset-password`),

  deleteUser: (userId: string) =>
    api.delete(`/users/${userId}`),
};
