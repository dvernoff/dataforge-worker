import type { Knex } from 'knex';
import type Redis from 'ioredis';
import { SchemaService } from '../schema/schema.service.js';
import { BuilderService } from '../api-builder/builder.service.js';
import { ConsoleService } from '../sql-console/console.service.js';
import { AnalyzerService } from '../sql-console/analyzer.service.js';
import { CronService } from '../cron/cron.service.js';
import { TimescaleService } from '../timescale/timescale.service.js';
import { Executor } from '../api-builder/executor.js';
import { CacheService } from '../api-builder/cache.service.js';
import { OpenAPIService } from '../api-executor/openapi.service.js';
import { AiStudioService } from '../ai-studio/ai-studio.service.js';
import { PROVIDER_MODELS } from '../ai-studio/ai-studio.types.js';
import { PluginManager } from '../plugins/plugin.manager.js';
import { WebhooksService } from '../webhooks/webhooks.service.js';
import { WebSocketService } from '../realtime/websocket.service.js';
import { isModuleEnabled } from '../../utils/module-check.js';
import type { AiContextResponse, AiGatewayLogEntry } from './ai-gateway.types.js';

export class AiGatewayService {
  private schema: SchemaService;
  private builder: BuilderService;
  private console: ConsoleService;
  private analyzer: AnalyzerService;
  private cron: CronService;
  private timescale: TimescaleService;
  private executor: Executor;
  private cacheService: CacheService | null;
  private aiStudio: AiStudioService;
  private plugins: PluginManager;
  private webhooks: WebhooksService;

  constructor(private db: Knex, private redis?: Redis) {
    this.schema = new SchemaService(db);
    this.builder = new BuilderService(db);
    this.console = new ConsoleService(db);
    this.analyzer = new AnalyzerService(db);
    this.cron = new CronService(db);
    this.timescale = new TimescaleService(db);
    this.executor = new Executor(db);
    this.cacheService = redis ? new CacheService(redis) : null;
    this.aiStudio = new AiStudioService(db);
    this.plugins = new PluginManager(db);
    this.webhooks = new WebhooksService(db);
  }

  // ===== Plugin management (MCP) =====

  async listPlugins(projectId: string) {
    await this.plugins.loadPlugins().catch(() => {});
    return this.plugins.listPluginsWithStatus(projectId);
  }

  async getPluginInfo(projectId: string, pluginId: string) {
    await this.plugins.loadPlugins().catch(() => {});
    const all = await this.plugins.listPluginsWithStatus(projectId);
    const entry = all.find((p: { id: string }) => p.id === pluginId);
    if (!entry) throw new Error(`Plugin "${pluginId}" not found`);
    // getPluginSettings returns { settings, is_enabled } — unwrap
    let savedSettings: Record<string, unknown> = {};
    try {
      const res = await this.plugins.getPluginSettings(projectId, pluginId) as { settings?: unknown };
      const raw = res?.settings;
      savedSettings = (typeof raw === 'string' ? JSON.parse(raw) : (raw as Record<string, unknown>)) ?? {};
    } catch {}
    const manifestWrapper = { settings: (entry as { settings?: Array<{ key: string; type?: string }> }).settings ?? [] };
    return { ...entry, saved_settings: this.redactSecrets(savedSettings, manifestWrapper) };
  }

  async enablePluginForProject(projectId: string, pluginId: string, settings: Record<string, unknown> = {}) {
    return this.plugins.enablePlugin(projectId, pluginId, settings ?? {});
  }

  async disablePluginForProject(projectId: string, pluginId: string) {
    return this.plugins.disablePlugin(projectId, pluginId);
  }

  async updatePluginSettingsForProject(projectId: string, pluginId: string, settings: Record<string, unknown>) {
    return this.plugins.updatePluginSettings(projectId, pluginId, settings);
  }

  /** Redact password-type settings per manifest — MCP must never return raw API keys. */
  private redactSecrets(settings: Record<string, unknown>, manifest: { settings?: Array<{ key: string; type?: string }> }): Record<string, unknown> {
    const out = { ...settings };
    for (const s of manifest.settings ?? []) {
      if (s.type === 'password' && typeof out[s.key] === 'string' && out[s.key]) {
        const v = out[s.key] as string;
        out[s.key] = v.length > 8 ? v.slice(0, 4) + '••••' + v.slice(-2) : '••••';
      }
    }
    return out;
  }

  // ===== Webhooks (MCP) =====

  async listWebhooks(projectId: string) {
    return this.webhooks.findAll(projectId);
  }

  async getWebhook(projectId: string, webhookId: string) {
    return this.webhooks.findById(webhookId, projectId);
  }

  async createWebhook(projectId: string, userId: string | null, input: Parameters<WebhooksService['create']>[2]) {
    return this.webhooks.create(projectId, (userId ?? null) as unknown as string, input);
  }

  async updateWebhook(projectId: string, webhookId: string, input: Record<string, unknown>) {
    return this.webhooks.update(webhookId, projectId, input);
  }

  async deleteWebhook(projectId: string, webhookId: string) {
    await this.webhooks.delete(webhookId, projectId);
    return { deleted: true, webhook_id: webhookId };
  }

  async getWebhookLogs(projectId: string, webhookId: string, limit = 50) {
    return this.webhooks.getLogs(webhookId, projectId, limit);
  }

  // ===== WebSocket info / stats (MCP) =====

  getWebsocketInfo(projectSlug: string, host = 'your-dataforge-host') {
    return {
      protocol: 'wss (TLS)',
      url: `wss://${host}/ws/v1/${projectSlug}?token=YOUR_API_TOKEN`,
      auth: {
        method: 'API token (same as REST)',
        header: 'Authorization: Bearer YOUR_TOKEN',
        query_alternative: '?token=YOUR_TOKEN',
      },
      client_messages: [
        { action: 'subscribe', channel: 'project:<slug>   — receives events from ALL tables in the project' },
        { action: 'subscribe', channel: 'table:<name>     — receives events only from one table' },
        { action: 'unsubscribe', channel: '<same format>' },
        { action: 'ping' },
      ],
      server_events: {
        connected: '{ type:"connected", projectSlug, timestamp }',
        subscribed: '{ type:"subscribed", channel, timestamp }',
        data_change: '{ type:"data_change", table, action:"INSERT"|"UPDATE"|"DELETE", record, timestamp }',
        pong: '{ type:"pong", timestamp }',
        error: '{ type:"error", code, message }',
      },
      limits: {
        max_connections_per_project: 100,
        max_channels_per_client: 50,
        rate_limit: '20 client messages per second per socket',
      },
      trigger_source: 'Events fire when data is INSERTed/UPDATEd/DELETEd through an API endpoint (table CRUD). Direct execute_sql_mutation currently does NOT trigger WS events.',
      prerequisites: 'Enable the "feature-websocket" plugin for the project before clients can connect.',
    };
  }

  getWebsocketStats(projectId: string) {
    const ws = WebSocketService.getInstance();
    return ws.getStats(projectId);
  }

  // ===== AI Studio plugin wrappers =====
  // All of these require the ai-studio plugin to be enabled for the project.

  private async ensureAiStudioEnabled(projectId: string) {
    const enabled = await isModuleEnabled(this.db, projectId, 'ai-studio');
    if (!enabled) {
      throw new Error('AI Studio plugin is not enabled for this project. Enable it in the CP panel under Plugins → AI Studio.');
    }
  }

  private async getPluginSettings(projectId: string): Promise<Record<string, unknown>> {
    const row = await this.db('plugin_instances').where({ project_id: projectId, plugin_id: 'ai-studio' }).first();
    if (!row) return {};
    const raw = row.settings;
    if (!raw) return {};
    try {
      return typeof raw === 'string' ? JSON.parse(raw) : raw as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  async listAiEndpoints(projectId: string, dbSchema: string) {
    await this.ensureAiStudioEnabled(projectId);
    return this.aiStudio.listEndpoints(dbSchema);
  }

  async getAiEndpoint(projectId: string, dbSchema: string, idOrSlug: string) {
    await this.ensureAiStudioEnabled(projectId);
    // Try by id first (UUID shape), then slug
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug)) {
      const byId = await this.aiStudio.getEndpoint(dbSchema, idOrSlug);
      if (byId) return byId;
    }
    return this.aiStudio.getEndpointBySlug(dbSchema, idOrSlug);
  }

  async createAiEndpoint(projectId: string, dbSchema: string, input: Parameters<AiStudioService['createEndpoint']>[1]) {
    await this.ensureAiStudioEnabled(projectId);
    this.validateProviderModel(input.provider, input.model);
    return this.aiStudio.createEndpoint(dbSchema, input);
  }

  async updateAiEndpoint(projectId: string, dbSchema: string, id: string, input: Parameters<AiStudioService['updateEndpoint']>[2]) {
    await this.ensureAiStudioEnabled(projectId);
    if (input.provider || input.model) {
      const existing = await this.aiStudio.getEndpoint(dbSchema, id);
      const provider = input.provider ?? existing?.provider;
      const model = input.model ?? existing?.model;
      if (provider && model) this.validateProviderModel(provider, model);
    }
    return this.aiStudio.updateEndpoint(dbSchema, id, input);
  }

  private validateProviderModel(provider: string, model: string) {
    const allowed = PROVIDER_MODELS[provider];
    if (!allowed) {
      throw new Error(`Unknown provider "${provider}". Supported: ${Object.keys(PROVIDER_MODELS).join(', ')}. Use ai_studio_list_models for full list.`);
    }
    if (!allowed.includes(model)) {
      throw new Error(`Model "${model}" is not a known ${provider} model. Known: ${allowed.join(', ')}. Use ai_studio_list_models for full list.`);
    }
  }

  async deleteAiEndpoint(projectId: string, dbSchema: string, id: string) {
    await this.ensureAiStudioEnabled(projectId);
    await this.aiStudio.deleteEndpoint(dbSchema, id);
    return { deleted: true, id };
  }

  async testAiEndpoint(projectId: string, dbSchema: string, slugOrId: string, input: { input?: string; messages?: Array<{ role: 'user' | 'assistant'; content: string }>; session_id?: string }) {
    await this.ensureAiStudioEnabled(projectId);
    // Resolve id → slug if needed
    let slug = slugOrId;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slugOrId)) {
      const ep = await this.aiStudio.getEndpoint(dbSchema, slugOrId);
      if (!ep) throw new Error(`AI Studio endpoint "${slugOrId}" not found`);
      slug = ep.slug;
    }
    const pluginSettings = await this.getPluginSettings(projectId);
    return this.aiStudio.callEndpoint(dbSchema, slug, input, pluginSettings);
  }

  async getAiLogs(projectId: string, dbSchema: string, opts: { endpoint_id?: string; limit?: number; offset?: number }) {
    await this.ensureAiStudioEnabled(projectId);
    return this.aiStudio.getLogs(dbSchema, { endpointId: opts.endpoint_id, limit: opts.limit, offset: opts.offset });
  }

  async getAiStats(projectId: string, dbSchema: string) {
    await this.ensureAiStudioEnabled(projectId);
    return this.aiStudio.getStats(dbSchema);
  }

  async getAiSession(projectId: string, dbSchema: string, endpointIdOrSlug: string, sessionId: string) {
    await this.ensureAiStudioEnabled(projectId);
    const ep = await this.getAiEndpoint(projectId, dbSchema, endpointIdOrSlug);
    if (!ep) throw new Error(`AI Studio endpoint "${endpointIdOrSlug}" not found`);
    return this.aiStudio.getContext(dbSchema, ep.id, sessionId);
  }

  async clearAiSession(projectId: string, dbSchema: string, endpointIdOrSlug: string, sessionId: string) {
    await this.ensureAiStudioEnabled(projectId);
    const ep = await this.getAiEndpoint(projectId, dbSchema, endpointIdOrSlug);
    if (!ep) throw new Error(`AI Studio endpoint "${endpointIdOrSlug}" not found`);
    await this.aiStudio.deleteContext(dbSchema, ep.id, sessionId);
    return { deleted: true, endpoint_id: ep.id, session_id: sessionId };
  }

  listAiModels() {
    return {
      providers: Object.keys(PROVIDER_MODELS),
      models: PROVIDER_MODELS,
    };
  }

  async callEndpoint(projectId: string, dbSchema: string, projectSlug: string, input: {
    endpoint_id?: string;
    path?: string;
    method?: string;
    params?: Record<string, string>;
    body?: unknown;
    headers?: Record<string, string>;
    bypass_cache?: boolean;
  }) {
    let endpoint: any;
    if (input.endpoint_id) {
      endpoint = await this.db('api_endpoints')
        .where({ id: input.endpoint_id, project_id: projectId })
        .whereNull('deprecated_at')
        .first();
    } else if (input.path) {
      const method = (input.method ?? 'GET').toUpperCase();
      endpoint = await this.db('api_endpoints')
        .where({ project_id: projectId, path: input.path, method, is_active: true })
        .whereNull('deprecated_at')
        .orderBy('version', 'desc')
        .first();
    } else {
      throw new Error('Provide "endpoint_id" or ("path" + optional "method")');
    }
    if (!endpoint) throw new Error('Endpoint not found');

    const parseMaybe = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v);
    const sourceConfig = parseMaybe(endpoint.source_config) ?? {};
    const responseConfig = parseMaybe(endpoint.response_config) ?? null;
    const validationSchema = parseMaybe(endpoint.validation_schema) ?? null;

    const endpointDef = {
      source_type: endpoint.source_type,
      source_config: sourceConfig,
      response_config: responseConfig,
      validation_schema: validationSchema,
      method: endpoint.method,
    };

    const params = input.params ?? {};

    let cacheHit = false;
    let fromCacheAgeSeconds: number | undefined;
    const canCache = endpoint.cache_enabled && endpoint.method === 'GET' && !input.bypass_cache && this.cacheService;

    if (canCache) {
      const cached = await this.cacheService!.getWithTtl(projectSlug, endpoint.id, { path: endpoint.path, query: params });
      if (cached !== null) {
        const origTtl = Number(endpoint.cache_ttl ?? 60);
        const remaining = cached.ttl_seconds > 0 ? cached.ttl_seconds : 0;
        fromCacheAgeSeconds = Math.max(0, origTtl - remaining);
        return {
          status: 200,
          duration_ms: 0,
          cache_hit: true,
          from_cache_age_seconds: fromCacheAgeSeconds,
          body: cached.data,
        };
      }
    }

    const start = Date.now();
    let status = 200;
    let body: unknown;
    try {
      body = await this.executor.execute(endpointDef, dbSchema, params, params, input.body, 30_000, projectId);
    } catch (err: any) {
      status = err.statusCode ?? 500;
      return {
        status,
        duration_ms: Date.now() - start,
        cache_hit: false,
        body: { error: err.message },
      };
    }
    const duration = Date.now() - start;

    if (canCache && !cacheHit) {
      await this.cacheService!.set(projectSlug, endpoint.id, { path: endpoint.path, query: params }, body, Number(endpoint.cache_ttl ?? 60));
    }

    if (body && typeof body === 'object' && Array.isArray((body as any).errors) && ((body as any).errors.length > 0)) {
      status = 207;
    }

    return {
      status,
      duration_ms: duration,
      cache_hit: false,
      body,
    };
  }

  getProjectInfo(): string {
    return `DataForge is a backend-as-a-service platform built on PostgreSQL. You are connected to a DataForge project via the AI Gateway.

CAPABILITIES:
- Schema: create/alter/drop tables, indexes (btree/hash/gin/gist/brin, partial, expression, covering), foreign keys, materialized views, CHECK constraints
- Data: read-only SELECT (execute_sql) and writes (execute_sql_mutation: INSERT/UPDATE/DELETE/MERGE)
- API endpoints: table CRUD, bulk ingest (create_many), custom SQL, versioning + canary rollout
- TimescaleDB: hypertables, continuous aggregates, compression/retention policies (if extension available)
- Ops: cron (SQL and HTTPS), internal call_endpoint, query planner (explain_query), OpenAPI spec, cross-call transactions
- AI Studio plugin: create/edit/test AI endpoints across OpenAI/DeepSeek/Claude with structured response, validation, chat history (ai_studio_*)
- Plugins: enable/disable/configure every built-in plugin (list_plugins, enable_plugin, disable_plugin, update_plugin_settings)
- Webhooks: outbound HTTP on data changes with HMAC signatures + retries (list/create/update/delete_webhook, get_webhook_logs)
- WebSockets: realtime client subscriptions with per-table or per-project channels (get_websocket_info, get_websocket_stats)
- Discoverability: list_tables, describe_table, list_endpoints, search_endpoints, suggest_index, analyze_schema_quality

IMPORTANT: SQL execution is via MCP tools only (execute_sql / execute_sql_mutation). There is NO built-in HTTP endpoint like /execute_sql. If you need HTTP-accessible SQL, create a custom_sql endpoint via create_endpoint.

==========================================================
INTROSPECTION — ALWAYS START HERE
==========================================================

Prefer fast, targeted introspection over get_schema_context on large projects:
- list_tables — thin listing with row_count_estimate (pg_class.reltuples, not COUNT(*)), size_bytes, is_hypertable. P95 ≤ 500ms.
- describe_table(name) — columns, indexes, FKs, hypertable_info for one table.
- list_endpoints({ method?, path_contains? }) — endpoints with filters.
- get_schema_context — full snapshot; heavy, use only on small projects.
- search_endpoints(query) — substring match on path/description/source_config.
- suggest_index(table) — scans pg_stat for seq_scan vs idx_scan ratio.
- analyze_schema_quality — reports missing PKs, large tables with few indexes, unused indexes.

==========================================================
COLUMN TYPES
==========================================================
Scalar:     text, integer, bigint, float, decimal, boolean, date, timestamp, timestamptz, uuid, json, jsonb
Network:    inet (IPv4+IPv6, validates on insert), cidr (subnet), macaddr
Arrays:     text[], integer[], inet[]
Auto-incr:  serial, bigserial

When to use inet vs text for IP addresses:
  Prefer inet — it validates format, stores IPv4+IPv6 uniformly, and enables network operators:
    WHERE ip << '192.168.1.0/24'         -- IP is in subnet
    WHERE ip <<= '10.0.0.0/8'            -- IP is in subnet or equals network
    WHERE ip1 && ip2                     -- any overlap between two cidr ranges
    WHERE family(ip) = 6                 -- filter by IPv4/IPv6
  Migrate existing text → inet: alter_columns({changes:[{action:"alter", name:"ip", type:"inet"}]}). A USING "ip"::inet clause is added automatically. Invalid IPs in existing data will surface as an error — clean them up first with execute_sql_mutation.

==========================================================
CREATE TABLE (use create_table)
==========================================================
- add_uuid_pk (default true) — adds "id" UUID PRIMARY KEY DEFAULT gen_random_uuid()
- add_timestamps (default true) — shortcut for both created_at and updated_at TIMESTAMPTZ columns (updated_at gets an update trigger)
- add_created_at / add_updated_at (optional) — fine-grained override. Set add_timestamps=false and add_created_at=true to get ONLY created_at.
- checks (optional) — table-level CHECK constraints: [{name?, expression}], e.g. [{expression: "role IN ('admin','user','guest')"}]. Per-column CHECK also supported via columns[].check.
- Composite PK: set add_uuid_pk=false and mark multiple columns with is_primary:true. A table-level PRIMARY KEY(col1, col2, ...) is emitted automatically. Useful for M:N link tables (e.g. player_ips: (player_id, ip)).
- storage_params (optional) — PostgreSQL table storage tuning. For write-heavy tables with hot updates, set {"fillfactor":85} to enable HOT updates (10-30% throughput gain). Other keys: autovacuum_vacuum_scale_factor/threshold, autovacuum_analyze_scale_factor/threshold.
- default_value quoting: pass SQL expressions as-is. Typed casts preserved: "'[]'::jsonb", "0::bigint", "now()". Literal strings get auto-quoted, so pass "user" not "'user'".
- Define only business columns. System columns are auto-added.
- For TimescaleDB hypertables: create with add_uuid_pk=false (hypertable PK must include the time column).
- BEFORE calling create_table on a time-series / append-only table, read the "WHEN TO AUTO-CONVERT TO HYPERTABLE" section and set add_uuid_pk=false up front so you can convert cleanly in one step.

ALTER COLUMNS (use alter_columns)
- changes: [{action: "add", name, type, nullable, default_value, is_unique?, json_schema?}]
  - is_unique: also creates UNIQUE INDEX "idx_{table}_{column}_unique" in the same transaction.
  - json_schema (jsonb columns only): attaches CHECK (jsonb_matches_schema(...)) — requires pg_jsonschema extension.
- {action: "alter", name, type, nullable} — change type or nullability. Auto-adds USING col::newtype for inet/cidr/uuid/jsonb/int/date/bool.
- {action: "rename", name, newName}
- {action: "drop", name} — destroys data
- {action: "set_primary_key", columns: [...], constraint_name?} — set or replace the table's PRIMARY KEY.
    * Single or composite PK ("columns": ["a", "b"]).
    * Drops any existing PK first.
    * Promotes an existing UNIQUE INDEX that matches the column list exactly — no table rewrite.
    * Ensures NOT NULL on target columns; fails with clear error if any contain NULLs.
    * Use this after dropping the auto UUID PK (e.g. for composite natural keys).
- {action: "drop_primary_key"} — remove PK constraint (idempotent if no PK exists).
- {action: "drop_constraint", name: "<constraint_name>"} — drop any named constraint: UNIQUE, CHECK, FK, EXCLUDE.
    * Use this to clean up duplicate UNIQUE left behind after set_primary_key (e.g. the auto-created <table>_<col>_key from an inline UNIQUE column constraint).
    * Never use drop_index on a constraint-backed index — PG refuses with "cannot drop index because constraint requires it". Use drop_constraint instead; it drops both the constraint and its owned index.
    * Uses DROP CONSTRAINT IF EXISTS — idempotent, no error if the constraint is already gone.
    * PostgreSQL enforces FK dependencies: if another table's FK references this constraint, the drop will fail with a clear error. Drop the dependent FK first via drop_foreign_key.
    * Find constraint names via describe_table (for FK and index-backed ones) or "SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'schema.table'::regclass" through execute_sql.
- storage_params: {...} — tune PostgreSQL storage parameters at the table level, alongside or without any column changes. Example: {"fillfactor": 85} for write-heavy tables. Other keys: autovacuum_vacuum_scale_factor, autovacuum_vacuum_threshold, autovacuum_analyze_scale_factor, autovacuum_analyze_threshold.

==========================================================
INDEXES (use add_index)
==========================================================
Types: btree (default), hash, gin, gist, brin
Shape:
- columns: ["a","b"]                   — regular composite
- expressions: ["lower(email)"]        — expression index (mutually exclusive with columns)
- where: "status = 'active'"           — partial index predicate (no subqueries, no side-effect functions)
- include: ["name"]                    — INCLUDE covering columns (btree)
- is_unique: true/false, name?
Usage:
- btree — equality, range, ORDER BY, LIKE 'prefix%', INCLUDE covering
- hash — equality only
- gin — JSONB @>, array &&, full-text, pg_trgm for fuzzy/substring LIKE
- gist — geometric, ranges, ts_vector, inet range overlaps
- brin — append-only time-series / naturally-ordered big tables

pg_trgm (trigram-based ILIKE/LIKE '%substring%' search) is installed automatically when you
create a GIN or GIST index on a text column. add_index({table_name:"users", columns:["nick"], type:"gin"})
enables the extension if missing, builds the index with gin_trgm_ops, and makes ILIKE '%knife%'
use a bitmap index scan instead of a full seq scan. No manual CREATE EXTENSION needed.

ops_class — explicit PostgreSQL operator class. Needed for gin/gist on EXPRESSIONS (the column-form
auto-detects text columns, but for expressions you must be explicit). Allowed values:
gin_trgm_ops, gist_trgm_ops, jsonb_ops, jsonb_path_ops, inet_ops, array_ops, tsvector_ops,
text_pattern_ops, varchar_pattern_ops, int4_ops, int8_ops, text_ops.

Pattern examples:
  -- Fuzzy nick search on 400k rows, <5ms:
  add_index({table_name:"players", columns:["nick"], type:"gin"})
  -- Substring search on a BIGINT column (cast to text in expression, give it ops_class):
  add_index({table_name:"players", expressions:["steam_id::text"], type:"gin", ops_class:"gin_trgm_ops"})
  -- JSONB path lookup (faster but only supports @>):
  add_index({table_name:"events", expressions:["data"], type:"gin", ops_class:"jsonb_path_ops"})
  -- LIKE 'prefix%' on text (btree path):
  add_index({table_name:"users", columns:["email"], type:"btree", ops_class:"text_pattern_ops"})
  -- Subnet lookup on IP column (use inet type + gist):
  add_index({table_name:"player_ips", columns:["ip"], type:"gist"})

==========================================================
WRITE SQL (use execute_sql_mutation)
==========================================================
execute_sql_mutation({
  query,                               // INSERT/UPDATE/DELETE/MERGE (WITH + mutation allowed)
  confirm_write: true,                 // REQUIRED guard
  params?: {name: value, ...},         // fills {{name}} placeholders safely
  returning?: boolean,                 // appends RETURNING * if missing
  dry_run?: boolean,                   // executes and rolls back, returns affected row count
  timeout?: number,                    // ms, default 30000, max 120000
  txn_id?: string,                     // run inside open transaction (see below)
})
- DDL (DROP/TRUNCATE/ALTER/CREATE/GRANT/REVOKE/VACUUM/CLUSTER/REINDEX) is blocked. Use schema tools instead.

UPSERT / ON CONFLICT — fully supported
  Inside ON CONFLICT DO UPDATE SET ..., use:
    EXCLUDED.<col>               -- the row you tried to insert
    <target_table>.<col>         -- the existing row (e.g. players.seen_count)
    <alias>.<col>                -- if you wrote INSERT INTO players AS p, use p.col

  Atomic counter bump:
    INSERT INTO players (steam_id, nick, seen_count) VALUES ('s1','bob',1)
    ON CONFLICT (steam_id) DO UPDATE
    SET seen_count = players.seen_count + 1,
        nick       = COALESCE(EXCLUDED.nick, players.nick);

  Bulk UPSERT from VALUES:
    INSERT INTO players (steam_id, nick) VALUES ('s1','a'), ('s2','b'), ('s3','c')
    ON CONFLICT (steam_id) DO UPDATE SET nick = EXCLUDED.nick;

CTE (WITH) — fully supported, including RECURSIVE and multi-CTE
    WITH filtered AS (SELECT id FROM scores WHERE points > 100),
         renamed  AS (SELECT id, nick || '-vip' AS new_nick FROM players p JOIN filtered f ON p.id = f.id)
    UPDATE players SET nick = r.new_nick FROM renamed r WHERE players.id = r.id;

MERGE — supported (PostgreSQL 15+)
    MERGE INTO scores t
    USING (SELECT 's1' AS pid, 200 AS pts) src
    ON t.player_id = src.pid
    WHEN MATCHED THEN UPDATE SET points = src.pts
    WHEN NOT MATCHED THEN INSERT (player_id, points) VALUES (src.pid, src.pts);

SCHEMA ACCESS RULES
  Inside query, the prefix X in "X.Y" must be one of:
    1. your project schema
    2. a table used in FROM/INTO/UPDATE/JOIN/MERGE in this same query
    3. an alias you defined via "AS alias" or space-alias
    4. a CTE name from WITH
    5. EXCLUDED, OLD, or NEW (PostgreSQL built-ins)
  Blocked: pg_catalog / information_schema / pg_* / any other project's schema, even via alias shadowing.
  Error code DF_ALIEN_SCHEMA lists these rules on violation; DF_SCHEMA_SHADOW fires if you pick an alias name matching another schema.

==========================================================
CROSS-CALL TRANSACTIONS
==========================================================
- begin_transaction({ timeout_seconds? }) → { txn_id, expires_at }
- Pass txn_id to execute_sql_mutation to batch multiple writes atomically.
- commit_transaction({ txn_id }) / rollback_transaction({ txn_id })
- list_transactions — active txns for this project
- Auto-rollback on timeout (default 600s, max 1800s) or disconnect.

==========================================================
API ENDPOINTS (use create_endpoint)
==========================================================
Table CRUD — source_type "table", source_config:
  { table, operation: "find|findOne|create|update|delete|create_many" }
  - find query params: page, limit (max 100), sort, order (asc|desc).
    Filters (both forms accepted):
      ?column=value                      — shorthand equality
      ?column__op=value                  — shorthand with operator (eq, neq, gt, gte, lt, lte, like, ilike, in, is_null)
      ?filter[column]=value              — PostgREST-style equality
      ?filter[column][op]=value          — PostgREST-style with operator
    Reserved shorthand keys (skipped as filters): page, limit, offset, sort, order, q, search, fields, include, include_deleted, only_deleted, v.
    Default sort falls back to created_at, then id, then unsorted if neither exists.
  - create_many: bulk insert. POST JSON array or NDJSON (Content-Type: application/x-ndjson).
    Extra config: on_conflict ("error|do_nothing|do_update"), conflict_columns, max_batch_size (default 1000).
    Errors returned per-row with HTTP 207 Multi-Status: { inserted, skipped, errors:[{index,error}] }

Custom SQL — source_type "custom_sql", source_config.query with {{param}} placeholders.
  Parameters come from URL path, query string, or request body. Sanitized, not interpolated.
  Missing parameters fail fast with a clear error listing which {{name}} had no value and which keys WERE provided.

Auth — auth_type: "public" | "api_token" (default) | "sbox_session" (S&box games plugin)
Caching — cache_enabled: true + cache_ttl (seconds) on GET
Rate limit — rate_limit: { max, window, per: "ip" }
Versioning & canary:
  version: 1..99 (multiple versions coexist on same method+path)
  rollout: { strategy: "full"|"canary", percentage: 0..100, sticky_by: "api_token"|"ip" }
  deprecates: { replaces_version, sunset_date }
Router behavior:
  - Client picks version via ?v=N or header X-API-Version: N; URL /api/v2/... also hints v=2.
  - Canary: deterministic hash(sticky) % 100 < percentage → canary; else stable.
  - Response headers: X-API-Version, Deprecation, Sunset, X-Rollout-Bucket.

Call an endpoint from AI without an HTTP hop:
  call_endpoint({ endpoint_id? or path+method?, params?, body?, bypass_cache? })
  → { status, duration_ms, cache_hit, from_cache_age_seconds?, body }

==========================================================
API TOKENS & SCOPES
==========================================================

Scope model: "<verb>:<resource>"
  verb ∈ { read, write, delete, admin }
  resource = table name or "*"
  admin covers read/write/delete on same resource
  "*" covers any resource for the same verb
  Legacy "read" / "write" / "delete" / "admin" without ":" = "<verb>:*"

Endpoints auto-derive required_scopes from source_config:
  table + find/findOne → read:<table>
  table + create/create_many/update → write:<table>
  table + delete → delete:<table>
  custom_sql + GET → read:*, custom_sql + other → admin:*

If a token's scopes don't cover the endpoint's required_scopes, the router returns HTTP 403 with errorCode DF_SCOPE_DENIED.

Token management tools:
- list_api_tokens() → [{id, name, prefix, scopes, allowed_ips, is_active, expires_at, last_used_at, created_at}]
- create_api_token({ name, scopes, allowed_ips?, expires_at? }) → { token (RAW — store immediately), id, prefix, scopes, ... }
- update_api_token({ token_id, name?, scopes?, allowed_ips?, expires_at? }) → updated record (token hash unchanged)
- rotate_api_token({ token_id }) → { token (RAW new value), revoked_id } — old token deactivated
- revoke_api_token({ token_id }) → { is_active: false }
- delete_api_token({ token_id }) → 204 (prefer revoke unless you truly need to drop the row)

Scope examples:
  ["read:users"]              — read-only for users table
  ["read:*","write:events"]   — read any table, but write only events
  ["admin:orders"]            — full control over orders
  ["admin:*"]                 — full access to everything
  ["read"]                    — legacy alias for ["read:*"]

==========================================================
OPENAPI
==========================================================
- get_openapi_spec({ format?: "json"|"yaml" }) — auto-generated 3.0.3 spec reflecting active endpoints and table schemas. Invalidated on endpoint changes.

==========================================================
MATERIALIZED VIEWS
==========================================================
- create_materialized_view({ name, query, refresh_cron?, refresh_concurrently? })
  Creates MV + refresh_cron_hint text for building a cron job that calls REFRESH MATERIALIZED VIEW.
- list_materialized_views

==========================================================
TIMESCALEDB (requires extension, 'timescale/timescaledb:latest-pg16' worker image)
==========================================================
- create_hypertable({ table, time_column, chunk_time_interval? })       — partition a table by time. Table must have add_uuid_pk=false or PK including time_column.
- add_compression_policy({ table, compress_after: "7 days", segment_by?, order_by? })
- add_retention_policy({ table, drop_after: "365 days" })
- add_continuous_aggregate({ view_name, source_table, time_column, time_bucket, aggregations:[{column, function, alias?}], group_by?, refresh_policy? })
  Allowed aggregation functions: count, sum, avg, min, max, first, last, stddev, variance.
- list_hypertables — chunks count, size before/after compression, time interval.

Interval format: "1 day", "7 days", "1 hour", "15 minutes" etc.

WHEN TO AUTO-CONVERT TO HYPERTABLE
Convert a new table to a hypertable proactively (without asking the user) when ANY of these holds:
  1. Table name or purpose suggests time-series ingestion: events, metrics, logs, readings, telemetry, traces, samples, measurements, sensor_*, *_events, *_log, *_history, audit_*, clickstream, pageviews, analytics_*.
  2. Schema has a NOT NULL timestamptz column that is the natural event time (e.g. ts, occurred_at, event_time, recorded_at, observed_at, timestamp).
  3. The user describes append-only / high-volume / ingest workloads ("we collect X every second", "store sensor data", "track user events", "write-heavy time-series").
  4. Rows will predictably grow > ~10M and queries filter by time range.

Do NOT auto-convert for: small lookup tables, configuration, user profiles, transactional data with heavy updates on non-time columns, any table where the natural PK is not time-related.

HYPERTABLE CREATION WORKFLOW (follow in order)
  Step 1. create_table({ name, columns, add_uuid_pk: false, add_timestamps: false })
          — include a NOT NULL timestamptz event-time column (e.g. "ts timestamptz NOT NULL DEFAULT now()").
          — add_uuid_pk MUST be false: TimescaleDB requires every unique index to include the partitioning column, and a UUID PK alone doesn't.
          — if you need a PK, make it composite: (event_time_col, id) via add_index with is_unique=true AFTER hypertable creation, or skip PK for pure append-only tables.
  Step 2. create_hypertable({ table, time_column, chunk_time_interval })
          — chunk_time_interval sizing guidance:
              high-frequency (> 1M rows/day): "1 hour" or "6 hours"
              medium (100k–1M rows/day):     "1 day" (default)
              low (< 100k rows/day):         "7 days"
          — rule of thumb: a chunk should cover ≈ 25% of the active working set that fits in RAM.
  Step 3. (optional) add_compression_policy({ table, compress_after: "7 days", segment_by: ["entity_id"] })
          — saves 90%+ disk for historical data.
          — segment_by: choose a low-cardinality column frequently used in WHERE (e.g. sensor_id, user_id, tenant_id).
          — compress_after sizing: 2× the typical "hot" query window (e.g. if dashboards query last 3 days → compress_after = "7 days").
  Step 4. (optional) add_retention_policy({ table, drop_after: "365 days" })
          — automatically drops chunks older than the window. Only set if the user has accepted data loss at that age.
  Step 5. (optional) add_continuous_aggregate for dashboards that roll up time_bucket(...) aggregations — faster than querying raw rows.

POST-CREATION CHECKS
  - Verify via list_hypertables that num_chunks > 0 after inserts.
  - For bulk backfill, use execute_sql_mutation with INSERT ... SELECT generate_series(...) or create_many endpoints.

==========================================================
AI STUDIO (plugin — must be enabled in CP under Plugins → AI Studio)
==========================================================
AI Studio lets you create ready-to-use AI endpoints backed by OpenAI / DeepSeek / Claude. Each endpoint
has its own model, system prompt, response format, validation rules and optional chat history.
API keys may be set per endpoint or inherited from plugin-level settings (openai_key / deepseek_key / claude_key).

DISCOVERY
  ai_studio_list_models()                          → { providers, models }
  ai_studio_list_endpoints()                       → [{id, slug, provider, model, is_active, ...}]
  ai_studio_get_endpoint({ endpoint: id|slug })    → full config
  ai_studio_get_stats()                            → { calls_24h, by_provider, by_status, avg_duration_ms, total_tokens }
  ai_studio_get_logs({ endpoint_id?, limit?, offset? }) → recent calls with input/output/tokens/duration/status

LIFECYCLE
  ai_studio_create_endpoint({
    name, provider:"openai"|"deepseek"|"claude", model,
    api_key?, system_prompt?,
    response_format?,       // JSON schema — enables JSON mode; auto-appended to system prompt
    temperature?, max_tokens?,
    context_enabled?, context_ttl_minutes?, max_context_messages?, max_tokens_per_session?,
    validation_rules?,      // { json?, required_fields?, max_length?, contains? }
    retry_on_invalid?, max_retries?
  })                                                → created endpoint
  ai_studio_update_endpoint({ endpoint_id, ...fields })  → updated endpoint
  ai_studio_delete_endpoint({ endpoint_id })        → { deleted }
  // To pause without deleting: update_endpoint with is_active=false

TESTING / INVOCATION
  ai_studio_test_endpoint({ endpoint:id|slug, input:"..." })                         // single turn
  ai_studio_test_endpoint({ endpoint:id|slug, messages:[{role,content},...] })       // multi-turn
  ai_studio_test_endpoint({ endpoint:id|slug, input:"...", session_id:"user-42" })  // uses persisted chat history
  → { content, tokens_used, model, duration_ms, attempts, validation_warning? }

CHAT SESSIONS (when context_enabled=true on endpoint)
  ai_studio_get_session({ endpoint:id|slug, session_id })   → { messages:[...], tokens_used, updated_at }
  ai_studio_clear_session({ endpoint:id|slug, session_id }) → { deleted }

VALIDATION RULES (applied after each model response)
  { "json": true }                                 // must parse as JSON
  { "json": true, "required_fields":["id","ok"] }  // JSON with these keys
  { "max_length": 500 }                            // reject responses longer than N chars
  { "contains": "sorry" }                          // response must contain substring
  Combined with retry_on_invalid=true and max_retries=3, AI Studio will ask the model to fix
  and retry up to N times.

COMMON PATTERNS
  • Structured output: set response_format to a JSON schema — the model is forced into JSON mode
    and the schema is appended to the system prompt.
  • Rate-limited chatbot: context_enabled=true + max_tokens_per_session=20000 + context_ttl_minutes=30.
  • Cached provider pool: leave api_key empty on endpoints — they share the plugin-level key.
  • Disabled but preserved: update_endpoint is_active=false keeps history and logs.

==========================================================
PLUGINS
==========================================================
Each project can enable / disable plugins independently. Some plugins expose new features
(ai-studio, feature-websocket, feature-graphql, feature-webhooks), others integrate with external
services (telegram-bot, discord-webhook, uptime-ping, sbox-auth).

MCP tools:
  list_plugins()                                         → full list + enabled status + manifest
  get_plugin({plugin_id})                                → settings (password fields redacted) + manifest
  enable_plugin({plugin_id, settings?})                  → enable + set initial settings
  disable_plugin({plugin_id})                            → turn off without deleting settings/data
  update_plugin_settings({plugin_id, settings})          → rotate keys, change config

Built-in plugins (canonical IDs):
  ai-rest-gateway       — REST AI gateway for arbitrary LLM clients
  ai-mcp-server         — this MCP interface
  ai-studio             — custom AI endpoints (OpenAI / DeepSeek / Claude)
  feature-webhooks      — outbound HTTP webhooks on data changes
  feature-websocket     — realtime WebSocket subscription to data changes
  feature-graphql       — GraphQL /graphql endpoint auto-generated from schema
  discord-webhook       — post data events to a Discord channel
  telegram-bot          — post data events to a Telegram chat
  uptime-ping           — periodic HTTP health checks
  sbox-auth             — S&box game session auth

==========================================================
WEBHOOKS (plugin: feature-webhooks must be enabled)
==========================================================
Outbound HTTP notifications when rows change. Fires on INSERT/UPDATE/DELETE made via
API endpoints (table CRUD). Direct execute_sql_mutation does NOT fire webhooks —
only endpoint-mediated mutations.

MCP tools:
  list_webhooks()                                        → [{id, table_names, events, url, stats:{total,success_count,last_triggered}}]
  get_webhook({webhook_id})                              → full config incl. secret
  create_webhook({table_names, events, url, ...})        → new webhook
  update_webhook({webhook_id, ...fields})                → partial update
  delete_webhook({webhook_id})                           → permanent delete
  get_webhook_logs({webhook_id, limit?})                 → recent delivery attempts

Delivery payload (JSON):
  {"table":"players", "event":"INSERT",
   "record":{id, steam_id, nick, ...}, "timestamp":"2026-04-18T..."}
Headers:
  X-Webhook-Event: INSERT|UPDATE|DELETE
  X-Webhook-Signature: sha256=<hex>   (present when secret is set; HMAC over JSON body)

Retry: 2s → 4s → 8s → 16s on 5xx or network error. 4xx never retries. Max attempts = retry_count+1.
SSRF guard: URL must be public HTTPS. localhost/private IPs blocked.
Example — notify Slack when a player joins:
  create_webhook({
    table_names: ["players"], events: ["INSERT"],
    url: "https://hooks.slack.com/services/...",
    secret: "my-hmac-key",
    retry_count: 5
  })

==========================================================
WEBSOCKETS (plugin: feature-websocket must be enabled)
==========================================================
Realtime push to browser / mobile / game clients. Same trigger source as webhooks
(API endpoint mutations only).

Connection URL:
  wss://<your-host>/ws/v1/<project-slug>?token=<API_TOKEN>

Authenticate via token query param or "Authorization: Bearer <token>" header. API token must
belong to this project. Failed auth → close code 4001.

Client messages (JSON):
  {"action":"subscribe",   "channel":"project:<slug>"}    — all tables
  {"action":"subscribe",   "channel":"table:<name>"}       — single table
  {"action":"unsubscribe", "channel":"..."}
  {"action":"ping"}

Server events (JSON):
  {"type":"connected", projectSlug, timestamp}
  {"type":"subscribed", channel, timestamp}
  {"type":"data_change", table, action:"INSERT"|"UPDATE"|"DELETE", record, timestamp}
  {"type":"pong", timestamp}
  {"type":"error", code, message}

Limits:
  100 simultaneous connections per project
  50 channels per client socket
  20 client messages / second (rate limited)

MCP tools:
  get_websocket_info()  → connection URL, channel format, event shapes, limits (doc-style)
  get_websocket_stats() → {connectedClients, messagesSent, messagesReceived}

NOTE: subscribing is a client-side activity (MCP is request/response, not streaming). The tools
above document the protocol and report live stats — the AI agent can generate code for the
subscriber but can't itself "stay connected".

==========================================================
CRON JOBS
==========================================================
create_cron_job({
  name, cron_expression,
  action_type: "sql" | "http",
  action_config: ...,                  // see below
  is_active?: boolean,
})

SQL action: { query: "SELECT / INSERT / UPDATE / DELETE ..." }
  DDL is blocked. Runs inside project schema with statement_timeout.

HTTP action: {
  method: "GET|POST|PUT|PATCH|DELETE",
  url: "https://...",                  // HTTPS only; localhost + private IPs blocked (SSRF guard)
  headers?: {...},
  body_sql?: "SELECT COUNT(*) AS n FROM events",    // fills the template
  body_template?: "{\\"text\\":\\"{{n}} events\\"}",  // {{col}} filled from the body_sql row
  retry_policy?: { max_attempts, backoff: "fixed|exponential", initial_delay_ms },
  timeout_ms?: number,                 // default 30000, max 60000
}

Other cron tools: list_cron_jobs, get_cron_job, update_cron_job, delete_cron_job, toggle_cron_job, run_cron_job (execute immediately).

Cron expressions: "* * * * *" (every min), "*/5 * * * *", "0 * * * *" (hourly), "0 0 * * *" (daily), "0 0 * * 1" (weekly), "0 0 1 * *" (monthly).

==========================================================
QUERY PLANNER
==========================================================
explain_query({ sql, params?, analyze? })
  → { plan (raw JSON), total_cost, actual_time_ms?, bottlenecks:[{node_type, rows_scanned, severity, suggestion}], suggested_indexes:[{sql, estimated_improvement_percent, reason}] }
Heuristics: Seq Scan on > 10k rows, Nested Loop without hash, Sort on > 1M rows.

==========================================================
ERROR CONVENTIONS
==========================================================
Errors carry a machine-readable code in error.data (MCP) or error.code (REST):
DF_CONFIRM_WRITE, DF_NOT_MUTATION, DF_DDL_IN_MUTATION, DF_READONLY_ROLE,
DF_INDEX_SUBQUERY, DF_INDEX_SIDEEFFECT, DF_HTTP_SSRF, DF_TIMESCALE_MISSING,
DF_HYPERTABLE_UUID_PK, DF_BATCH_TOO_LARGE, DF_ALIAS_CONFLICT,
DF_MISSING_BINDING, DF_SYSTEM_CATALOG, DF_ALIEN_SCHEMA, DF_SCOPE_DENIED.
Each includes message + cause + suggestion. Use table-alias ≥ 3 chars to avoid DF_ALIAS_CONFLICT.

==========================================================
RECOMMENDED WORKFLOWS
==========================================================

Schema bootstrap:
  1. list_tables / describe_table or get_schema_context
  2. create_table (+ add_foreign_key, add_index)
  3. Validate with analyze_schema_quality

Performance tuning:
  1. execute_sql with EXPLAIN or explain_query to locate slow paths
  2. suggest_index(table) — reports seq_scan/idx_scan ratio
  3. add_index with appropriate type; use where/include/expressions where applicable
  4. For time-series at scale: create_hypertable, add_compression_policy

Creating a time-series ingestion table (events, metrics, logs, sensor data):
  1. create_table({ name, columns: [{ name: "event_time", type: "timestamptz", nullable: false, default_value: "now()" }, ...], add_uuid_pk: false, add_timestamps: false })
  2. create_hypertable({ table, time_column: "event_time", chunk_time_interval: "1 day" })
  3. add_index on low-cardinality filter columns (entity_id, tenant_id) for fast range scans.
  4. add_compression_policy when hot-window is understood (e.g. compress_after = "7 days").
  5. add_retention_policy if the user has an explicit data-lifetime requirement.
  6. Optionally add_continuous_aggregate for dashboard rollups.

Bulk data ingestion (external):
  1. create_endpoint with operation=create_many, conflict_columns, max_batch_size
  2. External client POSTs JSON array or NDJSON to the endpoint
  3. HTTP 207 on partial failure; {inserted, skipped, errors}

Atomic multi-step writes:
  1. begin_transaction → txn_id
  2. multiple execute_sql_mutation calls with txn_id
  3. commit_transaction or rollback_transaction

Safe rollout:
  1. Create endpoint v2 with rollout: { strategy: "canary", percentage: 10 }
  2. Monitor, bump percentage
  3. When ready, update v2 rollout to { strategy: "full" } (or drop v1 via deprecates)

==========================================================
NAMING CONVENTIONS
==========================================================
- Tables: plural lowercase with underscores (users, order_items)
- Columns: lowercase with underscores (user_name, created_at)
- FK columns: target_singular + _id (user_id, category_id)
- Indexes: auto-named idx_{table}_{cols}[_unique]
- Table aliases in SQL: 3+ chars (srv not s) — single-letter aliases trigger DF_ALIAS_CONFLICT`;
  }

  async getContext(projectId: string, dbSchema: string): Promise<AiContextResponse> {
    const tableList = await this.schema.listTables(dbSchema);
    const tables = await Promise.all(
      tableList.map(async (t: { name: string }) => {
        const info = await this.schema.getTableInfo(dbSchema, t.name);
        return info;
      })
    );

    const { rows: endpoints } = await this.db('api_endpoints')
      .where({ project_id: projectId })
      .whereNull('deprecated_at')
      .select('id', 'method', 'path', 'description', 'source_type', 'source_config',
        'auth_type', 'cache_enabled', 'cache_ttl', 'rate_limit', 'is_active');

    const slug = await this.db('_dataforge_projects').where({ id: projectId }).first()
      .then(p => p?.slug)
      .catch(() => null);

    return {
      project: { slug: slug ?? '', schema: dbSchema },
      tables: tables.map(t => ({
        name: t.name,
        columns: t.columns,
        indexes: t.indexes,
        foreign_keys: t.foreign_keys,
        row_count: t.row_count ?? 0,
      })),
      endpoints: endpoints?.map((e: Record<string, unknown>) => ({
        id: e.id,
        method: e.method,
        path: e.path,
        description: e.description,
        source_type: e.source_type,
        source_config: typeof e.source_config === 'string' ? JSON.parse(e.source_config as string) : e.source_config,
        auth_type: e.auth_type,
        cache_enabled: e.cache_enabled,
        cache_ttl: e.cache_ttl,
        rate_limit: e.rate_limit ? (typeof e.rate_limit === 'string' ? JSON.parse(e.rate_limit as string) : e.rate_limit) : null,
        is_active: e.is_active,
      })) ?? [],
    };
  }

  async createTable(dbSchema: string, def: { name: string; columns: unknown[]; add_timestamps?: boolean; add_uuid_pk?: boolean }) {
    return this.schema.createTable(dbSchema, def as Parameters<SchemaService['createTable']>[1]);
  }

  async alterColumns(
    dbSchema: string,
    tableName: string,
    changes: unknown[],
    options: { storage_params?: Record<string, number> } = {},
  ) {
    return this.schema.alterColumns(dbSchema, tableName, changes as Parameters<SchemaService['alterColumns']>[2], options);
  }

  async dropTable(dbSchema: string, tableName: string, projectId?: string) {
    return this.schema.dropTable(dbSchema, tableName, projectId);
  }

  async addIndex(dbSchema: string, tableName: string, idx: {
    columns?: string[];
    expressions?: string[];
    type: string;
    is_unique: boolean;
    name?: string;
    where?: string;
    include?: string[];
    ops_class?: string | string[];
  }) {
    return this.schema.addIndex(dbSchema, tableName, idx as Parameters<SchemaService['addIndex']>[2]);
  }

  async dropIndex(dbSchema: string, indexName: string) {
    return this.schema.dropIndex(dbSchema, indexName);
  }

  async addForeignKey(dbSchema: string, tableName: string, fk: { source_column: string; target_table: string; target_column: string; on_delete?: string; on_update?: string }) {
    return this.schema.addForeignKey(dbSchema, tableName, {
      ...fk,
      on_delete: fk.on_delete ?? 'NO ACTION',
      on_update: fk.on_update ?? 'NO ACTION',
    } as Parameters<SchemaService['addForeignKey']>[2]);
  }

  async dropForeignKey(dbSchema: string, tableName: string, constraintName: string) {
    return this.schema.dropForeignKey(dbSchema, tableName, constraintName);
  }

  async createEndpoint(projectId: string, input: Record<string, unknown>) {
    return this.builder.create(projectId, '00000000-0000-0000-0000-000000000000', input as Parameters<BuilderService['create']>[2]);
  }

  async updateEndpoint(endpointId: string, projectId: string, input: Record<string, unknown>) {
    return this.builder.update(endpointId, projectId, input as Parameters<BuilderService['update']>[2]);
  }

  async deleteEndpoint(endpointId: string, projectId: string) {
    return this.builder.delete(endpointId, projectId);
  }

  async listEndpoints(projectId: string) {
    return this.builder.findAll(projectId);
  }

  async executeSql(dbSchema: string, query: string, timeoutMs = 30000) {
    return this.console.execute(dbSchema, query, 'editor', timeoutMs);
  }

  async executeSqlMutation(
    dbSchema: string,
    query: string,
    opts: { params?: Record<string, unknown>; returning?: boolean; dry_run?: boolean; timeout?: number; trx?: any } = {}
  ) {
    return this.console.executeMutation(dbSchema, query, {
      params: opts.params,
      returning: opts.returning,
      dryRun: opts.dry_run,
      timeoutMs: opts.timeout,
      trx: opts.trx,
    });
  }

  async listTables(dbSchema: string) {
    return this.schema.listTablesFast(dbSchema);
  }

  async describeTable(dbSchema: string, tableName: string) {
    return this.schema.describeTable(dbSchema, tableName);
  }

  async listEndpointsFiltered(projectId: string, filter?: { method?: string; path_contains?: string }) {
    let q = this.db('api_endpoints')
      .where({ project_id: projectId })
      .whereNull('deprecated_at')
      .select('id', 'method', 'path', 'description', 'source_type', 'auth_type', 'cache_enabled', 'cache_ttl', 'rate_limit', 'is_active', 'version');
    if (filter?.method) q = q.where('method', filter.method.toUpperCase());
    if (filter?.path_contains) q = q.where('path', 'ilike', `%${filter.path_contains}%`);
    return q.orderBy('path');
  }

  async listCronJobs(projectId: string) {
    return this.cron.findAll(projectId);
  }

  async getCronJob(jobId: string, projectId: string) {
    return this.cron.findById(jobId, projectId);
  }

  async createCronJob(projectId: string, input: { name: string; cron_expression: string; action_type: string; action_config: Record<string, unknown>; is_active?: boolean }) {
    return this.cron.create(projectId, input);
  }

  async updateCronJob(jobId: string, projectId: string, input: Record<string, unknown>) {
    return this.cron.update(jobId, projectId, input);
  }

  async deleteCronJob(jobId: string, projectId: string) {
    return this.cron.delete(jobId, projectId);
  }

  async toggleCronJob(jobId: string, projectId: string) {
    return this.cron.toggle(jobId, projectId);
  }

  async runCronJob(jobId: string, projectId: string) {
    return this.cron.runNow(jobId, projectId);
  }

  async createHypertable(dbSchema: string, input: Parameters<TimescaleService['createHypertable']>[1]) {
    return this.timescale.createHypertable(dbSchema, input);
  }
  async addContinuousAggregate(dbSchema: string, input: Parameters<TimescaleService['addContinuousAggregate']>[1]) {
    return this.timescale.addContinuousAggregate(dbSchema, input);
  }
  async addCompressionPolicy(dbSchema: string, input: Parameters<TimescaleService['addCompressionPolicy']>[1]) {
    return this.timescale.addCompressionPolicy(dbSchema, input);
  }
  async addRetentionPolicy(dbSchema: string, input: Parameters<TimescaleService['addRetentionPolicy']>[1]) {
    return this.timescale.addRetentionPolicy(dbSchema, input);
  }
  async listHypertables(dbSchema: string) {
    return this.timescale.listHypertables(dbSchema);
  }

  private async cpInternalFetch(path: string, init: RequestInit = {}) {
    const cpUrl = (await import('../../config/env.js')).env.CONTROL_PLANE_URL;
    const nodeKey = (await import('../../config/env.js')).env.NODE_API_KEY;
    if (!cpUrl) throw new Error('CONTROL_PLANE_URL not configured');
    const headers: Record<string, string> = {
      'x-node-api-key': nodeKey,
      ...(init.headers as Record<string, string> | undefined ?? {}),
    };
    if (init.body !== undefined && init.body !== null) {
      headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(`${cpUrl.replace(/\/$/, '')}${path}`, {
      ...init,
      headers,
    });
    const text = await res.text();
    let body: unknown;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    if (!res.ok) throw new Error(`CP ${path} → ${res.status} ${typeof body === 'object' && body && 'error' in body ? (body as Record<string, unknown>).error : text}`);
    return body;
  }

  async listApiTokens(projectId: string) {
    return this.cpInternalFetch(`/internal/tokens/${projectId}`);
  }

  async createApiToken(projectId: string, input: { name: string; scopes: string[]; allowed_ips?: string[]; expires_at?: string }) {
    return this.cpInternalFetch(`/internal/tokens/${projectId}`, { method: 'POST', body: JSON.stringify(input) });
  }

  async updateApiToken(projectId: string, tokenId: string, input: { name?: string; scopes?: string[]; allowed_ips?: string[] | null; expires_at?: string | null }) {
    return this.cpInternalFetch(`/internal/tokens/${projectId}/${tokenId}`, { method: 'PUT', body: JSON.stringify(input) });
  }

  async rotateApiToken(projectId: string, tokenId: string) {
    return this.cpInternalFetch(`/internal/tokens/${projectId}/${tokenId}/rotate`, { method: 'POST', body: '{}' });
  }

  async revokeApiToken(projectId: string, tokenId: string) {
    return this.cpInternalFetch(`/internal/tokens/${projectId}/${tokenId}/revoke`, { method: 'POST', body: '{}' });
  }

  async deleteApiToken(projectId: string, tokenId: string) {
    return this.cpInternalFetch(`/internal/tokens/${projectId}/${tokenId}`, { method: 'DELETE' });
  }

  async explainQuery(dbSchema: string, sql: string, params: Record<string, unknown> = {}, analyze = false) {
    return this.analyzer.analyze(dbSchema, sql, params, analyze);
  }

async createMaterializedView(dbSchema: string, input: Parameters<SchemaService['createMaterializedView']>[1]) {
    return this.schema.createMaterializedView(dbSchema, input);
  }
  async listMaterializedViews(dbSchema: string) {
    return this.schema.listMaterializedViews(dbSchema);
  }

  async searchEndpoints(projectId: string, query: string) {
    const q = `%${query.toLowerCase()}%`;
    return this.db('api_endpoints')
      .where({ project_id: projectId })
      .whereNull('deprecated_at')
      .where(function(this: import('knex').Knex.QueryBuilder) {
        this.whereRaw('LOWER(path) LIKE ?', [q])
          .orWhereRaw('LOWER(description) LIKE ?', [q])
          .orWhereRaw("source_config::text ILIKE ?", [q]);
      })
      .select('id', 'method', 'path', 'description', 'source_type', 'version')
      .orderBy('path');
  }

  async suggestIndex(dbSchema: string, tableName: string) {
    const result: any = await this.db.raw(`
      SELECT
        schemaname AS schema,
        relname AS table,
        seq_scan,
        seq_tup_read,
        idx_scan,
        idx_tup_fetch,
        n_live_tup AS estimated_rows
      FROM pg_stat_user_tables
      WHERE schemaname = ? AND relname = ?
    `, [dbSchema, tableName]);
    const row = result.rows[0];
    if (!row) return { table: tableName, message: 'Table not found or no stats available yet.' };

    const suggestions: Array<{ reason: string; priority: 'low' | 'medium' | 'high'; suggested_sql?: string }> = [];
    if (row.seq_scan > row.idx_scan * 5 && row.estimated_rows > 10_000) {
      suggestions.push({
        reason: `Sequential scans (${row.seq_scan}) dominate index scans (${row.idx_scan}). Table has ${row.estimated_rows} rows. Identify common WHERE/JOIN columns and add indexes.`,
        priority: 'high',
        suggested_sql: `-- Use explain_query on a typical query to identify filter columns, then:\n-- CREATE INDEX idx_${tableName}_<col> ON "${dbSchema}"."${tableName}" (<col>)`,
      });
    }
    return {
      table: tableName,
      stats: {
        seq_scans: row.seq_scan,
        index_scans: row.idx_scan,
        estimated_rows: row.estimated_rows,
      },
      suggestions,
    };
  }

  async analyzeSchemaQuality(dbSchema: string) {
    const issues: Array<{ severity: 'low' | 'medium' | 'high'; code: string; message: string; table?: string; column?: string }> = [];

    const tables: any = await this.db.raw(`
      SELECT
        t.relname AS table,
        t.reltuples::bigint AS estimated_rows,
        pg_total_relation_size(t.oid) AS size_bytes,
        (SELECT COUNT(*) FROM pg_index i WHERE i.indrelid = t.oid) AS index_count,
        (SELECT COUNT(*) FROM pg_index i WHERE i.indrelid = t.oid AND i.indisprimary) AS has_pk
      FROM pg_class t
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = ? AND t.relkind = 'r'
    `, [dbSchema]);

    for (const row of tables.rows) {
      if (Number(row.has_pk) === 0) {
        issues.push({ severity: 'high', code: 'NO_PRIMARY_KEY', message: `Table has no primary key.`, table: row.table });
      }
      if (Number(row.estimated_rows) > 100_000 && Number(row.index_count) <= 1) {
        issues.push({ severity: 'medium', code: 'LARGE_TABLE_FEW_INDEXES', message: `Table has ${row.estimated_rows} rows but only ${row.index_count} index(es). Consider adding indexes on frequently queried columns.`, table: row.table });
      }
    }

    const unusedIdx: any = await this.db.raw(`
      SELECT schemaname, relname AS table, indexrelname AS index, idx_scan
      FROM pg_stat_user_indexes
      WHERE schemaname = ? AND idx_scan = 0
    `, [dbSchema]).catch(() => ({ rows: [] }));
    for (const row of unusedIdx.rows) {
      issues.push({ severity: 'low', code: 'UNUSED_INDEX', message: `Index "${row.index}" has never been used. Consider dropping.`, table: row.table });
    }

    return {
      tables_checked: tables.rows.length,
      issues,
    };
  }

  async getOpenapiSpec(projectId: string, projectSlug: string, dbSchema: string, baseUrl: string, format: 'json' | 'yaml' = 'json') {
    const openapi = new OpenAPIService(this.db);
    const spec = await openapi.generateSpec(projectSlug, projectId, dbSchema, baseUrl);
    if (format === 'yaml') {
      const yaml = await import('js-yaml').then(m => m.default ?? m).catch(() => null);
      if (yaml && typeof (yaml as any).dump === 'function') {
        return { format: 'yaml', content: (yaml as any).dump(spec) };
      }
      return { format: 'json', content: spec, note: 'YAML requested but js-yaml is not installed; returning JSON.' };
    }
    return spec;
  }

  async logActivity(entry: AiGatewayLogEntry) {
    try {
      await this.db('ai_gateway_logs').insert({
        project_id: entry.project_id,
        gateway_type: entry.gateway_type,
        tool_name: entry.tool_name,
        request_summary: entry.request_summary ? JSON.stringify(entry.request_summary) : null,
        response_status: entry.response_status,
        duration_ms: entry.duration_ms,
      });
    } catch {}
  }

  async getActivity(projectId: string, limit = 50, offset = 0) {
    return this.db('ai_gateway_logs')
      .where({ project_id: projectId })
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset);
  }

  async getStats(projectId: string) {
    const total = await this.db('ai_gateway_logs').where({ project_id: projectId }).count('* as count').first();
    const byTool = await this.db('ai_gateway_logs')
      .where({ project_id: projectId })
      .groupBy('tool_name')
      .select('tool_name')
      .count('* as count')
      .orderBy('count', 'desc');
    const byGateway = await this.db('ai_gateway_logs')
      .where({ project_id: projectId })
      .groupBy('gateway_type')
      .select('gateway_type')
      .count('* as count');
    const avgDuration = await this.db('ai_gateway_logs')
      .where({ project_id: projectId })
      .avg('duration_ms as avg_ms')
      .first();

    return {
      total_calls: Number((total as Record<string, unknown>)?.count ?? 0),
      by_tool: byTool,
      by_gateway: byGateway,
      avg_duration_ms: Math.round(Number((avgDuration as Record<string, unknown>)?.avg_ms ?? 0)),
    };
  }
}
