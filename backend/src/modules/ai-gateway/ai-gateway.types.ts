export interface AiGatewayLogEntry {
  project_id: string;
  gateway_type: 'rest' | 'mcp';
  tool_name: string;
  request_summary: Record<string, unknown> | null;
  response_status: number;
  duration_ms: number;
}

export interface AiContextResponse {
  project: { slug: string; schema: string };
  tables: AiTableInfo[];
  endpoints: AiEndpointInfo[];
}

export interface AiTableInfo {
  name: string;
  columns: { name: string; type: string; nullable: boolean; default_value: string | null; is_primary: boolean; is_unique: boolean }[];
  indexes: { name: string; type: string; columns: string[]; is_unique: boolean }[];
  foreign_keys: { constraint_name: string; source_column: string; target_table: string; target_column: string; on_delete: string; on_update: string }[];
  row_count: number;
}

export interface AiEndpointInfo {
  id: string;
  method: string;
  path: string;
  description: string | null;
  source_type: string;
  source_config: Record<string, unknown>;
  auth_type: string;
  cache_enabled: boolean;
  cache_ttl: number;
  rate_limit: Record<string, unknown> | null;
  is_active: boolean;
}
