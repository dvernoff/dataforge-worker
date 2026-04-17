import { AppError } from '../middleware/error-handler.js';

const VALID_IDENTIFIER_RE = /^[a-z_][a-z0-9_]*$/;

const BLOCKED_PATTERNS = [
  /\bpg_catalog\b/i,
  /\binformation_schema\b/i,
  /\bpg_roles\b/i,
  /\bpg_user\b/i,
  /\bpg_shadow\b/i,
  /\bpg_authid\b/i,
  /\bpg_stat\b/i,
  /\bpg_tables\b/i,
  /\bpg_class\b/i,
  /\bpg_namespace\b/i,
  /\bpg_index\b/i,
  /\bpg_attribute\b/i,
  /\bpg_proc\b/i,
  /\bpg_type\b/i,
  /\bpg_database\b/i,
  /\bpg_tablespace\b/i,
  /\bpg_settings\b/i,
  /\bpg_hba\b/i,
  /\brole_table_grants\b/i,
  /\btable_privileges\b/i,
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

export function validateSchemaAccess(sql: string, allowedSchema: string): void {
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

  const schemaRefPattern = /\b([a-z_][a-z0-9_]*)\s*\.\s*([a-z_][a-z0-9_]*)/gi;
  const allowedSchemas = new Set([
    allowedSchema.toLowerCase(),
  ]);

  let match;
  while ((match = schemaRefPattern.exec(cleaned)) !== null) {
    const referencedSchema = match[1].toLowerCase();
    if (!allowedSchemas.has(referencedSchema)) {
      throw new AppError(403, `Access denied: cannot reference schema "${match[1]}"`);
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

export function validateMutationSql(sql: string, allowedSchema: string): void {
  const cleaned = sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/'[^']*'/g, "''")
    .replace(/"([^"]+)"/g, '$1');

  const trimmed = cleaned.trim().replace(/^;+/, '').trim();
  const isMutation = /^(INSERT|UPDATE|DELETE|MERGE|WITH)\s/i.test(trimmed);
  if (!isMutation) {
    throw new AppError(400, 'execute_sql_mutation requires INSERT, UPDATE, DELETE, or MERGE (WITH + mutation allowed). For SELECT use execute_sql. For schema changes use create_table / alter_columns / add_index.');
  }

  if (/^WITH\s/i.test(trimmed)) {
    if (!/\b(INSERT|UPDATE|DELETE|MERGE)\b/i.test(trimmed)) {
      throw new AppError(400, 'WITH clause must contain INSERT, UPDATE, DELETE, or MERGE for execute_sql_mutation.');
    }
  }

  for (const { re, kw } of MUTATION_DDL_BLOCKED) {
    if (re.test(cleaned)) {
      throw new AppError(403, `${kw} is not allowed in execute_sql_mutation. Use schema tools (create_table, drop_table, add_index, etc.) for DDL.`);
    }
  }

  validateSchemaAccess(sql, allowedSchema);
}
