import type Redis from 'ioredis';
import crypto from 'crypto';

export class CacheService {
  constructor(private redis: Redis) {}

  private buildKey(projectSlug: string, endpointId: string, params: Record<string, unknown>): string {
    const sorted = JSON.stringify(params, Object.keys(params).sort());
    const paramHash = crypto.createHash('md5').update(sorted).digest('hex');
    return `cache:${projectSlug}:${endpointId}:${paramHash}`;
  }

  async get(projectSlug: string, endpointId: string, params: Record<string, unknown>): Promise<unknown | null> {
    const key = this.buildKey(projectSlug, endpointId, params);
    const cached = await this.redis.get(key);
    if (!cached) return null;
    return JSON.parse(cached);
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
