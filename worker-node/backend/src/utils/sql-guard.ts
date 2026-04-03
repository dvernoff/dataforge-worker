import { AppError } from '../middleware/error-handler.js';

const VALID_SCHEMA_RE = /^[a-z_][a-z0-9_]*$/;

/**
 * Validate that a schema name is safe (lowercase alphanumeric + underscores).
 * Prevents SQL injection via schema identifiers.
 */
export function validateSchema(schema: string): void {
  if (!VALID_SCHEMA_RE.test(schema)) {
    throw new AppError(400, 'Invalid schema name');
  }
}

/**
 * Validate that a SQL query only references the allowed project schema.
 * Blocks cross-schema access (e.g. SELECT * FROM other_project.users).
 *
 * Performance: regex on string — microseconds, no DB calls.
 */
export function validateSchemaAccess(sql: string, allowedSchema: string): void {
  // Remove comments and string literals to avoid false positives
  const cleaned = sql
    .replace(/--[^\n]*/g, '')           // line comments
    .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
    .replace(/'[^']*'/g, "''")          // string literals
    .replace(/"([^"]+)"/g, '$1');       // remove double quotes around identifiers

  // Match any schema-qualified reference: schema.identifier
  const schemaRefPattern = /\b([a-z_][a-z0-9_]*)\s*\.\s*([a-z_][a-z0-9_]*)/gi;
  const allowedSchemas = new Set([
    allowedSchema.toLowerCase(),
    'pg_catalog',
    'information_schema',
    'public',
  ]);

  let match;
  while ((match = schemaRefPattern.exec(cleaned)) !== null) {
    const referencedSchema = match[1].toLowerCase();
    if (!allowedSchemas.has(referencedSchema)) {
      throw new AppError(403, `Access denied: cannot reference schema "${match[1]}"`);
    }
  }
}
