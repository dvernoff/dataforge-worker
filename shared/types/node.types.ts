export interface WorkerNode {
  id: string;
  name: string;
  slug: string;
  url: string;
  region: string;
  status: 'online' | 'offline' | 'maintenance';
  is_local: boolean;
  max_projects: number;
  projects_count?: number;
  cpu_usage: number;
  ram_usage: number;
  disk_usage: number;
  disk_total_gb?: number;
  disk_free_gb?: number;
  last_heartbeat: string | null;
  api_key_hash: string;
  created_at: string;
  updated_at: string;
  // Self-hosted node fields
  owner_id?: string | null;
  is_system?: boolean;
  current_version?: string | null;
  update_mode?: string;
  update_status?: 'idle' | 'updating' | 'failed';
  setup_token?: string | null;
  setup_token_expires?: string | null;
}

export interface CreateNodeInput {
  name: string;
  slug: string;
  url?: string;
  region?: string;
  is_local?: boolean;
  max_projects?: number;
}

export interface UpdateNodeInput {
  name?: string;
  url?: string;
  region?: string;
  status?: 'online' | 'offline' | 'maintenance';
  max_projects?: number;
}

export interface HeartbeatPayload {
  cpu_usage: number;
  ram_usage: number;
  disk_usage: number;
  disk_total_gb?: number;
  disk_free_gb?: number;
  active_connections: number;
  request_count: number;
  current_version?: string;
}

export const PROXY_HEADERS = {
  NODE_API_KEY: 'x-node-api-key',
  PROJECT_ID: 'x-project-id',
  PROJECT_SCHEMA: 'x-project-schema',
  USER_ID: 'x-user-id',
  USER_ROLE: 'x-user-role',
} as const;
