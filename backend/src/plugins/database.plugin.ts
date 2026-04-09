import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { db, testDatabaseConnection } from '../config/database.js';
import type { Knex } from 'knex';

declare module 'fastify' {
  interface FastifyInstance {
    db: Knex;
  }
}

export default fp(async (fastify: FastifyInstance) => {
  await testDatabaseConnection();
  fastify.decorate('db', db);

  fastify.addHook('onClose', async () => {
    await db.destroy();
  });
});
