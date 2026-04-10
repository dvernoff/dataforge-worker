export interface AiStudioEndpoint {
  id: string;
  name: string;
  slug: string;
  provider: 'openai' | 'deepseek' | 'claude';
  model: string;
  api_key: string | null;
  system_prompt: string | null;
  response_format: Record<string, unknown> | null;
  temperature: number;
  max_tokens: number;
  context_enabled: boolean;
  context_ttl_minutes: number;
  max_context_messages: number;
  max_tokens_per_session: number;
  validation_rules: Record<string, unknown> | null;
  retry_on_invalid: boolean;
  max_retries: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateEndpointInput {
  name: string;
  slug?: string;
  provider: string;
  model: string;
  api_key?: string;
  system_prompt?: string;
  response_format?: Record<string, unknown>;
  temperature?: number;
  max_tokens?: number;
  context_enabled?: boolean;
  context_ttl_minutes?: number;
  max_context_messages?: number;
  max_tokens_per_session?: number;
  validation_rules?: Record<string, unknown>;
  retry_on_invalid?: boolean;
  max_retries?: number;
}

export interface UpdateEndpointInput extends Partial<CreateEndpointInput> {
  is_active?: boolean;
}

export interface CallEndpointInput {
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  input?: string;
  session_id?: string;
}

export interface AiStudioLog {
  id: string;
  endpoint_id: string;
  provider: string;
  model: string;
  input_messages: unknown;
  output: unknown;
  tokens_used: number;
  duration_ms: number;
  status: 'success' | 'error' | 'validation_failed';
  error: string | null;
  created_at: string;
}

export interface AiStudioContext {
  id: string;
  endpoint_id: string;
  session_id: string;
  messages: Array<{ role: string; content: string }>;
  created_at: string;
  updated_at: string;
}

export const PROVIDER_MODELS: Record<string, string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo', 'o1', 'o1-mini', 'o3-mini'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  claude: ['claude-sonnet-4-20250514', 'claude-haiku-4-20250414', 'claude-opus-4-20250514'],
};
