import knex, { Knex } from 'knex';
import { env } from './env.js';

const config: Knex.Config = {
  client: 'pg',
  connection: {
    connectionString: env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
    statement_timeout: 60000,
    idle_in_transaction_session_timeout: 120000,
  },
  pool: {
    min: env.DATABASE_POOL_MIN,
    max: env.DATABASE_POOL_MAX,
    acquireTimeoutMillis: 15000,
    createTimeoutMillis: 5000,
    idleTimeoutMillis: 60000,
    reapIntervalMillis: 1000,
    propagateCreateError: false,
  },
  migrations: {
    directory: '../migrations',
    extension: 'ts',
  },
};

export const db = knex(config);

export async function testDatabaseConnection(): Promise<void> {
  try {
    await db.raw('SELECT 1');
    console.log('PostgreSQL connected successfully');
  } catch (error) {
    console.error('Failed to connect to PostgreSQL:', error);
    process.exit(1);
  }
}

export { config as knexConfig };
