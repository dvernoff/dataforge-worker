import type { Knex } from 'knex';
import type { FastifyRequest } from 'fastify';

const DEFAULT_TIMEOUT_MS = 30_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 120_000;

/**
 * Get the effective query timeout from request quotas.
 * Returns clamped value between 1s and 120s, default 30s.
 */
export function getEffectiveTimeout(request: FastifyRequest): number {
  const quota = request.quotas?.queryTimeout;
  if (quota && quota > 0) {
    return Math.max(MIN_TIMEOUT_MS, Math.min(quota, MAX_TIMEOUT_MS));
  }
  return DEFAULT_TIMEOUT_MS;
}

/**
 * Execute a function inside a transaction with quota-based statement_timeout.
 * Uses SET LOCAL so timeout only applies within this transaction — no leak to pool.
 */
export async function withQuotaTimeout<T>(
  db: Knex,
  timeoutMs: number,
  fn: (trx: Knex.Transaction) => Promise<T>,
): Promise<T> {
  const clamped = Math.max(MIN_TIMEOUT_MS, Math.min(timeoutMs, MAX_TIMEOUT_MS));
  return db.transaction(async (trx) => {
    await trx.raw(`SET LOCAL statement_timeout = ${clamped}`);
    return fn(trx);
  });
}
