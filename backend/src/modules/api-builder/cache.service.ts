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

export class CacheService {
  constructor(private redis: Redis) {}

  private buildKey(projectSlug: string, endpointId: string, params: Record<string, unknown>): string {
    const serialized = stableStringify(params);
    const paramHash = crypto.createHash('md5').update(serialized).digest('hex');
    return `cache:${projectSlug}:${endpointId}:${paramHash}`;
  }

  async get(projectSlug: string, endpointId: string, params: Record<string, unknown>): Promise<unknown | null> {
    const key = this.buildKey(projectSlug, endpointId, params);
    const cached = await this.redis.get(key);
    if (!cached) return null;
    return JSON.parse(cached);
  }

  async getWithTtl(projectSlug: string, endpointId: string, params: Record<string, unknown>): Promise<{ data: unknown; ttl_seconds: number } | null> {
    const key = this.buildKey(projectSlug, endpointId, params);
    const [cached, ttl] = await Promise.all([this.redis.get(key), this.redis.ttl(key)]);
    if (!cached) return null;
    return { data: JSON.parse(cached), ttl_seconds: ttl };
  }

  async set(projectSlug: string, endpointId: string, params: Record<string, unknown>, data: unknown, ttl: number): Promise<void> {
    const key = this.buildKey(projectSlug, endpointId, params);
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
