import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { env } from '../config/env.js';

export default fp(async (fastify: FastifyInstance) => {
  await fastify.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW,
    redis: fastify.redis,
    keyGenerator: (request) => {
      return request.ip;
    },
    skipOnError: false,
    addHeadersOnExceeding: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
    },
  });
});
