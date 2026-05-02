export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiRequest {
  messages: AiMessage[];
  model: string;
  temperature: number;
  max_tokens: number;
  json_mode?: boolean;
}

export interface AiResponse {
  content: string;
  tokens_used: number;
  model: string;
  finish_reason: string;
}

async function callOpenAI(apiKey: string, req: AiRequest): Promise<AiResponse> {
  const body: Record<string, unknown> = {
    model: req.model,
    messages: req.messages,
    temperature: req.temperature,
    max_tokens: req.max_tokens,
  };
  if (req.json_mode) body.response_format = { type: 'json_object' };

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error(`OpenAI error ${res.status}: ${(err.error as Record<string, unknown>)?.message ?? res.statusText}`);
  }

  const data = await res.json() as Record<string, unknown>;
  const choices = data.choices as { message: { content: string }; finish_reason: string }[];
  const usage = data.usage as { total_tokens: number };

  return {
    content: choices[0]?.message?.content ?? '',
    tokens_used: usage?.total_tokens ?? 0,
    model: data.model as string,
    finish_reason: choices[0]?.finish_reason ?? 'stop',
  };
}

async function callDeepSeek(apiKey: string, req: AiRequest): Promise<AiResponse> {
  const body: Record<string, unknown> = {
    model: req.model,
    messages: req.messages,
    temperature: req.temperature,
    max_tokens: req.max_tokens,
  };
  if (req.json_mode) body.response_format = { type: 'json_object' };

  const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error(`DeepSeek error ${res.status}: ${(err.error as Record<string, unknown>)?.message ?? res.statusText}`);
  }

  const data = await res.json() as Record<string, unknown>;
  const choices = data.choices as { message: { content: string }; finish_reason: string }[];
  const usage = data.usage as { total_tokens: number };

  return {
    content: choices[0]?.message?.content ?? '',
    tokens_used: usage?.total_tokens ?? 0,
    model: data.model as string,
    finish_reason: choices[0]?.finish_reason ?? 'stop',
  };
}

async function callClaude(apiKey: string, req: AiRequest): Promise<AiResponse> {
  const systemMsg = req.messages.find(m => m.role === 'system');
  const userMessages = req.messages.filter(m => m.role !== 'system').map(m => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  const body: Record<string, unknown> = {
    model: req.model,
    max_tokens: req.max_tokens,
    messages: userMessages,
  };
  if (systemMsg) body.system = systemMsg.content;
  if (req.temperature !== undefined) body.temperature = req.temperature;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error(`Claude error ${res.status}: ${(err.error as Record<string, unknown>)?.message ?? res.statusText}`);
  }

  const data = await res.json() as Record<string, unknown>;
  const content = data.content as { type: string; text: string }[];
  const usage = data.usage as { input_tokens: number; output_tokens: number };

  return {
    content: content?.[0]?.text ?? '',
    tokens_used: (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0),
    model: data.model as string,
    finish_reason: data.stop_reason as string ?? 'end_turn',
  };
}

export async function callProvider(provider: string, apiKey: string, req: AiRequest): Promise<AiResponse> {
  switch (provider) {
    case 'openai': return callOpenAI(apiKey, req);
    case 'deepseek': return callDeepSeek(apiKey, req);
    case 'claude': return callClaude(apiKey, req);
    default: throw new Error(`Unknown provider: ${provider}. Supported: openai, deepseek, claude`);
  }
}
