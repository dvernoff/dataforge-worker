export interface ErrorCodeDef {
  code: string;
  pattern: RegExp;
  cause: string;
  suggestion: string;
}

export const ERROR_CODES: ErrorCodeDef[] = [
  {
    code: 'DF_ALIAS_CONFLICT',
    pattern: /cannot reference schema "([a-zA-Z_])"/,
    cause: 'Single-letter table aliases collide with the project schema reservation in the SQL guard.',
    suggestion: 'Use longer aliases (3+ chars), e.g. "srv" instead of "s", "usr" instead of "u".',
  },
  {
    code: 'DF_MISSING_BINDING',
    pattern: /(Expected \d+ bindings, saw \d+|Missing parameters? for \{\{)/i,
    cause: 'Query contains {{name}} placeholders whose values were not supplied in params/body/query.',
    suggestion: 'For execute_sql_mutation: pass values in "params": { name: value }. For custom_sql endpoints via call_endpoint: pass values in body (JSON object), query (?name=value), or path (:name in route). Parameter names are case-sensitive. Use COALESCE({{name}}, default) for optional values.',
  },
  {
    code: 'DF_SYSTEM_CATALOG',
    pattern: /Access to system catalogs is not allowed/i,
    cause: 'The query references pg_catalog, information_schema, or other restricted namespaces.',
    suggestion: 'Use MCP tools (list_tables, describe_table, list_endpoints) to introspect schema instead of direct catalog queries.',
  },
  {
    code: 'DF_ALIEN_SCHEMA',
    pattern: /Access denied: cannot reference schema "([^"]+)"/,
    cause: 'The query references a schema outside the current project.',
    suggestion: 'Query only tables within your project schema. Cross-schema joins are disabled for security.',
  },
  {
    code: 'DF_DDL_IN_MUTATION',
    pattern: /(DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE) is not allowed in execute_sql_mutation/i,
    cause: 'DDL statements cannot be run through execute_sql_mutation.',
    suggestion: 'Use schema tools: create_table / drop_table / alter_columns / add_index / drop_index for structural changes.',
  },
  {
    code: 'DF_NOT_MUTATION',
    pattern: /execute_sql_mutation requires INSERT, UPDATE, DELETE, or MERGE/i,
    cause: 'The tool expected an INSERT/UPDATE/DELETE/MERGE statement but received something else (e.g. DROP, SELECT, ALTER).',
    suggestion: 'Use execute_sql for SELECT. Use schema tools (create_table, drop_table, alter_columns, add_index) for DDL.',
  },
  {
    code: 'DF_READONLY_ROLE',
    pattern: /Your role only allows SELECT queries/i,
    cause: 'The execute_sql tool is read-only.',
    suggestion: 'For writes, use execute_sql_mutation with confirm_write=true. For DDL, use the schema tools.',
  },
  {
    code: 'DF_INDEX_SUBQUERY',
    pattern: /Subqueries are not allowed in index (where|expression)/i,
    cause: 'Index predicates must be deterministic; subqueries and IN (SELECT ...) are disallowed.',
    suggestion: 'Rewrite the predicate as a simple boolean expression, e.g. status = \'active\' AND deleted_at IS NULL.',
  },
  {
    code: 'DF_INDEX_SIDEEFFECT',
    pattern: /Side-effect function is not allowed in index/i,
    cause: 'Non-deterministic or side-effect functions (random, nextval, pg_sleep, etc.) cannot appear in an index expression.',
    suggestion: 'Use only pure functions: lower(), upper(), ::cast, (jsonb->>\'field\'), date_trunc(), etc.',
  },
  {
    code: 'DF_HTTP_SSRF',
    pattern: /(Only HTTPS URLs are allowed|Blocked host:|Blocked resolved IP)/,
    cause: 'The outbound URL is blocked by the SSRF guard (localhost, private IP, or non-HTTPS protocol).',
    suggestion: 'Use a public HTTPS URL. To call a resource on this cluster, create an internal endpoint and use call_endpoint instead.',
  },
  {
    code: 'DF_TIMESCALE_MISSING',
    pattern: /TimescaleDB extension is unavailable/i,
    cause: 'The worker is not running against a TimescaleDB-enabled PostgreSQL image.',
    suggestion: 'Upgrade the worker to the TimescaleDB release (base image: timescale/timescaledb:latest-pg16). Existing projects on the old worker stay on plain PostgreSQL.',
  },
  {
    code: 'DF_HYPERTABLE_UUID_PK',
    pattern: /cannot create a unique index without the column "[^"]+" \(used in partitioning\)/,
    cause: 'Hypertables require that every unique/PK constraint include the partitioning time column.',
    suggestion: 'Recreate the table with add_uuid_pk=false (or with a composite PK on (id, time_column)) before converting to a hypertable.',
  },
  {
    code: 'DF_CONFIRM_WRITE',
    pattern: /confirm_write must be true/i,
    cause: 'The mutation tool requires an explicit guard flag to prevent accidental writes.',
    suggestion: 'Review the query, then call again with confirm_write=true. Add dry_run=true first to preview affected rows.',
  },
  {
    code: 'DF_BATCH_TOO_LARGE',
    pattern: /Batch size \d+ exceeds max_batch_size/,
    cause: 'Bulk insert exceeded the endpoint\'s max_batch_size limit.',
    suggestion: 'Split the payload into smaller chunks, or increase max_batch_size on the create_many endpoint config.',
  },
];

export interface EnrichedError {
  code: string;
  message: string;
  cause: string;
  suggestion: string;
  query_location?: string;
}

export function enrichError(message: string): EnrichedError | null {
  for (const def of ERROR_CODES) {
    const match = def.pattern.exec(message);
    if (match) {
      const locMatch = /line (\d+)(?:, col(?:umn)? (\d+))?/i.exec(message);
      return {
        code: def.code,
        message,
        cause: def.cause,
        suggestion: def.suggestion,
        ...(locMatch ? { query_location: locMatch[2] ? `line ${locMatch[1]}, col ${locMatch[2]}` : `line ${locMatch[1]}` } : {}),
      };
    }
  }
  return null;
}
