import { api } from './client';
import type { WorkerNode, CreateNodeInput, UpdateNodeInput } from '@shared/types/node.types';

export const nodesApi = {
  list: () =>
    api.get<{ nodes: WorkerNode[]; latestWorkerVersion?: string | null }>('/nodes'),

  getById: (nodeId: string) =>
    api.get<{ node: WorkerNode }>(`/nodes/${nodeId}`),

  create: (data: CreateNodeInput) =>
    api.post<{ node: WorkerNode; setup_token: string; token_expires: string }>('/nodes', data),

  update: (nodeId: string, data: UpdateNodeInput) =>
    api.put<{ node: WorkerNode }>(`/nodes/${nodeId}`, data),

  delete: (nodeId: string) =>
    api.delete(`/nodes/${nodeId}`),

  regenerateToken: (nodeId: string) =>
    api.post<{ setup_token: string; token_expires: string }>(`/nodes/${nodeId}/regenerate-token`),

  // Personal nodes
  listPersonal: () =>
    api.get<{ nodes: WorkerNode[] }>('/nodes/personal'),

  createPersonal: (data: { name: string; region?: string; update_mode?: string }) =>
    api.post<{ node: WorkerNode; setup_token: string; token_expires: string }>('/nodes/personal', data),

  deletePersonal: (nodeId: string) =>
    api.delete(`/nodes/personal/${nodeId}`),

  // Update triggers
  triggerUpdate: (nodeId: string) =>
    api.post<{ status: string }>(`/nodes/${nodeId}/update`),

  triggerPersonalUpdate: (nodeId: string) =>
    api.post<{ status: string }>(`/nodes/personal/${nodeId}/update`),

  bulkUpdate: (type: 'system' | 'personal') =>
    api.post<{ triggered: string[]; skipped: string[] }>('/nodes/bulk-update', { type }),
};
