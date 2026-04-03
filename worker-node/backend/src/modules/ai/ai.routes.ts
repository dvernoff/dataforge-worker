import type { FastifyInstance } from 'fastify';
import { nodeAuthMiddleware } from '../../middleware/node-auth.middleware.js';
import { AppError } from '../../middleware/error-handler.js';
import { z } from 'zod';

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

function resolveProjectSchema(request: any): string {
  const schema = request.projectSchema;
  if (!schema) throw new AppError(400, 'Missing project schema header');
  return schema;
}

async function getSchemaContext(db: any, dbSchema: string): Promise<string> {
  const tables = await db.raw(`
    SELECT t.table_name,
      json_agg(json_build_object(
        'name', c.column_name,
        'type', c.data_type,
        'nullable', c.is_nullable = 'YES'
      ) ORDER BY c.ordinal_position) as columns
    FROM information_schema.tables t
    JOIN information_schema.columns c
      ON c.table_schema = t.table_schema AND c.table_name = t.table_name
    WHERE t.table_schema = ? AND t.table_type = 'BASE TABLE'
      AND t.table_name NOT LIKE '__history_%'
    GROUP BY t.table_name
    ORDER BY t.table_name
  `, [dbSchema]);

  return tables.rows.map((t: { table_name: string; columns: { name: string; type: string; nullable: boolean }[] }) =>
    `Table: ${t.table_name}\n  Columns: ${t.columns.map((c) => `${c.name} (${c.type}${c.nullable ? ', nullable' : ''})`).join(', ')}`
  ).join('\n');
}

async function checkAiQuota(db: any, userId: string): Promise<void> {
  const hasTable = await db.schema.hasTable('ai_usage_log');
  if (!hasTable) return;

  const today = new Date().toISOString().split('T')[0];
  const usage = await db('ai_usage_log')
    .where('user_id', userId)
    .whereRaw("created_at::date = ?", [today])
    .select(
      db.raw('COUNT(*)::int as requests'),
      db.raw('COALESCE(SUM(input_tokens + output_tokens), 0)::int as tokens')
    )
    .first();

  let maxRequests = 50;
  let maxTokens = 100000;
  try {
    const hasUserQuotas = await db.schema.hasTable('user_quotas');
    if (hasUserQuotas) {
      const userQuota = await db('user_quotas').where({ user_id: userId }).first();
      if (userQuota) {
        maxRequests = userQuota.max_ai_requests_per_day ?? maxRequests;
        maxTokens = userQuota.max_ai_tokens_per_day ?? maxTokens;
      }
    }
  } catch { /* ignore */ }

  if ((usage?.requests ?? 0) >= maxRequests) {
    throw new AppError(429, 'Daily AI request limit exceeded');
  }
  if ((usage?.tokens ?? 0) >= maxTokens) {
    throw new AppError(429, 'Daily AI token limit exceeded');
  }
}

async function logAiUsage(db: any, userId: string, projectId: string, action: string, model: string, inputTokens: number, outputTokens: number) {
  try {
    const hasTable = await db.schema.hasTable('ai_usage_log');
    if (!hasTable) return;
    await db('ai_usage_log').insert({
      user_id: userId,
      project_id: projectId,
      action,
      model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
    });
  } catch { /* ignore */ }
}

export async function aiRoutes(app: FastifyInstance) {
  app.addHook('preHandler', nodeAuthMiddleware);

  app.post('/:projectId/ai/schema', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const userId = request.userId ?? 'unknown';
    await checkAiQuota(app.db, userId);

    const body = z.object({
      prompt: z.string().min(1).max(5000),
    }).parse(request.body);

    const dbSchema = resolveProjectSchema(request);
    const schemaContext = await getSchemaContext(app.db, dbSchema);

    const client = getClient();
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: `You are a PostgreSQL database architect. Based on the user's natural language description, generate a list of database tables with their columns.

Current database schema (for context, avoid duplicates):
${schemaContext || 'Empty database - no existing tables.'}

Return a JSON object with this exact structure:
{
  "tables": [
    {
      "name": "table_name",
      "columns": [
        { "name": "column_name", "type": "postgres_type", "nullable": false }
      ]
    }
  ]
}

Rules:
- Table names: lowercase, snake_case, no spaces
- Always include an "id" column of type "uuid" as the first column (not nullable)
- Always include "created_at" (timestamp, not nullable) and "updated_at" (timestamp, not nullable)
- Use standard PostgreSQL types: uuid, text, varchar, integer, bigint, boolean, timestamp, date, numeric, jsonb
- Column names: lowercase, snake_case
- Return ONLY the JSON, no explanations or markdown`,
      messages: [{ role: 'user', content: body.prompt }],
    });

    const textBlock = response.content.find((b: { type: string }) => b.type === 'text');
    const raw = textBlock?.text?.trim() ?? '{}';

    let result;
    try {
      // Try to extract JSON from potential markdown code fences
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      result = JSON.parse(jsonMatch?.[0] ?? raw);
    } catch {
      throw new AppError(500, 'Failed to parse AI response');
    }

    const inputTokens = Math.ceil((schemaContext.length + body.prompt.length) / 4);
    const outputTokens = Math.ceil(raw.length / 4);
    await logAiUsage(app.db, userId, projectId, 'schema.design', 'claude-sonnet-4', inputTokens, outputTokens);

    return { tables: result.tables ?? [], estimated_tokens: inputTokens + outputTokens };
  });

  app.post('/:projectId/tables/:tableName/ai/analyze', async (request) => {
    const { projectId, tableName } = request.params as { projectId: string; tableName: string };
    const userId = request.userId ?? 'unknown';
    await checkAiQuota(app.db, userId);

    const dbSchema = resolveProjectSchema(request);

    // Collect schema info
    const columnsResult = await app.db.raw(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = ? AND table_name = ?
      ORDER BY ordinal_position
    `, [dbSchema, tableName]);

    // Sample data
    const sampleResult = await app.db.raw(
      `SELECT * FROM "${dbSchema}"."${tableName}" LIMIT 100`
    );

    // Row count
    const countResult = await app.db.raw(
      `SELECT COUNT(*)::int as count FROM "${dbSchema}"."${tableName}"`
    );

    // Existing indexes
    const indexesResult = await app.db.raw(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = ? AND tablename = ?
    `, [dbSchema, tableName]);

    // NULL counts per column
    const columns = columnsResult.rows;
    const nullCounts: Record<string, number> = {};
    for (const col of columns) {
      try {
        const nc = await app.db.raw(
          `SELECT COUNT(*)::int as cnt FROM "${dbSchema}"."${tableName}" WHERE "${col.column_name}" IS NULL`
        );
        nullCounts[col.column_name] = nc.rows[0]?.cnt ?? 0;
      } catch { /* skip */ }
    }

    const totalRows = countResult.rows[0]?.count ?? 0;

    const analysisContext = `
Table: ${tableName}
Total rows: ${totalRows}
Columns: ${JSON.stringify(columnsResult.rows)}
Existing indexes: ${JSON.stringify(indexesResult.rows)}
NULL counts: ${JSON.stringify(nullCounts)}
Sample data (first 5 rows): ${JSON.stringify(sampleResult.rows.slice(0, 5))}
`;

    const client = getClient();
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: `You are a PostgreSQL data analyst. Analyze the given table data and provide insights in the following categories.

Return a JSON object with this exact structure:
{
  "analyses": [
    {
      "category": "duplicates" | "outliers" | "missing_indexes" | "null_analysis",
      "severity": "low" | "medium" | "high",
      "title": "Short title",
      "description": "Detailed description of the finding",
      "suggestion": "Actionable suggestion to fix the issue",
      "affectedColumns": ["column1", "column2"]
    }
  ]
}

Always include at least one finding per category if relevant. If nothing notable, use severity "low" with a positive message.
Return ONLY the JSON, no explanations or markdown.`,
      messages: [{ role: 'user', content: analysisContext }],
    });

    const textBlock = response.content.find((b: { type: string }) => b.type === 'text');
    const raw = textBlock?.text?.trim() ?? '{}';

    let result;
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      result = JSON.parse(jsonMatch?.[0] ?? raw);
    } catch {
      throw new AppError(500, 'Failed to parse AI response');
    }

    const inputTokens = Math.ceil(analysisContext.length / 4);
    const outputTokens = Math.ceil(raw.length / 4);
    await logAiUsage(app.db, userId, projectId, 'data.analyze', 'claude-sonnet-4', inputTokens, outputTokens);

    return {
      analyses: result.analyses ?? [],
      tableName,
      totalRows,
      estimated_tokens: inputTokens + outputTokens,
    };
  });

  app.post('/:projectId/natural', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const userId = request.userId ?? 'unknown';
    await checkAiQuota(app.db, userId);

    const body = z.object({
      question: z.string().min(1).max(2000),
    }).parse(request.body);

    const dbSchema = resolveProjectSchema(request);
    const schemaContext = await getSchemaContext(app.db, dbSchema);

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

    // Safety check: reject non-SELECT queries
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

    // Execute the query
    let data;
    try {
      const result = await app.db.raw(sql);
      data = result.rows ?? [];
    } catch (err: any) {
      throw new AppError(400, `Query execution failed: ${err.message}`);
    }

    const inputTokens = Math.ceil((schemaContext.length + body.question.length) / 4);
    const outputTokens = Math.ceil(raw.length / 4);
    await logAiUsage(app.db, userId, projectId, 'natural.query', 'claude-sonnet-4', inputTokens, outputTokens);

    return { sql, data, explanation, estimated_tokens: inputTokens + outputTokens };
  });
}
