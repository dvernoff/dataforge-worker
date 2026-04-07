import { AppError } from '../middleware/error-handler.js';

const VALID_SCHEMA_RE = /^[a-z_][a-z0-9_]*$/;

export function validateSchema(schema: string): void {
  if (!VALID_SCHEMA_RE.test(schema)) {
    throw new AppError(400, 'Invalid schema name');
  }
}

export function validateSchemaAccess(sql: string, allowedSchema: string): void {
  const cleaned = sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/'[^']*'/g, "''")
    .replace(/"([^"]+)"/g, '$1');

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
