import { api } from './client';
import { useAuthStore } from '@/stores/auth.store';

export interface Backup {
  id: string;
  project_id: string;
  type: 'manual' | 'scheduled';
  status: 'pending' | 'running' | 'completed' | 'failed';
  file_path: string | null;
  file_size: number | null;
  encryption_key_hash: string | null;
  error: string | null;
  metadata: string | null;
  created_by: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface BackupSchedule {
  id: string;
  project_id: string;
  cron_expression: string | null;
  is_active: boolean;
  max_backups: number;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
}

export const backupsApi = {
  list: (projectId: string) =>
    api.get<{ backups: Backup[] }>(`/projects/${projectId}/backups`),

  create: (projectId: string, tables?: string[]) =>
    api.post<{ backup: Backup }>(`/projects/${projectId}/backups`, { tables }),

  delete: (projectId: string, backupId: string) =>
    api.delete(`/projects/${projectId}/backups/${backupId}`),

  download: async (projectId: string, backupId: string) => {
    const token = useAuthStore.getState().accessToken;
    const response = await fetch(`/api/projects/${projectId}/backups/${backupId}/download`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: 'include',
    });
    if (!response.ok) throw new Error('Download failed');
    const blob = await response.blob();
    const disposition = response.headers.get('Content-Disposition');
    const match = disposition?.match(/filename="(.+)"/);
    const filename = match?.[1] ?? `backup_${backupId}.json`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  restore: (projectId: string, backupId: string) =>
    api.post<{ success: boolean }>(`/projects/${projectId}/backups/${backupId}/restore`),

  getSchedule: (projectId: string) =>
    api.get<{ schedule: BackupSchedule | null }>(`/projects/${projectId}/backups/schedule`),

  updateSchedule: (projectId: string, data: {
    cron_expression?: string;
    is_active?: boolean;
    max_backups?: number;
  }) =>
    api.put<{ schedule: BackupSchedule }>(`/projects/${projectId}/backups/schedule`, data),
};
