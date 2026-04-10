import { api } from './client';
import type { Project, ProjectMember, CreateProjectInput } from '@shared/types/project.types';

interface ProjectsResponse {
  projects: (Project & { user_role?: string; owner_name?: string; members_count?: number })[];
}

interface ProjectResponse {
  project: Project;
}

interface MembersResponse {
  members: (ProjectMember & { email: string; name: string; is_superadmin: boolean; last_login_at: string | null })[];
}

export const projectsApi = {
  list: (all?: boolean) =>
    api.get<ProjectsResponse>(all ? '/projects?all=true' : '/projects'),

  getById: (id: string) =>
    api.get<ProjectResponse>(`/projects/${id}`),

  getBySlug: (slug: string) =>
    api.get<ProjectResponse>(`/projects/by-slug/${slug}`),

  create: (data: CreateProjectInput) =>
    api.post<ProjectResponse>('/projects', data),

  update: (id: string, data: Partial<CreateProjectInput>) =>
    api.put<ProjectResponse>(`/projects/${id}`, data),

  delete: (id: string) =>
    api.delete(`/projects/${id}`),

  disable: (id: string, slug: string, reason?: string) =>
    api.post<ProjectResponse>(`/projects/${id}/disable`, { slug, reason }),

  enable: (id: string) =>
    api.post<ProjectResponse>(`/projects/${id}/enable`),

  getMembers: (projectId: string) =>
    api.get<MembersResponse>(`/projects/${projectId}/members`),

  addMember: (projectId: string, userId: string, role: string) =>
    api.post(`/projects/${projectId}/members`, { userId, role }),

  updateMemberRole: (projectId: string, userId: string, role: string) =>
    api.put(`/projects/${projectId}/members/${userId}`, { role }),

  removeMember: (projectId: string, userId: string) =>
    api.delete(`/projects/${projectId}/members/${userId}`),
};
