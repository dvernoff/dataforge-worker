import type { FastifyRequest, FastifyReply } from 'fastify';
import type { Redis } from 'ioredis';

const MAX_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 900; // 15 minutes

export function createBruteForceMiddleware(redis: Redis) {
  return async function bruteForceMiddleware(request: FastifyRequest, reply: FastifyReply) {
    const ip = request.ip;
    const key = `bf:${ip}`;
    const attempts = await redis.get(key);

    if (attempts && parseInt(attempts) >= MAX_ATTEMPTS) {
      const ttl = await redis.ttl(key);
      return reply.status(429).send({
        error: 'Too many failed login attempts',
        retry_after: ttl,
      });
    }
  };
}

export async function recordFailedAttempt(redis: Redis, ip: string) {
  const key = `bf:${ip}`;
  const current = await redis.incr(key);
  if (current === 1) {
    await redis.expire(key, LOCKOUT_SECONDS);
  }
}

export async function clearFailedAttempts(redis: Redis, ip: string) {
  await redis.del(`bf:${ip}`);
}
