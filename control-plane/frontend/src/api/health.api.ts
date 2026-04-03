import { api } from './client';

export const healthApi = {
  getDetailed: () =>
    api.get<{
      controlPlane: Record<string, unknown>;
      workers: Array<{
        nodeId: string;
        nodeName: string;
        nodeUrl: string;
        status: string;
        health: Record<string, unknown> | null;
        error?: string;
      }>;
      totalProjects: number;
    }>('/health/detailed'),
};
