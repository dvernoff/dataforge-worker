import { Client } from 'pg';
import type { Knex } from 'knex';
import type { FastifyBaseLogger } from 'fastify/types/logger.js';
import { WebSocketService } from './websocket.service.js';
import { WebhookDispatcher } from '../webhooks/dispatcher.js';
import { isModuleEnabled } from '../../utils/module-check.js';
import { env } from '../../config/env.js';

/**
 * Listens to PostgreSQL NOTIFY on channel 'df_change' and re-broadcasts each event to
 * WebSocket subscribers and registered webhooks.
 *
 * The DB-side counterpart is public.df_emit(table, action, pk, data) — installed by the
 * 20260419000001_df_emit_function migration. Events fire only on COMMIT, so aborted
 * transactions never produce phantom WS messages.
 *
 * Payload shape (wire format is compact to stay under PG's 8000-byte NOTIFY limit):
 *   { s: schema, t: table, a: action, pk?: string, d?: jsonb, ts: unix_epoch_sec, trunc?: true }
 *
 * Delivered to WS as:
 *   { type: 'data_change', table, action, record: {id: pk, ...(d ?? {})}, timestamp }
 */

interface PgNotifyPayload {
  s: string;              // schema
  t: string;              // table
  a: 'INSERT' | 'UPDATE' | 'DELETE' | 'UPSERT';
  pk?: string;
  d?: Record<string, unknown>;
  ts?: number;
  trunc?: true;
}

interface SchemaProject {
  id: string;
  slug: string;
  db_schema: string;
}

export class PgNotifyListener {
  private client: Client | null = null;
  private db: Knex;
  private log: FastifyBaseLogger;
  private schemaCache = new Map<string, SchemaProject>();
  private schemaCacheLoadedAt = 0;
  private schemaCacheTtlMs = 30_000;
  private ws = WebSocketService.getInstance();
  private webhookDispatcher: WebhookDispatcher;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private shuttingDown = false;

  // Stats — read via getStats() and surfaced through the MCP get_websocket_stats tool
  private stats = {
    status: 'initializing' as 'initializing' | 'connected' | 'reconnecting' | 'disconnected',
    connected_at: null as string | null,
    events_received_total: 0,
    events_delivered_total: 0,
    events_dropped_total: 0,
    last_event_at: null as string | null,
    last_error: null as string | null,
    per_table: new Map<string, number>(),   // events per "<projectId>:<table>" in-memory
    reconnects: 0,
  };

  constructor(db: Knex, log: FastifyBaseLogger) {
    this.db = db;
    this.log = log.child({ component: 'pg-notify-listener' });
    this.webhookDispatcher = new WebhookDispatcher(db);
  }

  async start(): Promise<void> {
    await this.refreshSchemaCache();
    await this.connect();
  }

  async stop(): Promise<void> {
    this.shuttingDown = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.client) {
      try { await this.client.end(); } catch { /* ignore */ }
      this.client = null;
    }
    this.stats.status = 'disconnected';
  }

  getStats() {
    const perTable: Record<string, number> = {};
    for (const [k, v] of this.stats.per_table) perTable[k] = v;
    return {
      status: this.stats.status,
      connected_at: this.stats.connected_at,
      events_received_total: this.stats.events_received_total,
      events_delivered_total: this.stats.events_delivered_total,
      events_dropped_total: this.stats.events_dropped_total,
      last_event_at: this.stats.last_event_at,
      last_error: this.stats.last_error,
      reconnects: this.stats.reconnects,
      per_table: perTable,
      cached_projects: this.schemaCache.size,
    };
  }

  // ---------- internal ----------

  private async connect(): Promise<void> {
    if (this.shuttingDown) return;
    this.stats.status = this.reconnectAttempts > 0 ? 'reconnecting' : 'initializing';
    try {
      this.client = new Client({
        connectionString: env.DATABASE_URL,
        application_name: 'df-worker-pg-notify-listener',
      });
      this.client.on('error', (err) => this.onClientError(err));
      this.client.on('notification', (msg) => this.onNotification(msg));
      this.client.on('end', () => this.onClientEnd());
      await this.client.connect();
      await this.client.query('LISTEN df_change');
      this.reconnectAttempts = 0;
      this.stats.status = 'connected';
      this.stats.connected_at = new Date().toISOString();
      this.log.info('Listening on PG channel "df_change"');
    } catch (err) {
      this.stats.last_error = err instanceof Error ? err.message : String(err);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.shuttingDown) return;
    this.stats.status = 'reconnecting';
    this.reconnectAttempts++;
    this.stats.reconnects++;
    // Exponential backoff capped at 30s: 1s, 2s, 4s, 8s, 16s, 30s, 30s...
    const delay = Math.min(1000 * 2 ** Math.min(this.reconnectAttempts - 1, 5), 30_000);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private onClientError(err: Error) {
    this.stats.last_error = err.message;
    this.log.warn({ err }, 'pg-notify client error — will reconnect');
    try { this.client?.end().catch(() => {}); } catch { /* ignore */ }
    this.client = null;
    this.scheduleReconnect();
  }

  private onClientEnd() {
    if (this.shuttingDown) return;
    this.stats.last_error = 'connection ended';
    this.client = null;
    this.scheduleReconnect();
  }

  private async onNotification(msg: { channel: string; payload?: string }) {
    if (msg.channel !== 'df_change' || !msg.payload) return;
    this.stats.events_received_total++;
    this.stats.last_event_at = new Date().toISOString();

    let parsed: PgNotifyPayload;
    try {
      parsed = JSON.parse(msg.payload);
    } catch (err) {
      this.stats.events_dropped_total++;
      this.log.warn({ err, raw: msg.payload.slice(0, 200) }, 'failed to parse df_change payload');
      return;
    }

    // Resolve schema → project (cached, auto-refresh on miss)
    let project = this.schemaCache.get(parsed.s);
    if (!project) {
      if (Date.now() - this.schemaCacheLoadedAt > this.schemaCacheTtlMs) {
        await this.refreshSchemaCache();
        project = this.schemaCache.get(parsed.s);
      }
      if (!project) {
        this.stats.events_dropped_total++;
        this.log.warn({ schema: parsed.s }, 'df_emit event for unknown schema — dropped');
        return;
      }
    }

    // Normalize action: UPSERT → UPDATE at the wire level so existing WS clients understand it
    const wsAction = (parsed.a === 'UPSERT' ? 'UPDATE' : parsed.a) as 'INSERT' | 'UPDATE' | 'DELETE';
    const record: Record<string, unknown> = {
      ...(parsed.d ?? {}),
      ...(parsed.pk !== undefined ? { id: parsed.pk } : {}),
      ...(parsed.trunc ? { _truncated: true } : {}),
    };

    // Broadcast to WS — reuses the existing broadcastDataChange so UI clients see the same shape
    this.ws.broadcastDataChange(project.id, parsed.t, wsAction, record);
    this.stats.events_delivered_total++;

    const perTableKey = `${project.id}:${parsed.t}`;
    this.stats.per_table.set(perTableKey, (this.stats.per_table.get(perTableKey) ?? 0) + 1);

    // Fan out to webhooks (same plugin gate as the table-op path in builder.routes.ts)
    this.dispatchWebhooks(project.id, parsed.t, wsAction, record).catch((err) => {
      this.log.warn({ err, table: parsed.t }, 'webhook dispatch from pg_notify failed');
    });
  }

  private async dispatchWebhooks(projectId: string, table: string, action: 'INSERT' | 'UPDATE' | 'DELETE', record: Record<string, unknown>) {
    const enabled = await isModuleEnabled(this.db, projectId, 'feature-webhooks').catch(() => false);
    if (!enabled) return;
    const webhooks = await this.db('webhooks')
      .where({ project_id: projectId, is_active: true })
      .whereRaw('? = ANY(table_names)', [table])
      .whereRaw('? = ANY(events)', [action])
      .catch(() => []);
    const payload = { table, event: action, record, timestamp: new Date().toISOString() };
    for (const wh of webhooks) {
      this.webhookDispatcher.dispatch(wh, action, payload).catch(() => { /* dispatcher has its own retry */ });
    }
  }

  private async refreshSchemaCache() {
    try {
      const rows = await this.db('projects').select('id', 'slug', 'db_schema');
      this.schemaCache.clear();
      for (const r of rows as SchemaProject[]) {
        this.schemaCache.set(r.db_schema, r);
      }
      this.schemaCacheLoadedAt = Date.now();
    } catch (err) {
      this.log.warn({ err }, 'failed to refresh schema→project cache');
    }
  }
}

// Singleton — wired from index.ts startup
let instance: PgNotifyListener | null = null;

export function initPgNotifyListener(db: Knex, log: FastifyBaseLogger): PgNotifyListener {
  if (!instance) instance = new PgNotifyListener(db, log);
  return instance;
}

export function getPgNotifyListener(): PgNotifyListener | null {
  return instance;
}
