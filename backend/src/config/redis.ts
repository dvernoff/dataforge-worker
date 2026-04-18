import Redis from 'ioredis';
import { env } from './env.js';

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy(times: number) {
    if (times > 10) return null;
    const delay = Math.min(times * 200, 3000);
    return delay;
  },
  connectTimeout: 5000,
  commandTimeout: 5000,
  keepAlive: 30000,
  enableOfflineQueue: true,
  lazyConnect: false,
});

redis.on('error', (err) => {
  console.error('Redis connection error:', err.message);
});

redis.on('reconnecting', () => {
  console.log('Redis reconnecting...');
});

export async function testRedisConnection(): Promise<void> {
  try {
    await redis.ping();
    console.log('Redis connected successfully');
  } catch (error) {
    console.error('Failed to connect to Redis:', error);
    process.exit(1);
  }
}
