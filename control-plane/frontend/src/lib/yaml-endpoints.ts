import { parse, stringify } from 'yaml';
import type { ApiEndpoint } from '@shared/types/api.types';

export interface YamlEndpointDef {
  method: string;
  path: string;
  description?: string;
  tags?: string[];
  source_type: string;
  source_config: Record<string, unknown>;
  validation_schema?: Record<string, unknown>;
  response_config?: Record<string, unknown>;
  cache_enabled?: boolean;
  cache_ttl?: number;
  cache_key_template?: string;
  cache_invalidation?: { on_insert: boolean; on_update: boolean; on_delete: boolean };
  rate_limit?: { max: number; window: number; per?: string };
  auth_type?: string;
  is_active?: boolean;
}

export interface YamlEndpointSchema {
  endpoints: YamlEndpointDef[];
}

export interface EndpointParseResult {
  success: boolean;
  schema?: YamlEndpointSchema;
  errors: string[];
  warnings: string[];
}

export interface EndpointConflict {
  yamlIndex: number;
  endpoint: YamlEndpointDef;
  existingId: string;
  action: 'skip' | 'update';
  changes: string[];
}

export interface EndpointImportPayloads {
  toCreate: YamlEndpointDef[];
  conflicts: EndpointConflict[];
}

const VALID_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const VALID_SOURCE_TYPES = ['table', 'custom_sql', 'composite'];
const VALID_AUTH_TYPES = ['public', 'api_token'];
const VALID_TABLE_OPERATIONS = ['find', 'findOne', 'create', 'update', 'delete'];
const PATH_REGEX = /^\/[a-zA-Z0-9_/:.\-*]*$/;

const TEMPLATE_HEADER = `# DataForge Endpoint Definition
#
# STRUCTURE:
#
#   endpoints:
#     - method: GET                    # GET | POST | PUT | PATCH | DELETE
#       path: /users                   # must start with /
#       description: List users        # optional
#       source_type: custom_sql        # table | custom_sql | composite
#       source_config:                 # required, depends on source_type
#         query: "SELECT ..."          # for custom_sql
#       auth_type: api_token           # api_token (default) | public
#       is_active: true                # default: true
#
# SOURCE TYPES:
#
#   table:
#     source_config:
#       table: users                   # table name
#       operation: find                # find | findOne | create | update | delete
#
#   custom_sql:
#     source_config:
#       query: "SELECT * FROM users WHERE id = {{id}}"
#     # Parameters: {{param}} — extracted from path (:param), query (?param=) or body
#
# OPTIONAL SETTINGS:
#   cache_enabled: false               # enable response caching
#   cache_ttl: 60                      # cache TTL in seconds (1-86400)
#   rate_limit:                        # rate limiting
#     max: 100                         # max requests per window
#     window: 60000                    # window in ms (min 1000)
#     per: ip                          # ip (default) | token
#   tags: [reports, analytics]         # tags for grouping
#
# CONFLICT HANDLING:
#   On re-import, endpoints with the same (method, path) as existing ones
#   will be detected as conflicts. You can choose to skip or update them.
`;

export function getEndpointYamlTemplate(): string {
  return TEMPLATE_HEADER + `
# ── EXAMPLE ──

endpoints:
  - method: GET
    path: /users
    description: List all users
    source_type: table
    source_config:
      table: users
      operation: find
    auth_type: api_token

  - method: GET
    path: /users/:id
    description: Get user by ID
    source_type: table
    source_config:
      table: users
      operation: findOne
    auth_type: api_token

  - method: POST
    path: /reports/monthly
    description: Generate monthly report
    source_type: custom_sql
    source_config:
      query: "SELECT date, SUM(amount) as total FROM orders WHERE created_at >= {{start_date}} AND created_at < {{end_date}} GROUP BY date ORDER BY date"
    auth_type: api_token
    cache_enabled: true
    cache_ttl: 300
    rate_limit:
      max: 50
      window: 60000
    tags:
      - reports
`;
}

export function parseEndpointYaml(yamlString: string): EndpointParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!yamlString.trim()) {
    return { success: false, errors: ['Schema is empty'], warnings };
  }

  let raw: unknown;
  try {
    raw = parse(yamlString);
  } catch (e) {
    return { success: false, errors: [`YAML syntax error: ${(e as Error).message}`], warnings };
  }

  if (!raw || typeof raw !== 'object' || !('endpoints' in (raw as Record<string, unknown>))) {
    return { success: false, errors: ['Missing top-level "endpoints" key'], warnings };
  }

  const schema = raw as YamlEndpointSchema;

  if (!Array.isArray(schema.endpoints)) {
    return { success: false, errors: ['"endpoints" must be an array'], warnings };
  }

  if (schema.endpoints.length === 0) {
    return { success: false, errors: ['No endpoints defined'], warnings };
  }

  const seen = new Map<string, number>();

  for (let i = 0; i < schema.endpoints.length; i++) {
    const ep = schema.endpoints[i];
    const prefix = `Endpoint[${i}]`;

    if (!ep || typeof ep !== 'object') {
      errors.push(`${prefix}: must be an object`);
      continue;
    }

    if (!ep.method) {
      errors.push(`${prefix}: "method" is required`);
    } else {
      ep.method = String(ep.method).toUpperCase();
      if (!VALID_METHODS.includes(ep.method)) {
        errors.push(`${prefix}: invalid method "${ep.method}". Valid: ${VALID_METHODS.join(', ')}`);
      }
    }

    if (!ep.path) {
      errors.push(`${prefix}: "path" is required`);
    } else if (typeof ep.path !== 'string' || !ep.path.startsWith('/')) {
      errors.push(`${prefix}: "path" must start with /`);
    } else if (!PATH_REGEX.test(ep.path)) {
      errors.push(`${prefix}: "path" contains invalid characters`);
    }

    if (ep.method && ep.path) {
      const key = `${ep.method} ${ep.path}`;
      const prevIdx = seen.get(key);
      if (prevIdx !== undefined) {
        warnings.push(`${prefix}: duplicate (${key}) — same as Endpoint[${prevIdx}]`);
      } else {
        seen.set(key, i);
      }
    }

    if (!ep.source_type) {
      errors.push(`${prefix}: "source_type" is required`);
    } else if (!VALID_SOURCE_TYPES.includes(ep.source_type)) {
      errors.push(`${prefix}: invalid source_type "${ep.source_type}". Valid: ${VALID_SOURCE_TYPES.join(', ')}`);
    }

    if (!ep.source_config || typeof ep.source_config !== 'object') {
      errors.push(`${prefix}: "source_config" is required and must be an object`);
    } else if (ep.source_type === 'table') {
      const cfg = ep.source_config as Record<string, unknown>;
      if (!cfg.table || typeof cfg.table !== 'string') {
        errors.push(`${prefix}: source_config.table is required for source_type "table"`);
      }
      if (!cfg.operation || !VALID_TABLE_OPERATIONS.includes(String(cfg.operation))) {
        errors.push(`${prefix}: source_config.operation must be one of: ${VALID_TABLE_OPERATIONS.join(', ')}`);
      }
    } else if (ep.source_type === 'custom_sql') {
      const cfg = ep.source_config as Record<string, unknown>;
      if (!cfg.query || typeof cfg.query !== 'string' || !String(cfg.query).trim()) {
        errors.push(`${prefix}: source_config.query is required for source_type "custom_sql"`);
      }
    }

    if (ep.auth_type !== undefined && !VALID_AUTH_TYPES.includes(String(ep.auth_type))) {
      errors.push(`${prefix}: invalid auth_type "${ep.auth_type}". Valid: ${VALID_AUTH_TYPES.join(', ')}`);
    }

    if (ep.cache_ttl !== undefined) {
      const ttl = Number(ep.cache_ttl);
      if (!Number.isInteger(ttl) || ttl < 1 || ttl > 86400) {
        errors.push(`${prefix}: cache_ttl must be an integer 1-86400`);
      }
    }

    if (ep.cache_enabled && ep.method && ep.method !== 'GET') {
      warnings.push(`${prefix}: cache_enabled on ${ep.method} — caching is typically used for GET requests`);
    }

    if (ep.rate_limit) {
      if (typeof ep.rate_limit !== 'object') {
        errors.push(`${prefix}: rate_limit must be an object with max and window`);
      } else {
        const rl = ep.rate_limit;
        if (!rl.max || !Number.isInteger(rl.max) || rl.max < 1) {
          errors.push(`${prefix}: rate_limit.max must be a positive integer`);
        } else if (rl.max < 10) {
          warnings.push(`${prefix}: rate_limit.max is ${rl.max} — very restrictive, may block legitimate traffic`);
        }
        if (!rl.window || !Number.isInteger(rl.window) || rl.window < 1000) {
          errors.push(`${prefix}: rate_limit.window must be an integer >= 1000 (ms)`);
        }
        if (rl.per && !['ip', 'token'].includes(String(rl.per))) {
          errors.push(`${prefix}: rate_limit.per must be "ip" or "token"`);
        }
      }
    }

    if (ep.auth_type === 'public' && !ep.rate_limit) {
      warnings.push(`${prefix}: public endpoint without rate_limit — consider adding rate limiting`);
    }
  }

  return {
    success: errors.length === 0,
    schema: errors.length === 0 ? schema : undefined,
    errors,
    warnings,
  };
}

function normalizeConfig(config: Record<string, unknown> | string | null | undefined): Record<string, unknown> {
  if (!config) return {};
  if (typeof config === 'string') {
    try { return JSON.parse(config); } catch { return {}; }
  }
  return config;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a, Object.keys(a && typeof a === 'object' ? a : {}).sort())
    === JSON.stringify(b, Object.keys(b && typeof b === 'object' ? b : {}).sort());
}

export function detectEndpointConflicts(
  parsed: YamlEndpointDef[],
  existing: ApiEndpoint[],
): EndpointImportPayloads {
  const active = existing.filter(e => !e.deprecated_at);
  const lookup = new Map<string, ApiEndpoint>();
  for (const ep of active) {
    lookup.set(`${ep.method.toUpperCase()} ${ep.path}`, ep);
  }

  const toCreate: YamlEndpointDef[] = [];
  const conflicts: EndpointConflict[] = [];

  for (let i = 0; i < parsed.length; i++) {
    const ep = parsed[i];
    const key = `${ep.method.toUpperCase()} ${ep.path}`;
    const ex = lookup.get(key);

    if (!ex) {
      toCreate.push(ep);
      continue;
    }

    const changes: string[] = [];
    const exConfig = normalizeConfig(ex.source_config);

    if (ep.description && ep.description !== (ex.description ?? '')) {
      changes.push('description');
    }
    if (ep.source_type !== ex.source_type) {
      changes.push(`source_type: ${ex.source_type} → ${ep.source_type}`);
    }
    if (!deepEqual(ep.source_config, exConfig)) {
      changes.push('source_config');
    }
    if (ep.auth_type && ep.auth_type !== ex.auth_type) {
      changes.push(`auth_type: ${ex.auth_type} → ${ep.auth_type}`);
    }
    if (ep.cache_enabled !== undefined && ep.cache_enabled !== ex.cache_enabled) {
      changes.push(`cache_enabled: ${ex.cache_enabled} → ${ep.cache_enabled}`);
    }
    if (ep.cache_ttl !== undefined && ep.cache_ttl !== ex.cache_ttl) {
      changes.push(`cache_ttl: ${ex.cache_ttl} → ${ep.cache_ttl}`);
    }
    if (ep.rate_limit && !deepEqual(ep.rate_limit, ex.rate_limit)) {
      changes.push('rate_limit');
    }
    if (ep.is_active !== undefined && ep.is_active !== ex.is_active) {
      changes.push(`is_active: ${ex.is_active} → ${ep.is_active}`);
    }

    conflicts.push({
      yamlIndex: i,
      endpoint: ep,
      existingId: ex.id,
      action: 'skip',
      changes,
    });
  }

  return { toCreate, conflicts };
}

export function endpointsToYaml(endpoints: ApiEndpoint[]): string {
  const active = endpoints
    .filter(e => !e.deprecated_at)
    .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));

  if (active.length === 0) return '';

  const defs: Record<string, unknown>[] = active.map(ep => {
    const def: Record<string, unknown> = {
      method: ep.method,
      path: ep.path,
    };

    if (ep.description) def.description = ep.description;
    if (ep.tags && ep.tags.length > 0) def.tags = ep.tags;

    def.source_type = ep.source_type;
    def.source_config = normalizeConfig(ep.source_config);

    if (ep.auth_type !== 'api_token') def.auth_type = ep.auth_type;
    if (ep.cache_enabled) {
      def.cache_enabled = true;
      if (ep.cache_ttl !== 60) def.cache_ttl = ep.cache_ttl;
    }
    if (ep.rate_limit) def.rate_limit = ep.rate_limit;
    if (!ep.is_active) def.is_active = false;

    return def;
  });

  const body = stringify({ endpoints: defs }, { indent: 2, lineWidth: 0 });
  return TEMPLATE_HEADER + '\n' + body;
}
