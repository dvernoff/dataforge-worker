import type { Knex } from 'knex';
import { SchemaService } from '../schema/schema.service.js';
import { BuilderService } from '../api-builder/builder.service.js';
import { ConsoleService } from '../sql-console/console.service.js';
import { CronService } from '../cron/cron.service.js';
import type { AiContextResponse, AiGatewayLogEntry } from './ai-gateway.types.js';

export class AiGatewayService {
  private schema: SchemaService;
  private builder: BuilderService;
  private console: ConsoleService;
  private cron: CronService;

  constructor(private db: Knex) {
    this.schema = new SchemaService(db);
    this.builder = new BuilderService(db);
    this.console = new ConsoleService(db);
    this.cron = new CronService(db);
  }

  getProjectInfo(): string {
    return `DataForge is a backend-as-a-service platform built on PostgreSQL. You are connected to a DataForge project via the AI Gateway.

CAPABILITIES:
- Create/alter/drop database tables with columns, indexes, and foreign keys
- Create API endpoints — table-based CRUD or custom SQL with parameterized queries
- Configure caching, rate limiting, and authentication per endpoint
- Execute read-only SQL for analysis, debugging, and optimization

COLUMN TYPES: text, integer, bigint, float, decimal, boolean, date, timestamp, timestamptz, uuid, json, jsonb, text[], integer[], serial, bigserial

INDEX TYPES (use add_index):
- btree (default) — equality, range, ORDER BY, LIKE 'prefix%'
- hash — equality only, smaller than btree
- gin — JSONB containment (@>), array overlap (&&), full-text search
- gist — geometric, range types, full-text with ts_vector

FOREIGN KEYS (use add_foreign_key):
- on_delete/on_update: CASCADE (delete/update children), SET NULL, RESTRICT (block), NO ACTION (default)
- Always create the referenced table first, then add FK
- Add btree index on FK columns for JOIN performance

CREATING TABLES (use create_table):
- add_uuid_pk: true — auto-adds "id" UUID PRIMARY KEY DEFAULT gen_random_uuid()
- add_timestamps: true — auto-adds created_at/updated_at TIMESTAMPTZ
- Define only your business columns, system columns are auto-added

ALTERING TABLES (use alter_columns):
- changes: [{action: "add", name, type, nullable, default_value, is_unique}]
- changes: [{action: "alter", name, type, nullable}] — change type or nullable
- changes: [{action: "rename", name: "old_name", newName: "new_name"}]
- changes: [{action: "drop", name}] — WARNING: deletes data in column

API ENDPOINTS (use create_endpoint):
- Table CRUD: source_type "table", source_config: {table: "users", operation: "find|findOne|create|update|delete"}
  - find: GET, returns all rows (supports ?limit, ?offset, ?sort, ?filter)
  - findOne: GET with :id param, returns single row
  - create: POST, inserts row from body
  - update: PUT with :id param, updates row from body
  - delete: DELETE with :id param
- Custom SQL: source_type "custom_sql", source_config: {query: "SELECT * FROM users WHERE role = {{role}}"}
  - {{param}} — replaced with values from URL path params, query string, or request body
  - Parameters are automatically sanitized (SQL injection safe)
- auth_type: "api_token" (default, requires x-api-key) or "public" (no auth)
- cache_enabled: true + cache_ttl: seconds — cache GET responses
- rate_limit: {max: 100, window: 60000, per: "ip"} — requests per window in ms

OPTIMIZATION WORKFLOW:
1. Call get_schema_context to understand current state
2. Use execute_sql with EXPLAIN ANALYZE to find slow queries
3. Add indexes on columns in WHERE, JOIN ON, ORDER BY, GROUP BY
4. Add composite indexes for multi-column filters: {columns: ["status", "created_at"]}
5. Use hash index for exact equality (status, type), btree for ranges (date, amount)
6. Use gin index for JSONB columns with @> queries
7. Enable caching on read-heavy endpoints, set appropriate TTL
8. Add rate limits on public endpoints to prevent abuse

NAMING CONVENTIONS:
- Tables: plural lowercase with underscores (users, order_items)
- Columns: lowercase with underscores (user_name, created_at)
- FK columns: target_table_singular + _id (user_id, category_id)
- Indexes: auto-named as idx_tablename_columns

CRON JOBS (scheduled tasks):
- list_cron_jobs — view all scheduled jobs with status
- get_cron_job — get job details and recent execution history
- create_cron_job — schedule recurring SQL tasks (e.g. cleanup, aggregation, reports)
- update_cron_job — change schedule, query, or name
- delete_cron_job — remove a scheduled job permanently
- toggle_cron_job — pause/resume a job without deleting it
- run_cron_job — execute a job immediately to test it

CRON EXPRESSIONS:
- "* * * * *" — every minute
- "*/5 * * * *" — every 5 minutes
- "0 * * * *" — every hour
- "0 0 * * *" — daily at midnight
- "0 0 * * 1" — every Monday at midnight
- "0 0 1 * *" — first day of month at midnight

CRON SAFETY:
- DDL (DROP, ALTER, CREATE, TRUNCATE, GRANT, REVOKE) is blocked
- Mutations in WITH clauses are blocked
- Queries run with project schema isolation and timeout (max 120s)`;
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

  async alterColumns(dbSchema: string, tableName: string, changes: unknown[]) {
    return this.schema.alterColumns(dbSchema, tableName, changes as Parameters<SchemaService['alterColumns']>[2]);
  }

  async dropTable(dbSchema: string, tableName: string, projectId?: string) {
    return this.schema.dropTable(dbSchema, tableName, projectId);
  }

  async addIndex(dbSchema: string, tableName: string, idx: { columns: string[]; type: string; is_unique: boolean; name?: string }) {
    return this.schema.addIndex(dbSchema, tableName, idx);
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
