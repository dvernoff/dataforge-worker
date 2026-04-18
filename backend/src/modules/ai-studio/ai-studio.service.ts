import type { Knex } from 'knex';
import { callProvider, type AiMessage } from './ai-provider.js';
import type { AiStudioEndpoint, CreateEndpointInput, UpdateEndpointInput, CallEndpointInput } from './ai-studio.types.js';

function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export class AiStudioService {
  constructor(private db: Knex) {}

  private t(schema: string, table: string) {
    return `"${schema}"."${table}"`;
  }

  async listEndpoints(schema: string) {
    const rows = await this.db.raw(`SELECT * FROM ${this.t(schema, 'ai_studio_endpoints')} ORDER BY created_at DESC`);
    return rows.rows ?? [];
  }

  async getEndpoint(schema: string, id: string) {
    const rows = await this.db.raw(`SELECT * FROM ${this.t(schema, 'ai_studio_endpoints')} WHERE id = ?`, [id]);
    return rows.rows?.[0] ?? null;
  }

  async getEndpointBySlug(schema: string, slug: string) {
    const rows = await this.db.raw(`SELECT * FROM ${this.t(schema, 'ai_studio_endpoints')} WHERE slug = ?`, [slug]);
    return rows.rows?.[0] ?? null;
  }

  async createEndpoint(schema: string, input: CreateEndpointInput) {
    const slug = input.slug || toSlug(input.name);
    const rows = await this.db.raw(
      `INSERT INTO ${this.t(schema, 'ai_studio_endpoints')}
       (name, slug, provider, model, api_key, system_prompt, response_format, temperature, max_tokens,
        context_enabled, context_ttl_minutes, max_context_messages, max_tokens_per_session, validation_rules, retry_on_invalid, max_retries)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?)
       RETURNING *`,
      [input.name, slug, input.provider, input.model, input.api_key ?? null,
       input.system_prompt ?? null,
       input.response_format ? JSON.stringify(input.response_format) : null,
       input.temperature ?? 0.7, input.max_tokens ?? 1024,
       input.context_enabled ?? false, input.context_ttl_minutes ?? 60,
       input.max_context_messages ?? 50, input.max_tokens_per_session ?? 0,
       input.validation_rules ? JSON.stringify(input.validation_rules) : null,
       input.retry_on_invalid ?? false, input.max_retries ?? 3]
    );
    return rows.rows?.[0];
  }

  async updateEndpoint(schema: string, id: string, input: UpdateEndpointInput) {
    const fields: string[] = [];
    const values: unknown[] = [];

    const ALLOWED_FIELDS = new Set(['name', 'provider', 'model', 'api_key', 'system_prompt', 'response_format', 'temperature', 'max_tokens', 'context_enabled', 'context_ttl_minutes', 'max_context_messages', 'max_tokens_per_session', 'validation_rules', 'retry_on_invalid', 'max_retries', 'is_active']);
    const map: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) {
      if (ALLOWED_FIELDS.has(k)) map[k] = v;
    }

    for (const [key, val] of Object.entries(map)) {
      if (val === undefined) continue;
      if (key === 'response_format' || key === 'validation_rules') {
        fields.push(`${key} = ?::jsonb`);
        values.push(val ? JSON.stringify(val) : null);
      } else {
        fields.push(`${key} = ?`);
        values.push(val);
      }
    }

    if (fields.length === 0) return this.getEndpoint(schema, id);

    fields.push('updated_at = NOW()');
    values.push(id);

    const rows = await this.db.raw(
      `UPDATE ${this.t(schema, 'ai_studio_endpoints')} SET ${fields.join(', ')} WHERE id = ? RETURNING *`,
      values
    );
    return rows.rows?.[0];
  }

  async deleteEndpoint(schema: string, id: string) {
    await this.db.raw(`DELETE FROM ${this.t(schema, 'ai_studio_endpoints')} WHERE id = ?`, [id]);
  }

  async callEndpoint(
    schema: string,
    slug: string,
    input: CallEndpointInput,
    pluginSettings: Record<string, unknown>,
  ) {
    const endpoint = await this.getEndpointBySlug(schema, slug) as AiStudioEndpoint | null;
    if (!endpoint) throw new Error(`Endpoint "${slug}" not found`);
    if (!endpoint.is_active) throw new Error(`Endpoint "${slug}" is disabled`);

    if (endpoint.context_enabled && endpoint.context_ttl_minutes > 0) {
      try {
        await this.db.raw(
          `DELETE FROM ${this.t(schema, 'ai_studio_contexts')} WHERE endpoint_id = ? AND updated_at < NOW() - INTERVAL '${Math.min(endpoint.context_ttl_minutes, 10080)} minutes'`,
          [endpoint.id]
        );
      } catch {}
    }

    const apiKey = endpoint.api_key
      || pluginSettings[{ openai: 'openai_key', deepseek: 'deepseek_key', claude: 'claude_key' }[endpoint.provider] ?? ''] as string;
    if (!apiKey) throw new Error(`API key for provider "${endpoint.provider}" not configured. Set it in the endpoint settings or in AI Studio plugin settings.`);

    const messages: AiMessage[] = [];

    let systemPrompt = endpoint.system_prompt ?? '';
    if (endpoint.response_format) {
      systemPrompt += `\n\nYou MUST respond with valid JSON matching this schema:\n${JSON.stringify(endpoint.response_format)}`;
    }
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });

    let sessionTokensUsed = 0;
    if (endpoint.context_enabled && input.session_id) {
      const ctx = await this.getContext(schema, endpoint.id, input.session_id);
      if (ctx) {
        sessionTokensUsed = ctx.tokens_used ?? 0;
        const maxPerSession = (endpoint as Record<string, unknown>).max_tokens_per_session as number ?? 0;
        if (maxPerSession > 0 && sessionTokensUsed >= maxPerSession) {
          throw new Error(`Token limit reached for this session (${sessionTokensUsed}/${maxPerSession}). Start a new session or wait for TTL reset.`);
        }
        let ctxMessages = ctx.messages as AiMessage[];
        const maxMsgs = (endpoint as Record<string, unknown>).max_context_messages as number ?? 50;
        if (maxMsgs > 0 && ctxMessages.length > maxMsgs) {
          ctxMessages = ctxMessages.slice(-maxMsgs);
        }
        messages.push(...ctxMessages);
      }
    }

    if (input.input) {
      messages.push({ role: 'user', content: input.input });
    } else if (input.messages) {
      messages.push(...input.messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })));
    }

    const start = Date.now();
    let lastError: string | null = null;
    let result: { content: string; tokens_used: number; model: string } | null = null;
    let attempts = 0;
    const maxAttempts = endpoint.retry_on_invalid ? Math.min(endpoint.max_retries, 5) : 1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      attempts++;
      try {
        const resp = await callProvider(endpoint.provider, apiKey, {
          messages,
          model: endpoint.model,
          temperature: endpoint.temperature,
          max_tokens: endpoint.max_tokens,
          json_mode: !!endpoint.response_format || !!(endpoint.validation_rules as Record<string, unknown>)?.json,
        });

        let cleanContent = resp.content.trim();
        const mdMatch = cleanContent.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
        if (mdMatch) cleanContent = mdMatch[1].trim();
        resp.content = cleanContent;

        if (endpoint.validation_rules) {
          const validationError = this.validateResponse(resp.content, endpoint.validation_rules);
          if (validationError) {
            lastError = validationError;
            if (attempt < maxAttempts - 1) {
              messages.push({ role: 'assistant', content: resp.content });
              messages.push({ role: 'user', content: `Your response was invalid: ${validationError}. Please fix and try again.` });
              continue;
            }
          } else {
            lastError = null;
          }
        }

        result = { content: resp.content, tokens_used: resp.tokens_used, model: resp.model };
        break;
      } catch (err) {
        lastError = (err as Error).message;
        if (attempt >= maxAttempts - 1) break;
      }
    }

    const duration = Date.now() - start;
    const status = result ? (lastError ? 'validation_failed' : 'success') : 'error';

    await this.db.raw(
      `INSERT INTO ${this.t(schema, 'ai_studio_logs')}
       (endpoint_id, provider, model, input_messages, output, tokens_used, duration_ms, status, error)
       VALUES (?, ?, ?, ?::jsonb, ?::jsonb, ?, ?, ?, ?)`,
      [endpoint.id, endpoint.provider, endpoint.model,
       JSON.stringify(messages.filter(m => m.role !== 'system')),
       result ? JSON.stringify({ content: result.content }) : null,
       result?.tokens_used ?? 0, duration, status, lastError]
    );

    if (endpoint.context_enabled && input.session_id && result) {
      const userMsg = input.input ? { role: 'user', content: input.input } : (input.messages?.[input.messages.length - 1] ?? null);
      const assistantMsg = { role: 'assistant', content: result.content };
      const maxMsgs = (endpoint as Record<string, unknown>).max_context_messages as number ?? 50;
      await this.upsertContext(schema, endpoint.id, input.session_id, [
        ...(userMsg ? [userMsg] : []),
        assistantMsg,
      ], result.tokens_used, maxMsgs);
    }

    if (!result && lastError) throw new Error(lastError);

    return {
      content: result!.content,
      tokens_used: result!.tokens_used,
      model: result!.model,
      duration_ms: duration,
      attempts,
      ...(lastError ? { validation_warning: lastError } : {}),
    };
  }

  private validateResponse(content: string, rules: Record<string, unknown>): string | null {
    if (rules.json === true || rules.type === 'json') {
      try {
        const parsed = JSON.parse(content);
        if (rules.required_fields && Array.isArray(rules.required_fields)) {
          for (const field of rules.required_fields as string[]) {
            if (!(field in parsed)) return `Missing required field: "${field}"`;
          }
        }
      } catch {
        return 'Response is not valid JSON';
      }
    }
    if (rules.max_length && typeof rules.max_length === 'number' && content.length > rules.max_length) {
      return `Response exceeds max_length (${content.length} > ${rules.max_length})`;
    }
    if (rules.contains && typeof rules.contains === 'string' && !content.includes(rules.contains)) {
      return `Response must contain "${rules.contains}"`;
    }
    return null;
  }

  async getContext(schema: string, endpointId: string, sessionId: string) {
    const rows = await this.db.raw(
      `SELECT * FROM ${this.t(schema, 'ai_studio_contexts')} WHERE endpoint_id = ? AND session_id = ?`,
      [endpointId, sessionId]
    );
    return rows.rows?.[0] ?? null;
  }

  async upsertContext(schema: string, endpointId: string, sessionId: string, newMessages: Array<{ role: string; content: string }>, newTokens = 0, maxMessages = 50) {
    const existing = await this.getContext(schema, endpointId, sessionId);
    let allMessages = [...(existing?.messages ?? []), ...newMessages];
    if (maxMessages > 0 && allMessages.length > maxMessages) {
      allMessages = allMessages.slice(-maxMessages);
    }
    const totalTokens = (existing?.tokens_used ?? 0) + newTokens;

    if (existing) {
      await this.db.raw(
        `UPDATE ${this.t(schema, 'ai_studio_contexts')} SET messages = ?::jsonb, tokens_used = ?, updated_at = NOW() WHERE id = ?`,
        [JSON.stringify(allMessages), totalTokens, existing.id]
      );
    } else {
      await this.db.raw(
        `INSERT INTO ${this.t(schema, 'ai_studio_contexts')} (endpoint_id, session_id, messages, tokens_used) VALUES (?, ?, ?::jsonb, ?)`,
        [endpointId, sessionId, JSON.stringify(allMessages), totalTokens]
      );
    }
  }

  async deleteContext(schema: string, endpointId: string, sessionId: string) {
    await this.db.raw(
      `DELETE FROM ${this.t(schema, 'ai_studio_contexts')} WHERE endpoint_id = ? AND session_id = ?`,
      [endpointId, sessionId]
    );
  }

  async getLogs(schema: string, opts: { endpointId?: string; limit?: number; offset?: number }) {
    const where = opts.endpointId ? 'WHERE endpoint_id = ?' : '';
    const params: unknown[] = opts.endpointId ? [opts.endpointId] : [];
    params.push(opts.limit ?? 50, opts.offset ?? 0);

    const rows = await this.db.raw(
      `SELECT * FROM ${this.t(schema, 'ai_studio_logs')} ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      params
    );
    return rows.rows ?? [];
  }

  async getStats(schema: string) {
    const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const calls24h = await this.db.raw(`SELECT count(*) as count FROM ${this.t(schema, 'ai_studio_logs')} WHERE created_at > ?`, [cutoff24h]);
    const byProvider = await this.db.raw(`SELECT provider, count(*) as count FROM ${this.t(schema, 'ai_studio_logs')} WHERE created_at > ? GROUP BY provider ORDER BY count DESC`, [cutoff24h]);
    const byStatus = await this.db.raw(`SELECT status, count(*) as count FROM ${this.t(schema, 'ai_studio_logs')} WHERE created_at > ? GROUP BY status`, [cutoff24h]);
    const avgDuration = await this.db.raw(`SELECT avg(duration_ms)::integer as avg_ms, sum(tokens_used) as total_tokens FROM ${this.t(schema, 'ai_studio_logs')} WHERE created_at > ?`, [cutoff24h]);

    return {
      calls_24h: Number(calls24h.rows?.[0]?.count ?? 0),
      by_provider: byProvider.rows ?? [],
      by_status: byStatus.rows ?? [],
      avg_duration_ms: Number(avgDuration.rows?.[0]?.avg_ms ?? 0),
      total_tokens: Number(avgDuration.rows?.[0]?.total_tokens ?? 0),
    };
  }
}
