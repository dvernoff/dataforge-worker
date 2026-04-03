import type Redis from 'ioredis';
import crypto from 'crypto';

export class CacheService {
  constructor(private redis: Redis) {}

  private buildKey(projectSlug: string, endpointId: string, params: Record<string, unknown>): string {
    const paramHash = crypto.createHash('md5').update(JSON.stringify(params)).digest('hex');
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
    await this.redis.setex(key, ttl, JSON.stringify(data));
  }

  async invalidateByProject(projectSlug: string): Promise<void> {
    const pattern = `cache:${projectSlug}:*`;
    const keys = await this.redis.keys(pattern);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }

  async invalidateByEndpoint(projectSlug: string, endpointId: string): Promise<void> {
    // Try exact slug match first, then wildcard fallback
    const pattern = `cache:${projectSlug}:${endpointId}:*`;
    let keys = await this.redis.keys(pattern);
    if (keys.length === 0) {
      // Fallback: match any slug for this endpoint
      keys = await this.redis.keys(`cache:*:${endpointId}:*`);
    }
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }
}
