import type { Knex } from 'knex';
import type { FastifyRequest } from 'fastify';

const DEFAULT_TIMEOUT_MS = 30_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 120_000;

export function getEffectiveTimeout(request: FastifyRequest): number {
  const quota = request.quotas?.queryTimeout;
  if (quota && quota > 0) {
    return Math.max(MIN_TIMEOUT_MS, Math.min(quota, MAX_TIMEOUT_MS));
  }
  return DEFAULT_TIMEOUT_MS;
}

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
