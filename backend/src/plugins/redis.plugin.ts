import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { redis, testRedisConnection } from '../config/redis.js';
import type Redis from 'ioredis';

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis;
  }
}

export default fp(async (fastify: FastifyInstance) => {
  await testRedisConnection();
  fastify.decorate('redis', redis);

  fastify.addHook('onClose', async () => {
    redis.disconnect();
  });
});
