import type { Knex } from 'knex';
import { AppError } from '../middleware/error-handler.js';

const VALID_IDENTIFIER_RE = /^[a-z_][a-z0-9_]*$/;

// PostgreSQL built-in pseudo-relations referenced as `name.column` in SQL.
//   EXCLUDED — inbound row in ON CONFLICT DO UPDATE
//   OLD/NEW  — in trigger/rule bodies (not executable by users but cheap to allow)
const PG_PSEUDO_RELATIONS = new Set(['excluded', 'old', 'new']);

// Reserved SQL tokens that must never be treated as a table alias.
const SQL_RESERVED = new Set([
  'where', 'on', 'set', 'returning', 'order', 'group', 'having', 'limit',
  'offset', 'fetch', 'for', 'union', 'intersect', 'except', 'lateral',
  'cross', 'inner', 'left', 'right', 'full', 'outer', 'using', 'and', 'or',
  'not', 'default', 'values', 'select', 'if', 'when', 'then', 'else', 'end',
  'case', 'do', 'update', 'delete', 'insert', 'conflict', 'nothing', 'as',
  'null', 'true', 'false', 'with', 'recursive', 'from', 'into', 'join',
]);

// Shadow-check: given a set of candidate identifiers from the SQL (local aliases/tables/CTEs),
// find which of them are actually database schemas. Single ANY($1) query, ≤1ms, no cache
// (cache would open a race window whenever a new project schema is provisioned).
async function findSchemasAmong(db: Knex, candidates: string[]): Promise<Set<string>> {
  if (candidates.length === 0) return new Set<string>();
  try {
    const res = await db.raw(
      `SELECT nspname FROM pg_namespace WHERE nspname = ANY(?::text[])`,
      [candidates]
    ) as { rows: { nspname: string }[] };
    return new Set(res.rows.map(r => r.nspname.toLowerCase()));
  } catch {
    // If the catalog query fails, fail CLOSED — treat every candidate as a potential schema shadow
    return new Set(candidates);
  }
}

// Collect table names, aliases and CTE names that are defined INSIDE this SQL statement.
// These become allowed `X.Y` prefixes: references like `players.col` or `p.col` when `p` is an alias.
function extractLocalIdentifiers(sql: string, allowedSchema: string): Set<string> {
  const names = new Set<string>();
  const allowed = allowedSchema.toLowerCase();

  // FROM / INTO / UPDATE / JOIN / MERGE INTO  [<schema>.]<table>  [[AS] <alias>]
  // Note: MERGE INTO matches via the INTO token.
  const tableRe = /\b(?:FROM|INTO|UPDATE|JOIN)\s+(?:([a-z_]\w*)\s*\.\s*)?([a-z_]\w*)(?:\s+(?:AS\s+)?([a-z_]\w*))?/gi;
  let m: RegExpExecArray | null;
  while ((m = tableRe.exec(sql)) !== null) {
    const schemaPart = m[1]?.toLowerCase();
    const table = m[2].toLowerCase();
    const alias = m[3]?.toLowerCase();
    if (schemaPart && schemaPart !== allowed) continue;
    if (!SQL_RESERVED.has(table)) names.add(table);
    if (alias && !SQL_RESERVED.has(alias)) names.add(alias);
  }

  // MERGE ... USING (subquery) alias   or   USING (subquery) AS alias
  // Also catches LATERAL (subquery) alias patterns.
  const subqueryAliasRe = /\)\s+(?:AS\s+)?([a-z_]\w*)\b/gi;
  while ((m = subqueryAliasRe.exec(sql)) !== null) {
    const alias = m[1].toLowerCase();
    if (!SQL_RESERVED.has(alias)) names.add(alias);
  }

  // WITH [RECURSIVE] <cte_name> AS ( ... )     and subsequent   , <cte_name> AS ( ... )
  const cteRe = /(?:\bWITH\s+(?:RECURSIVE\s+)?|,\s*)([a-z_]\w*)\s+AS\s*\(/gi;
  while ((m = cteRe.exec(sql)) !== null) {
    const cte = m[1].toLowerCase();
    if (!SQL_RESERVED.has(cte)) names.add(cte);
  }

  // VALUES (...) <alias>  — rare but valid
  const valuesAliasRe = /\bVALUES\s*\([^)]*\)\s+(?:AS\s+)?([a-z_]\w*)\b/gi;
  while ((m = valuesAliasRe.exec(sql)) !== null) {
    const alias = m[1].toLowerCase();
    if (!SQL_RESERVED.has(alias)) names.add(alias);
  }

  return names;
}

const BLOCKED_PATTERNS = [
  /\bpg_catalog\b/i,
  /\binformation_schema\b/i,
  // Any pg_* identifier is a system catalog / view / role — PostgreSQL reserves the pg_ prefix.
  // Single blanket rule catches pg_stat_activity, pg_hba_file_rules, pg_locks, pg_publication,
  // pg_auth_members, pg_subscription, pg_seclabel, etc. without having to enumerate each.
  /\bpg_[a-z][a-z0-9_]*\b/i,
  /\brole_table_grants\b/i,
  /\btable_privileges\b/i,
  /\bapplicable_roles\b/i,
  /\benabled_roles\b/i,
];

const BLOCKED_STATEMENTS = [
  /\bSET\s+(LOCAL\s+)?search_path\b/i,
  /\bSET\s+(LOCAL\s+)?ROLE\b/i,
  /\bRESET\s+ROLE\b/i,
  /\bRESET\s+search_path\b/i,
  /\bCREATE\s+SCHEMA\b/i,
  /\bDROP\s+SCHEMA\b/i,
  /\bALTER\s+SCHEMA\b/i,
  /\bCREATE\s+(OR\s+REPLACE\s+)?FUNCTION\b/i,
  /\bCREATE\s+EXTENSION\b/i,
  /\bCOPY\s+.*\bFROM\s+PROGRAM\b/i,
  /\bLO_IMPORT\b/i,
  /\bLO_EXPORT\b/i,
  /\bDBLINK\b/i,
];

const MUTATION_DDL_BLOCKED = [
  { re: /\bDROP\s+(TABLE|INDEX|VIEW|MATERIALIZED|SEQUENCE|TYPE|TRIGGER|RULE|POLICY)\b/i, kw: 'DROP' },
  { re: /\bTRUNCATE\b/i, kw: 'TRUNCATE' },
  { re: /\bALTER\s+(TABLE|INDEX|VIEW|SEQUENCE|TYPE|TRIGGER|RULE|POLICY|MATERIALIZED|DATABASE|SYSTEM)\b/i, kw: 'ALTER' },
  { re: /\bCREATE\s+(TABLE|INDEX|VIEW|MATERIALIZED|SEQUENCE|TYPE|TRIGGER|RULE|POLICY|DATABASE|ROLE|USER)\b/i, kw: 'CREATE' },
  { re: /\bGRANT\b/i, kw: 'GRANT' },
  { re: /\bREVOKE\b/i, kw: 'REVOKE' },
  { re: /\bVACUUM\b/i, kw: 'VACUUM' },
  { re: /\bCLUSTER\b/i, kw: 'CLUSTER' },
  { re: /\bREINDEX\b/i, kw: 'REINDEX' },
];

export function validateSchema(schema: string): void {
  if (!VALID_IDENTIFIER_RE.test(schema)) {
    throw new AppError(400, 'Invalid schema name');
  }
}

export function validateIdentifier(value: string, label = 'identifier'): void {
  if (!value || !VALID_IDENTIFIER_RE.test(value)) {
    throw new AppError(400, `Invalid ${label}: "${value}"`);
  }
}

export async function validateSchemaAccess(sql: string, allowedSchema: string, db?: Knex): Promise<void> {
  const cleaned = sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/'[^']*'/g, "''")
    .replace(/"([^"]+)"/g, '$1');

  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(cleaned)) {
      throw new AppError(403, 'Access to system catalogs is not allowed');
    }
  }

  for (const pattern of BLOCKED_STATEMENTS) {
    if (pattern.test(cleaned)) {
      throw new AppError(403, 'This SQL statement is not allowed');
    }
  }

  const allowedLower = allowedSchema.toLowerCase();
  const localIdentifiers = extractLocalIdentifiers(cleaned, allowedSchema);

  // First pass — collect every `X.Y` prefix and categorize
  const schemaRefPattern = /\b([a-z_][a-z0-9_]*)\s*\.\s*([a-z_][a-z0-9_]*)/gi;
  const needShadowCheck: string[] = []; // local identifiers we'll verify against pg_namespace
  const refs: { original: string; lower: string }[] = [];
  let match: RegExpExecArray | null;
  while ((match = schemaRefPattern.exec(cleaned)) !== null) {
    const x = match[1].toLowerCase();
    refs.push({ original: match[1], lower: x });
    if (x === allowedLower) continue;
    if (PG_PSEUDO_RELATIONS.has(x)) continue;
    if (localIdentifiers.has(x)) {
      if (!needShadowCheck.includes(x)) needShadowCheck.push(x);
      continue;
    }
    // Rejected — likely cross-schema reference
    throw new AppError(403, `Access denied: cannot reference schema "${match[1]}". Allowed prefixes: project schema "${allowedSchema}", EXCLUDED/OLD/NEW pseudo-relations, or a table/alias/CTE defined in this statement.`);
  }

  // Second pass — shadow check for any local identifier that might coincide with a real schema name.
  // A live point query into pg_namespace, no caching, prevents cross-project leaks via aliases.
  if (needShadowCheck.length > 0 && db) {
    const shadowedSchemas = await findSchemasAmong(db, needShadowCheck);
    for (const ref of refs) {
      if (shadowedSchemas.has(ref.lower) && ref.lower !== allowedLower) {
        throw new AppError(403, `Access denied: identifier "${ref.original}" collides with a database schema name. Rename the alias to avoid ambiguity with cross-schema access.`);
      }
    }
  }
}

const SIDE_EFFECT_FUNCTIONS = [
  /\bpg_sleep\s*\(/i,
  /\bpg_read_file\s*\(/i,
  /\bpg_read_binary_file\s*\(/i,
  /\bpg_ls_dir\s*\(/i,
  /\bpg_terminate_backend\s*\(/i,
  /\bpg_cancel_backend\s*\(/i,
  /\bdblink\s*\(/i,
  /\bcurrval\s*\(/i,
  /\bnextval\s*\(/i,
  /\bsetval\s*\(/i,
  /\bsetseed\s*\(/i,
  /\brandom\s*\(/i,
  /\bset_config\s*\(/i,
  /\bxmlparse\s*\(/i,
];

export function validateIndexExpression(expr: string, label = 'expression'): void {
  if (!expr || typeof expr !== 'string') {
    throw new AppError(400, `Empty ${label}`);
  }
  const cleaned = expr
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/'[^']*'/g, "''");

  if (/\bSELECT\b/i.test(cleaned)) {
    throw new AppError(400, `Subqueries are not allowed in index ${label}`);
  }
  if (/;/.test(cleaned)) {
    throw new AppError(400, `Semicolons are not allowed in index ${label}`);
  }
  for (const re of SIDE_EFFECT_FUNCTIONS) {
    if (re.test(cleaned)) {
      throw new AppError(400, `Side-effect function is not allowed in index ${label}`);
    }
  }
  for (const re of BLOCKED_PATTERNS) {
    if (re.test(cleaned)) {
      throw new AppError(400, `System catalog reference is not allowed in index ${label}`);
    }
  }
}

export async function validateMutationSql(sql: string, allowedSchema: string, db?: Knex): Promise<void> {
  const cleaned = sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/'[^']*'/g, "''")
    .replace(/"([^"]+)"/g, '$1');

  const trimmed = cleaned.trim().replace(/^;+/, '').trim();

  // DDL/redirect checks first — they have specific guidance that's more useful
  // than the generic "wrong statement type" error. Especially TRUNCATE, which
  // looks like data semantics to callers and deserves a pointer at the
  // dedicated tool rather than "use INSERT/UPDATE/DELETE".
  for (const { re, kw } of MUTATION_DDL_BLOCKED) {
    if (re.test(cleaned)) {
      if (kw === 'TRUNCATE') {
        throw new AppError(403, 'TRUNCATE is not allowed in execute_sql_mutation. Use the dedicated MCP tool "truncate_table" — it accepts cascade/restart_identity options and works on hypertables (drops all chunks atomically).');
      }
      throw new AppError(403, `${kw} is not allowed in execute_sql_mutation. Use schema tools (create_table, drop_table, add_index, etc.) for DDL.`);
    }
  }

  const isMutation = /^(INSERT|UPDATE|DELETE|MERGE|WITH)\s/i.test(trimmed);
  if (!isMutation) {
    throw new AppError(400, 'execute_sql_mutation requires INSERT, UPDATE, DELETE, or MERGE (WITH + mutation allowed). For SELECT use execute_sql. For schema changes use create_table / alter_columns / add_index.');
  }

  if (/^WITH\s/i.test(trimmed)) {
    if (!/\b(INSERT|UPDATE|DELETE|MERGE)\b/i.test(trimmed)) {
      throw new AppError(400, 'WITH clause must contain INSERT, UPDATE, DELETE, or MERGE for execute_sql_mutation.');
    }
  }

  await validateSchemaAccess(sql, allowedSchema, db);
}
