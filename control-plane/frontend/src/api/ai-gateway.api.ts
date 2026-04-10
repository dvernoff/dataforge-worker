import { api } from './client';

export const aiGatewayApi = {
  getStatus: (projectId: string) =>
    api.get<{
      rest_gateway: { enabled: boolean };
      mcp_server: { enabled: boolean };
      last_24h_calls: number;
    }>(`/projects/${projectId}/ai-gateway/status`),

  getActivity: (projectId: string, limit = 50) =>
    api.get<{
      activity: {
        id: string;
        gateway_type: string;
        tool_name: string;
        response_status: number;
        duration_ms: number;
        created_at: string;
      }[];
    }>(`/projects/${projectId}/ai-gateway/activity?limit=${limit}`),

  getStats: (projectId: string) =>
    api.get<{
      total_calls: number;
      by_tool: { tool_name: string; count: string }[];
      by_gateway: { gateway_type: string; count: string }[];
      avg_duration_ms: number;
    }>(`/projects/${projectId}/ai-gateway/stats`),
};
