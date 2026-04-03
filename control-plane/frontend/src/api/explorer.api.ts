import { api } from './client';

export interface TableInfo {
  name: string;
  columns: Array<{
    name: string;
    type: string;
    nullable: boolean;
  }>;
}

export interface PivotConfig {
  table: string;
  rows: string[];
  columns?: string;
  values: string;
  aggregation: 'count' | 'sum' | 'avg' | 'min' | 'max';
}

export interface PivotResult {
  rows: Record<string, unknown>[];
  rowCount: number;
  columns: string[];
}

export const explorerApi = {
  getTables: (projectId: string) =>
    api.get<{ tables: TableInfo[] }>(`/projects/${projectId}/explorer/tables`),

  executePivot: (projectId: string, config: PivotConfig) =>
    api.post<PivotResult>(`/projects/${projectId}/explorer/pivot`, config),
};
