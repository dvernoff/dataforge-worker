import type Redis from 'ioredis';
import crypto from 'crypto';

/**
 * Stable JSON serializer: sorts object keys at every depth so that
 * { a: 1, b: 2 } and { b: 2, a: 1 } produce the same output.
 *
 * NOTE: we cannot use JSON.stringify(value, keyArray) for this — that signature
 * is a *key filter* that applies recursively and drops any key not in the array,
 * including inside nested objects. That was the original bug here: passing the
 * top-level keys as the replacer erased all nested query parameters, so every
 * request with the same top-level shape produced an identical cache key.
 */
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}

/**
 * Resolves a user-supplied cache key template against the request params.
 *
 * Syntax: `{{dotted.path}}` placeholders, dot-separated lookup into `params`.
 *   "{{path}}:{{query.q}}:{{query.limit}}"       — include specific fields
 *   "{{method}}:{{path}}"                        — less granular
 *   "{{query.tenant_id}}"                        — vary by tenant only
 *   "v1"                                         — single shared slot (fully static)
 *
 * Rules:
 *   - Missing paths resolve to empty string (so `{{query.nonexistent}}` is "").
 *   - Null values resolve to the literal "null".
 *   - Object/array values are stable-stringified so nested params stay stable.
 *   - The resolved template is always prefixed with "tpl:" + template source so
 *     two different templates that happen to resolve to the same string do NOT
 *     collide, and a static template still differs from the no-template default.
 */
function resolveTemplate(template: string, params: Record<string, unknown>): string {
  const body = template.replace(/\{\{([^}]+)\}\}/g, (_, path: string) => {
    const parts = path.trim().split('.');
    let v: unknown = params;
    for (const p of parts) {
      if (v === null || typeof v !== 'object') return '';
      v = (v as Record<string, unknown>)[p];
    }
    if (v === undefined) return '';
    if (v === null) return 'null';
    if (typeof v === 'object') return stableStringify(v);
    return String(v);
  });
  // Tag with the template source so different templates hash differently,
  // even if they both resolve to e.g. "" against a given request.
  return `tpl:${template}:${body}`;
}

export class CacheService {
  constructor(private redis: Redis) {}

  private buildKey(
    projectSlug: string,
    endpointId: string,
    params: Record<string, unknown>,
    template?: string | null,
  ): string {
    const serialized = template ? resolveTemplate(template, params) : stableStringify(params);
    const paramHash = crypto.createHash('md5').update(serialized).digest('hex');
    return `cache:${projectSlug}:${endpointId}:${paramHash}`;
  }

  async get(
    projectSlug: string,
    endpointId: string,
    params: Record<string, unknown>,
    template?: string | null,
  ): Promise<unknown | null> {
    const key = this.buildKey(projectSlug, endpointId, params, template);
    const cached = await this.redis.get(key);
    if (!cached) return null;
    return JSON.parse(cached);
  }

  async getWithTtl(
    projectSlug: string,
    endpointId: string,
    params: Record<string, unknown>,
    template?: string | null,
  ): Promise<{ data: unknown; ttl_seconds: number } | null> {
    const key = this.buildKey(projectSlug, endpointId, params, template);
    const [cached, ttl] = await Promise.all([this.redis.get(key), this.redis.ttl(key)]);
    if (!cached) return null;
    return { data: JSON.parse(cached), ttl_seconds: ttl };
  }

  async set(
    projectSlug: string,
    endpointId: string,
    params: Record<string, unknown>,
    data: unknown,
    ttl: number,
    template?: string | null,
  ): Promise<void> {
    const key = this.buildKey(projectSlug, endpointId, params, template);
    await this.redis.setex(key, Math.max(5, ttl), JSON.stringify(data));
  }

  private async scanAndDelete(pattern: string): Promise<void> {
    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
      cursor = nextCursor;
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } while (cursor !== '0');
  }

  async invalidateByProject(projectSlug: string): Promise<void> {
    await this.scanAndDelete(`cache:${projectSlug}:*`);
  }

  async invalidateByEndpoint(projectSlug: string, endpointId: string): Promise<void> {
    await this.scanAndDelete(`cache:${projectSlug}:${endpointId}:*`);
  }
}
