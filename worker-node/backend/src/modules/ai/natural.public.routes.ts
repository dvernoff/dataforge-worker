import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../middleware/error-handler.js';
import { validateSchemaAccess } from '../../utils/sql-guard.js';

let Anthropic: any = null;

const getClient = () => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new AppError(503, 'ANTHROPIC_API_KEY is not configured');
  }
  if (!Anthropic) {
    try {
      Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk');
    } catch {
      throw new AppError(503, '@anthropic-ai/sdk is not installed');
    }
  }
  return new Anthropic({ apiKey });
};

/**
 * Public Natural Language API endpoint
 * POST /api/v1/:projectSlug/natural
 *
 * This is the external-facing route that uses project slug and API token auth.
 */
export async function naturalPublicRoutes(app: FastifyInstance) {

  // POST /api/v1/:projectSlug/natural
  app.post('/:projectSlug/natural', async (request) => {
    const { projectSlug } = request.params as { projectSlug: string };

    // Auth via Bearer token
    const authHeader = request.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      throw new AppError(401, 'Missing or invalid Authorization header. Use Bearer <api_token>.');
    }
    const token = authHeader.slice(7);

    // Verify API token and resolve project
    const tokenRow = await app.db('api_tokens')
      .join('projects', 'api_tokens.project_id', 'projects.id')
      .where('projects.slug', projectSlug)
      .whereRaw("api_tokens.token_hash = encode(digest(?, 'sha256'), 'hex')", [token])
      .whereNull('api_tokens.revoked_at')
      .select('projects.id as project_id', 'projects.db_schema')
      .first();

    if (!tokenRow) {
      throw new AppError(401, 'Invalid API token or project not found');
    }

    const body = z.object({
      question: z.string().min(1).max(2000),
    }).parse(request.body);

    const dbSchema = tokenRow.db_schema;

    // Get schema context
    const tables = await app.db.raw(`
      SELECT t.table_name,
        json_agg(json_build_object(
          'name', c.column_name,
          'type', c.data_type
        ) ORDER BY c.ordinal_position) as columns
      FROM information_schema.tables t
      JOIN information_schema.columns c
        ON c.table_schema = t.table_schema AND c.table_name = t.table_name
      WHERE t.table_schema = ? AND t.table_type = 'BASE TABLE'
        AND t.table_name NOT LIKE '__history_%'
      GROUP BY t.table_name
      ORDER BY t.table_name
    `, [dbSchema]);

    const schemaContext = tables.rows.map((t: any) =>
      `Table: ${t.table_name}\n  Columns: ${t.columns.map((c: any) => `${c.name} (${c.type})`).join(', ')}`
    ).join('\n');

    const client = getClient();
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: `You are a PostgreSQL expert. Convert the user's natural language question into a SQL query.

Database Schema:
${schemaContext}

CRITICAL RULES:
- Generate ONLY SELECT queries. Never generate INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE, or any DDL/DML statements.
- The query MUST use the schema prefix: "${dbSchema}".table_name
- Return ONLY a JSON object with this exact structure:
{
  "sql": "SELECT ...",
  "explanation": "Brief explanation of what the query does"
}
- No markdown, no code fences, just the JSON object.`,
      messages: [{ role: 'user', content: body.question }],
    });

    const textBlock = response.content.find((b: { type: string }) => b.type === 'text');
    const raw = textBlock?.text?.trim() ?? '{}';

    let parsed;
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch?.[0] ?? raw);
    } catch {
      throw new AppError(500, 'Failed to parse AI response');
    }

    const sql = parsed.sql ?? '';
    const explanation = parsed.explanation ?? '';

    // Safety check
    const normalizedSql = sql.trim().toUpperCase();
    const forbiddenKeywords = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'TRUNCATE', 'CREATE', 'GRANT', 'REVOKE'];
    for (const keyword of forbiddenKeywords) {
      if (normalizedSql.startsWith(keyword) || normalizedSql.includes(` ${keyword} `)) {
        throw new AppError(400, `Unsafe query rejected: contains ${keyword}. Only SELECT queries are allowed.`);
      }
    }

    if (!normalizedSql.startsWith('SELECT') && !normalizedSql.startsWith('WITH')) {
      throw new AppError(400, 'Only SELECT queries are allowed');
    }

    // Block cross-schema access in AI-generated SQL
    validateSchemaAccess(sql, dbSchema);

    let data;
    try {
      const result = await app.db.transaction(async (trx) => {
        await trx.raw('SET LOCAL transaction_read_only = on');
        await trx.raw(`SET LOCAL search_path TO ?, 'public'`, [dbSchema]);
        await trx.raw('SET LOCAL statement_timeout = 10000');
        return trx.raw(sql) as any;
      });
      data = result.rows ?? [];
    } catch (err: any) {
      throw new AppError(400, `Query execution failed: ${err.message}`);
    }

    return { sql, data, explanation };
  });
}
