import { z } from 'zod';

export const webhookEvents = ['INSERT', 'UPDATE', 'DELETE'] as const;

export const createWebhookSchema = z.object({
  table_name: z.string().min(1),
  events: z.array(z.enum(webhookEvents)).min(1),
  url: z.string().url().max(2000),
  method: z.enum(['POST', 'PUT', 'PATCH']).default('POST'),
  headers: z.record(z.string()).optional(),
  payload_template: z.record(z.unknown()).optional(),
  secret: z.string().max(255).optional(),
  retry_count: z.number().int().min(0).max(10).default(3),
  is_active: z.boolean().default(true),
});

export type CreateWebhookInput = z.infer<typeof createWebhookSchema>;

export interface Webhook {
  id: string;
  project_id: string;
  table_name: string;
  events: string[];
  url: string;
  method: string;
  headers: Record<string, string>;
  payload_template: Record<string, unknown> | null;
  secret: string | null;
  retry_count: number;
  is_active: boolean;
  created_by: string;
  created_at: string;
}

export interface WebhookLog {
  id: string;
  webhook_id: string;
  event: string;
  payload: Record<string, unknown>;
  response_status: number | null;
  response_body: string | null;
  attempt: number;
  sent_at: string;
  duration_ms: number | null;
}
