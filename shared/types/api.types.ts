import { z } from 'zod';

export const endpointSourceTypes = ['table', 'custom_sql', 'composite'] as const;
export const httpMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export const authTypes = ['public', 'api_token'] as const;

export const createEndpointSchema = z.object({
  method: z.enum(httpMethods),
  path: z.string().min(1).max(500),
  description: z.string().max(1000).optional(),
  tags: z.array(z.string()).optional(),
  source_type: z.enum(endpointSourceTypes),
  source_config: z.record(z.unknown()),
  validation_schema: z.record(z.unknown()).optional(),
  response_config: z.record(z.unknown()).optional(),
  cache_enabled: z.boolean().default(false),
  cache_ttl: z.number().int().min(1).max(86400).default(60),
  cache_key_template: z.string().max(500).optional(),
  cache_invalidation: z.object({
    on_insert: z.boolean().default(true),
    on_update: z.boolean().default(true),
    on_delete: z.boolean().default(true),
  }).optional().nullable(),
  rate_limit: z.object({
    max: z.number().int().min(1),
    window: z.number().int().min(1000),
    per: z.enum(['ip', 'token']).default('ip'),
  }).optional(),
  auth_type: z.enum(authTypes).default('api_token'),
  is_active: z.boolean().default(true),
});

export type CreateEndpointInput = z.infer<typeof createEndpointSchema>;

export interface ApiEndpoint {
  id: string;
  project_id: string;
  method: string;
  path: string;
  description: string | null;
  tags: string[];
  source_type: string;
  source_config: Record<string, unknown>;
  validation_schema: Record<string, unknown> | null;
  response_config: Record<string, unknown> | null;
  cache_enabled: boolean;
  cache_ttl: number;
  cache_key_template: string | null;
  cache_invalidation: { on_insert: boolean; on_update: boolean; on_delete: boolean } | null;
  rate_limit: Record<string, unknown> | null;
  auth_type: string;
  middleware: unknown[];
  version: number;
  deprecated_at: string | null;
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ApiToken {
  id: string;
  project_id: string;
  user_id: string;
  name: string;
  prefix: string;
  scopes: string[];
  allowed_ips: string[] | null;
  is_active: boolean;
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
}
