import type { Knex } from 'knex';
import crypto from 'crypto';
import { AppError } from '../../middleware/error-handler.js';

interface TxnEntry {
  trx: Knex.Transaction;
  resolve: () => void;
  reject: (err: Error) => void;
  projectId: string;
  dbSchema: string;
  createdAt: number;
  expiresAt: number;
  timer: NodeJS.Timeout;
}

const MAX_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

export class TxnManager {
  private static instance: TxnManager | null = null;
  private txns = new Map<string, TxnEntry>();

  static get(): TxnManager {
    if (!TxnManager.instance) TxnManager.instance = new TxnManager();
    return TxnManager.instance;
  }

  async begin(db: Knex, projectId: string, dbSchema: string, timeoutSeconds?: number): Promise<{ txn_id: string; expires_at: string }> {
    const txnId = crypto.randomUUID();
    const timeoutMs = Math.min(
      Math.max((timeoutSeconds ?? DEFAULT_TIMEOUT_MS / 1000) * 1000, 30 * 1000),
      MAX_TIMEOUT_MS,
    );
    const expiresAt = Date.now() + timeoutMs;

    let resolveSignal: () => void;
    let rejectSignal: (err: Error) => void;
    const signal = new Promise<void>((res, rej) => {
      resolveSignal = res;
      rejectSignal = rej;
    });

    let resolveReady: (trx: Knex.Transaction) => void;
    let rejectReady: (err: Error) => void;
    const trxReady = new Promise<Knex.Transaction>((res, rej) => {
      resolveReady = res;
      rejectReady = rej;
    });

    db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL search_path TO "${dbSchema}"`);
      resolveReady!(trx);
      await signal;
    }).catch((err) => {
      if (!(err as Error).message?.startsWith('rollback:')) {
        rejectReady!(err);
      }
    });

    const trx = await trxReady;
    const timer = setTimeout(() => {
      this.rollback(txnId, 'timeout').catch(() => {});
    }, timeoutMs);

    this.txns.set(txnId, {
      trx,
      resolve: resolveSignal!,
      reject: rejectSignal!,
      projectId,
      dbSchema,
      createdAt: Date.now(),
      expiresAt,
      timer,
    });

    return { txn_id: txnId, expires_at: new Date(expiresAt).toISOString() };
  }

  getTrx(txnId: string, projectId: string): Knex.Transaction {
    const entry = this.txns.get(txnId);
    if (!entry) throw new AppError(404, `Unknown or expired transaction: ${txnId}`);
    if (entry.projectId !== projectId) throw new AppError(403, `Transaction belongs to another project`);
    return entry.trx;
  }

  async commit(txnId: string): Promise<{ committed: true }> {
    const entry = this.txns.get(txnId);
    if (!entry) throw new AppError(404, `Unknown or expired transaction: ${txnId}`);
    clearTimeout(entry.timer);
    this.txns.delete(txnId);
    entry.resolve();
    return { committed: true };
  }

  async rollback(txnId: string, reason: string = 'user'): Promise<{ rolled_back: true; reason: string }> {
    const entry = this.txns.get(txnId);
    if (!entry) return { rolled_back: true, reason: 'already-ended' } as unknown as { rolled_back: true; reason: string };
    clearTimeout(entry.timer);
    this.txns.delete(txnId);
    entry.reject(new Error(`rollback:${reason}`));
    return { rolled_back: true, reason };
  }

  list(projectId: string) {
    const now = Date.now();
    const result: Array<{ txn_id: string; created_at: string; expires_at: string; ttl_seconds: number }> = [];
    for (const [id, e] of this.txns) {
      if (e.projectId !== projectId) continue;
      result.push({
        txn_id: id,
        created_at: new Date(e.createdAt).toISOString(),
        expires_at: new Date(e.expiresAt).toISOString(),
        ttl_seconds: Math.max(0, Math.round((e.expiresAt - now) / 1000)),
      });
    }
    return result;
  }
}
