export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const MCP_TOOLS: McpToolDef[] = [
  {
    name: 'get_project_info',
    description: 'Learn about DataForge platform capabilities and how to work with this project. Call this first if you are unfamiliar with DataForge. Returns a guide explaining the platform, available tools, data types, best practices, and workflow recommendations.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_schema_context',
    description: 'Get the complete current project schema: all tables with their columns (name, type, nullable, default, primary, unique), all indexes, all foreign key constraints, and all API endpoints with their configuration. Heavy on projects with many tables — prefer list_tables + describe_table(name) for large schemas.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'list_tables',
    description: 'Fast thin listing of tables with row count estimates (pg_class.reltuples, not COUNT(*)), total size in bytes, and is_hypertable flag. P95 ≤ 500ms even on large schemas.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'describe_table',
    description: 'Get details for a single table: columns, indexes, foreign keys, and hypertable_info (if TimescaleDB). Faster than get_schema_context for targeted introspection.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Table name' } },
      required: ['name'],
    },
  },
  {
    name: 'list_endpoints',
    description: 'List API endpoints with optional filters. Returns id, method, path, source_type, auth_type, is_active, version.',
    inputSchema: {
      type: 'object',
      properties: {
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
        path_contains: { type: 'string', description: 'Case-insensitive substring match on path' },
      },
      required: [],
    },
  },
  {
    name: 'create_table',
    description: 'Create a new PostgreSQL table. By default adds a UUID "id" primary key and created_at/updated_at timestamps. Define only your business columns — system columns are auto-added based on options. Supports per-column and table-level CHECK constraints.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Table name (lowercase, underscores)' },
        columns: {
          type: 'array', items: {
            type: 'object', properties: {
              name: { type: 'string' },
              type: { type: 'string', description: 'text|integer|bigint|float|decimal|boolean|date|timestamp|timestamptz|uuid|json|jsonb|inet|cidr|macaddr|text[]|integer[]|inet[]|serial|bigserial. inet/cidr store IP addresses natively (IPv4+IPv6) and support network operators (<<, <<=, >>, &&) for CIDR-range queries.' },
              nullable: { type: 'boolean', default: true },
              default_value: { type: 'string', description: 'SQL expression or literal. Typed casts preserved: "\'[]\'::jsonb", "0::bigint", "now()", "gen_random_uuid()". Plain strings (e.g. "active") are auto-quoted as string literals.' },
              is_unique: { type: 'boolean', default: false },
              is_primary: { type: 'boolean', default: false },
              check: { type: 'string', description: 'Column-level CHECK expression, e.g. "role IN (\'admin\',\'user\')" or "price >= 0". Column name is implicit.' },
            }, required: ['name', 'type'],
          },
        },
        add_uuid_pk: { type: 'boolean', default: true, description: 'Auto-add UUID id primary key' },
        add_timestamps: { type: 'boolean', default: true, description: 'Shortcut: true adds both created_at AND updated_at. For fine-grained control, use add_created_at / add_updated_at.' },
        add_created_at: { type: 'boolean', description: 'Explicit override for created_at. If omitted, follows add_timestamps.' },
        add_updated_at: { type: 'boolean', description: 'Explicit override for updated_at (also installs update trigger). If omitted, follows add_timestamps.' },
        checks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Optional constraint name. Defaults to chk_{table}_{n}.' },
              expression: { type: 'string', description: 'Boolean SQL expression, e.g. "end_at > start_at" or "status IN (\'open\',\'closed\')".' },
            },
            required: ['expression'],
          },
          description: 'Table-level CHECK constraints (for multi-column or named checks).',
        },
        storage_params: {
          type: 'object',
          description: 'PostgreSQL table storage parameters. Allowed: fillfactor (10-100), autovacuum_vacuum_scale_factor (0-1), autovacuum_vacuum_threshold, autovacuum_analyze_scale_factor, autovacuum_analyze_threshold. Example: {"fillfactor":85} — recommended for write-heavy tables to enable HOT updates.',
          properties: {
            fillfactor: { type: 'number', minimum: 10, maximum: 100 },
            autovacuum_vacuum_scale_factor: { type: 'number', minimum: 0, maximum: 1 },
            autovacuum_vacuum_threshold: { type: 'number' },
            autovacuum_analyze_scale_factor: { type: 'number', minimum: 0, maximum: 1 },
            autovacuum_analyze_threshold: { type: 'number' },
          },
        },
      },
      required: ['name', 'columns'],
    },
  },
  {
    name: 'alter_columns',
    description: 'Alter an existing table: add/alter/drop/rename columns, set or drop the PRIMARY KEY (single or composite), or tune storage parameters (fillfactor). Multiple changes execute sequentially in the same call.',
    inputSchema: {
      type: 'object',
      properties: {
        table_name: { type: 'string' },
        changes: {
          type: 'array', items: {
            type: 'object', properties: {
              action: { type: 'string', enum: ['add', 'alter', 'drop', 'rename', 'set_primary_key', 'drop_primary_key'] },
              name: { type: 'string', description: 'Column name. Required for add/alter/drop/rename. Not used for set_primary_key / drop_primary_key.' },
              newName: { type: 'string' },
              type: { type: 'string' },
              nullable: { type: 'boolean' },
              default_value: { type: 'string' },
              is_unique: { type: 'boolean' },
              json_schema: { type: 'object', description: 'For jsonb columns: attach a CHECK (jsonb_matches_schema(...)) constraint. Requires pg_jsonschema extension.' },
              columns: { type: 'array', items: { type: 'string' }, description: 'For set_primary_key: list of columns for the PK (composite supported).' },
              constraint_name: { type: 'string', description: 'For set_primary_key: optional name for the PK constraint. Default: {table}_pkey.' },
            }, required: ['action'],
          },
        },
        storage_params: {
          type: 'object',
          description: 'Tune PostgreSQL storage parameters on the existing table. Same keys as in create_table. Emits ALTER TABLE ... SET (key = value).',
          properties: {
            fillfactor: { type: 'number', minimum: 10, maximum: 100 },
            autovacuum_vacuum_scale_factor: { type: 'number', minimum: 0, maximum: 1 },
            autovacuum_vacuum_threshold: { type: 'number' },
            autovacuum_analyze_scale_factor: { type: 'number', minimum: 0, maximum: 1 },
            autovacuum_analyze_threshold: { type: 'number' },
          },
        },
      },
      required: ['table_name'],
    },
  },
  {
    name: 'drop_table',
    description: 'Drop a table and all its data, indexes, and endpoints.',
    inputSchema: {
      type: 'object',
      properties: { table_name: { type: 'string' } },
      required: ['table_name'],
    },
  },
  {
    name: 'add_index',
    description: 'Add an index to a table for query optimization. Supports plain columns OR expressions (e.g. "lower(email)"), partial indexes via where, and covering indexes via include.',
    inputSchema: {
      type: 'object',
      properties: {
        table_name: { type: 'string' },
        columns: { type: 'array', items: { type: 'string' }, description: 'Plain column names. Use either columns OR expressions.' },
        expressions: { type: 'array', items: { type: 'string' }, description: 'Expression index, e.g. ["lower(email)"] or ["(data->>\'status\')"].' },
        type: { type: 'string', enum: ['btree', 'hash', 'gin', 'gist', 'brin'], default: 'btree' },
        is_unique: { type: 'boolean', default: false },
        where: { type: 'string', description: 'Partial index predicate, e.g. "status = \'completed\'". Subqueries and side-effect functions are blocked.' },
        include: { type: 'array', items: { type: 'string' }, description: 'INCLUDE columns for covering index (btree only).' },
        name: { type: 'string', description: 'Custom index name. Default: idx_{table}_{cols}[_unique]' },
      },
      required: ['table_name'],
    },
  },
  {
    name: 'drop_index',
    description: 'Drop an index by name.',
    inputSchema: {
      type: 'object',
      properties: { index_name: { type: 'string' } },
      required: ['index_name'],
    },
  },
  {
    name: 'add_foreign_key',
    description: 'Add a foreign key constraint between tables.',
    inputSchema: {
      type: 'object',
      properties: {
        table_name: { type: 'string' }, source_column: { type: 'string' },
        target_table: { type: 'string' }, target_column: { type: 'string' },
        on_delete: { type: 'string', enum: ['CASCADE', 'SET NULL', 'RESTRICT', 'NO ACTION'], default: 'NO ACTION' },
        on_update: { type: 'string', enum: ['CASCADE', 'SET NULL', 'RESTRICT', 'NO ACTION'], default: 'NO ACTION' },
      },
      required: ['table_name', 'source_column', 'target_table', 'target_column'],
    },
  },
  {
    name: 'drop_foreign_key',
    description: 'Drop a foreign key constraint by name.',
    inputSchema: {
      type: 'object',
      properties: { table_name: { type: 'string' }, constraint_name: { type: 'string' } },
      required: ['table_name', 'constraint_name'],
    },
  },
  {
    name: 'create_endpoint',
    description: 'Create an API endpoint (table-based CRUD or custom SQL).',
    inputSchema: {
      type: 'object',
      properties: {
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
        path: { type: 'string', description: 'URL path starting with /' },
        description: { type: 'string' },
        source_type: { type: 'string', enum: ['table', 'custom_sql'] },
        source_config: { type: 'object', description: 'For table: {table, operation}. For custom_sql: {query}' },
        auth_type: { type: 'string', enum: ['api_token', 'public'], default: 'api_token' },
        cache_enabled: { type: 'boolean', default: false },
        cache_ttl: { type: 'number', description: 'Cache TTL in seconds (1-86400)' },
        rate_limit: { type: 'object', properties: { max: { type: 'number' }, window: { type: 'number' }, per: { type: 'string' } } },
        version: { type: 'number', description: 'Endpoint version (integer). Default 1. Router honors ?v=, X-API-Version, or /api/v{N}/.' },
        rollout: {
          type: 'object',
          properties: {
            strategy: { type: 'string', enum: ['full', 'canary'] },
            percentage: { type: 'number', description: '0-100. For canary.' },
            sticky_by: { type: 'string', enum: ['api_token', 'ip'], description: 'Sticky dimension for canary hash.' },
          },
        },
        deprecates: {
          type: 'object',
          properties: {
            replaces_version: { type: 'number' },
            sunset_date: { type: 'string', description: 'ISO date when the endpoint should be removed.' },
          },
        },
      },
      required: ['method', 'path', 'source_type', 'source_config'],
    },
  },
  {
    name: 'update_endpoint',
    description: 'Update an existing API endpoint.',
    inputSchema: {
      type: 'object',
      properties: {
        endpoint_id: { type: 'string' },
        method: { type: 'string' }, path: { type: 'string' }, description: { type: 'string' },
        source_type: { type: 'string' }, source_config: { type: 'object' },
        auth_type: { type: 'string' }, cache_enabled: { type: 'boolean' }, cache_ttl: { type: 'number' },
        rate_limit: { type: 'object' }, is_active: { type: 'boolean' },
      },
      required: ['endpoint_id'],
    },
  },
  {
    name: 'delete_endpoint',
    description: 'Delete an API endpoint.',
    inputSchema: {
      type: 'object',
      properties: { endpoint_id: { type: 'string' } },
      required: ['endpoint_id'],
    },
  },
  {
    name: 'execute_sql',
    description: 'Execute a read-only SQL query (SELECT/EXPLAIN/WITH only).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'SQL query (SELECT only)' },
        timeout: { type: 'number', description: 'Timeout in ms (default 30000, max 120000)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'execute_sql_mutation',
    description: 'Execute a write SQL statement (INSERT, UPDATE, DELETE, MERGE). DDL (DROP/TRUNCATE/ALTER/CREATE/GRANT/REVOKE) is blocked — use schema tools instead. Requires confirm_write=true as an explicit guard. Supports {{name}} placeholders bound from "params".',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'SQL mutation (INSERT/UPDATE/DELETE/MERGE; WITH + mutation allowed). Use {{name}} for parameters.' },
        confirm_write: { type: 'boolean', description: 'Must be true to actually execute. Explicit guard.' },
        params: { type: 'object', description: 'Parameter values for {{name}} placeholders. Example: {"id":"abc","active":true}' },
        returning: { type: 'boolean', description: 'Add RETURNING * if not already present (default false).' },
        dry_run: { type: 'boolean', description: 'Execute in a transaction and roll back. Returns affected row count without persisting.' },
        timeout: { type: 'number', description: 'Timeout in ms (default 30000, max 120000)' },
        txn_id: { type: 'string', description: 'Optional open transaction (from begin_transaction). Multiple mutations inside a txn commit atomically.' },
      },
      required: ['query', 'confirm_write'],
    },
  },
  {
    name: 'create_hypertable',
    description: 'Convert a table to a TimescaleDB hypertable partitioned by a time column. Requires TimescaleDB extension.',
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string' },
        time_column: { type: 'string', description: 'timestamptz or timestamp column used as the partitioning dimension' },
        chunk_time_interval: { type: 'string', description: 'e.g. "1 day", "7 days", "1 hour". Default: "1 day"' },
      },
      required: ['table', 'time_column'],
    },
  },
  {
    name: 'add_continuous_aggregate',
    description: 'Create a continuous aggregate (materialized view with timescaledb.continuous) over a hypertable.',
    inputSchema: {
      type: 'object',
      properties: {
        view_name: { type: 'string' },
        source_table: { type: 'string' },
        time_column: { type: 'string' },
        time_bucket: { type: 'string', description: 'e.g. "1 hour", "1 day"' },
        aggregations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              column: { type: 'string' },
              function: { type: 'string', enum: ['count', 'sum', 'avg', 'min', 'max', 'first', 'last', 'stddev', 'variance'] },
              alias: { type: 'string' },
            },
            required: ['column', 'function'],
          },
        },
        group_by: { type: 'array', items: { type: 'string' } },
        refresh_policy: {
          type: 'object',
          properties: {
            start_offset: { type: 'string' },
            end_offset: { type: 'string' },
            schedule_interval: { type: 'string' },
          },
        },
      },
      required: ['view_name', 'source_table', 'time_column', 'time_bucket', 'aggregations'],
    },
  },
  {
    name: 'add_compression_policy',
    description: 'Compress older chunks of a hypertable automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string' },
        compress_after: { type: 'string', description: 'e.g. "7 days" — chunks older than this are compressed' },
        segment_by: { type: 'array', items: { type: 'string' } },
        order_by: { type: 'string' },
      },
      required: ['table', 'compress_after'],
    },
  },
  {
    name: 'add_retention_policy',
    description: 'Automatically drop chunks older than the given interval.',
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string' },
        drop_after: { type: 'string', description: 'e.g. "365 days"' },
      },
      required: ['table', 'drop_after'],
    },
  },
  {
    name: 'list_hypertables',
    description: 'List TimescaleDB hypertables in the project with chunk count, compression, size before/after.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'create_materialized_view',
    description: 'Create a materialized view. To auto-refresh, create a cron job that runs "REFRESH MATERIALIZED VIEW schema.view".',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        query: { type: 'string', description: 'SELECT statement backing the view.' },
        refresh_cron: { type: 'string', description: 'Optional cron expression. Returns a hint for creating the refresh job.' },
        refresh_concurrently: { type: 'boolean' },
      },
      required: ['name', 'query'],
    },
  },
  {
    name: 'list_materialized_views',
    description: 'List materialized views in the project.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'search_endpoints',
    description: 'Search endpoints by path/description/source_config (case-insensitive substring).',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
  {
    name: 'suggest_index',
    description: 'Look at pg_stat for the given table and suggest indexes if sequential scans dominate.',
    inputSchema: {
      type: 'object',
      properties: { table: { type: 'string' } },
      required: ['table'],
    },
  },
  {
    name: 'analyze_schema_quality',
    description: 'Scan all tables and report schema quality issues: missing PKs, large tables with few indexes, unused indexes.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'explain_query',
    description: 'Explain and analyze a SQL query. Returns the plan tree, total cost, bottlenecks (Seq Scan on >10k rows, Nested Loop without hash, big Sort), and suggested CREATE INDEX statements.',
    inputSchema: {
      type: 'object',
      properties: {
        sql: { type: 'string' },
        params: { type: 'object', description: 'Values for {{name}} placeholders.' },
        analyze: { type: 'boolean', description: 'Run EXPLAIN ANALYZE (actually executes inside a rolled-back txn). Default false.' },
      },
      required: ['sql'],
    },
  },
  {
    name: 'begin_transaction',
    description: 'Open a database transaction that survives across MCP calls. Pass the returned txn_id to subsequent write tools (currently execute_sql_mutation) to run them atomically. Auto-rollback on timeout or disconnect.',
    inputSchema: {
      type: 'object',
      properties: {
        timeout_seconds: { type: 'number', description: 'Auto-rollback after this many seconds. Default 600. Max 1800.' },
      },
      required: [],
    },
  },
  {
    name: 'commit_transaction',
    description: 'Commit an open transaction.',
    inputSchema: { type: 'object', properties: { txn_id: { type: 'string' } }, required: ['txn_id'] },
  },
  {
    name: 'rollback_transaction',
    description: 'Roll back an open transaction.',
    inputSchema: { type: 'object', properties: { txn_id: { type: 'string' } }, required: ['txn_id'] },
  },
  {
    name: 'list_transactions',
    description: 'List active transactions for this project.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_openapi_spec',
    description: 'Return the auto-generated OpenAPI 3.0 spec for this project. Reflects all active endpoints and table schemas.',
    inputSchema: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['json', 'yaml'], default: 'json', description: 'Response format (yaml requires js-yaml — currently falls back to JSON).' },
      },
      required: [],
    },
  },
  {
    name: 'call_endpoint',
    description: 'Invoke a project API endpoint internally (no HTTP hop). Auth is implicit — the MCP session already authenticated. Use this to test endpoints or chain calls from schema tools to data.',
    inputSchema: {
      type: 'object',
      properties: {
        endpoint_id: { type: 'string', description: 'UUID of the endpoint. Alternatively provide path + method.' },
        path: { type: 'string', description: 'e.g. "/users/:id". Used when endpoint_id is not provided.' },
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], description: 'Default GET. Only used when endpoint_id is not provided.' },
        params: { type: 'object', description: 'Merged path+query parameters. Example: {"id":"abc","limit":"10"}' },
        body: { description: 'Request body (object or array for create_many).' },
        headers: { type: 'object', description: 'Additional headers (mostly ignored in internal dispatch).' },
        bypass_cache: { type: 'boolean', description: 'If true, skip reading/writing cache even when endpoint has caching enabled.' },
      },
      required: [],
    },
  },
  {
    name: 'list_api_tokens',
    description: 'List all API tokens of this project (metadata only — raw tokens are never retrievable after creation). Returns id, name, prefix, scopes, allowed_ips, is_active, expires_at, last_used_at, created_at.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'create_api_token',
    description: 'Create a new API token. Returns the raw token ONCE — store it immediately, it cannot be retrieved later. Scopes grant per-table access: "read:<table>" / "write:<table>" / "delete:<table>" / "admin:<table>", or wildcard "read:*" / "admin:*". Legacy "read" / "write" / "delete" / "admin" are equivalent to "<verb>:*".',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Human-readable label.' },
        scopes: { type: 'array', items: { type: 'string' }, description: 'e.g. ["read:users","write:orders"] or ["admin:*"].' },
        allowed_ips: { type: 'array', items: { type: 'string' }, description: 'Optional IP allowlist.' },
        expires_at: { type: 'string', description: 'Optional ISO-8601 expiration.' },
      },
      required: ['name', 'scopes'],
    },
  },
  {
    name: 'update_api_token',
    description: 'Update an existing token (name/scopes/allowed_ips/expires_at). Token hash and raw value stay the same; only permissions and metadata change. Synced to the worker cache immediately.',
    inputSchema: {
      type: 'object',
      properties: {
        token_id: { type: 'string' },
        name: { type: 'string' },
        scopes: { type: 'array', items: { type: 'string' } },
        allowed_ips: { type: 'array', items: { type: 'string' } },
        expires_at: { type: 'string' },
      },
      required: ['token_id'],
    },
  },
  {
    name: 'rotate_api_token',
    description: 'Issue a new token with the same scopes and revoke the old one. Returns the new raw token ONCE. Use this when a token is suspected leaked.',
    inputSchema: {
      type: 'object',
      properties: { token_id: { type: 'string' } },
      required: ['token_id'],
    },
  },
  {
    name: 'revoke_api_token',
    description: 'Revoke a token (set is_active=false) without deleting the record. Revoked tokens cannot be re-enabled — create a new one instead.',
    inputSchema: {
      type: 'object',
      properties: { token_id: { type: 'string' } },
      required: ['token_id'],
    },
  },
  {
    name: 'delete_api_token',
    description: 'Permanently delete a token record. Prefer revoke_api_token unless you need to remove the row entirely.',
    inputSchema: {
      type: 'object',
      properties: { token_id: { type: 'string' } },
      required: ['token_id'],
    },
  },
  {
    name: 'list_cron_jobs',
    description: 'List all cron jobs in the project. Returns each job with its name, cron expression, active status, last run info, and run count.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_cron_job',
    description: 'Get details of a specific cron job including its configuration and the 20 most recent run results.',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'UUID of the cron job' },
      },
      required: ['job_id'],
    },
  },
  {
    name: 'create_cron_job',
    description: 'Create a new scheduled cron job. Currently supports SQL action type. The job executes the query on the configured schedule. DDL statements (DROP, ALTER, CREATE, etc.) are blocked for safety.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Human-readable job name' },
        cron_expression: { type: 'string', description: 'Cron schedule expression, e.g. "0 * * * *" (every hour), "*/5 * * * *" (every 5 min), "0 0 * * *" (daily midnight)' },
        action_type: { type: 'string', enum: ['sql', 'http'], description: 'Type of action. "sql" runs a query; "http" calls an external HTTPS URL.' },
        action_config: {
          type: 'object',
          description: 'For sql: { "query": "SELECT ..." }. For http: { "method", "url" (https only), "headers"?, "body_template"?, "body_sql"?, "retry_policy"? { max_attempts, backoff: fixed|exponential, initial_delay_ms }, "timeout_ms"? (≤60000) }',
        },
        is_active: { type: 'boolean', default: true, description: 'Whether the job starts active (default true)' },
      },
      required: ['name', 'cron_expression', 'action_type', 'action_config'],
    },
  },
  {
    name: 'update_cron_job',
    description: 'Update an existing cron job. Only provided fields are changed. The job is automatically rescheduled if the cron expression or active status changes.',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'UUID of the cron job to update' },
        name: { type: 'string' },
        cron_expression: { type: 'string' },
        action_type: { type: 'string', enum: ['sql'] },
        action_config: { type: 'object', properties: { query: { type: 'string' } } },
        is_active: { type: 'boolean' },
      },
      required: ['job_id'],
    },
  },
  {
    name: 'delete_cron_job',
    description: 'Delete a cron job permanently. Stops the scheduled execution and removes all run history.',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'UUID of the cron job to delete' },
      },
      required: ['job_id'],
    },
  },
  {
    name: 'toggle_cron_job',
    description: 'Toggle a cron job between active and inactive. Active jobs run on schedule; inactive jobs are paused but retain their configuration.',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'UUID of the cron job to toggle' },
      },
      required: ['job_id'],
    },
  },
  {
    name: 'run_cron_job',
    description: 'Execute a cron job immediately regardless of its schedule or active status. Returns the execution result including status, output rows, and any errors.',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'UUID of the cron job to run' },
      },
      required: ['job_id'],
    },
  },
];
