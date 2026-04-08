import { api } from './client';

export interface AnalyticsSummary {
  totalRequests: number;
  avgResponseTime: number;
  errorRate: number;
  uniqueIps: number;
  topEndpoint: string | null;
}

export interface RequestLog {
  id: string;
  project_id: string;
  endpoint_id: string | null;
  method: string;
  path: string;
  status_code: number;
  response_time_ms: number;
  ip_address: string;
  user_agent: string;
  error: string | null;
  created_at: string;
}

export interface TopEndpoint {
  method: string;
  path: string;
  requestCount: number;
  avgResponseTime: number;
}

export const analyticsApi = {
  getSummary: (projectId: string) =>
    api.get<AnalyticsSummary>(`/projects/${projectId}/analytics/summary`),

  getRequests: (projectId: string, params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return api.get<{ requests: RequestLog[]; total: number; page: number; limit: number }>(
      `/projects/${projectId}/analytics/requests${qs}`
    );
  },

  getTopEndpoints: (projectId: string, days = 7) =>
    api.get<{ endpoints: TopEndpoint[] }>(
      `/projects/${projectId}/analytics/top-endpoints?days=${days}`
    ),

  getSlowQueries: (projectId: string) =>
    api.get<{ requests: RequestLog[] }>(
      `/projects/${projectId}/analytics/slow-queries`
    ),

  getDailyStats: (projectId: string, days = 7) =>
    api.get<{ stats: { day: string; total: number; success: number; errors: number }[] }>(
      `/projects/${projectId}/analytics/daily-stats?days=${days}`
    ),

  getStatusBreakdown: (projectId: string, days = 7) =>
    api.get<Record<string, number>>(
      `/projects/${projectId}/analytics/status-breakdown?days=${days}`
    ),

  getCacheStats: (projectId: string, days = 7) =>
    api.get<Record<string, number>>(
      `/projects/${projectId}/analytics/cache-stats?days=${days}`
    ),
};
