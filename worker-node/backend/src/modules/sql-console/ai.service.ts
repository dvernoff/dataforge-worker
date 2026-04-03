let Anthropic: any = null;

const getClient = () => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured');
  }
  if (!Anthropic) {
    try {
      Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk');
    } catch {
      throw new Error('@anthropic-ai/sdk is not installed. Run: npm install @anthropic-ai/sdk');
    }
  }
  return new Anthropic({ apiKey });
};

export class AISQLService {
  async generateSQL(schemaContext: string, prompt: string): Promise<string> {
    const client = getClient();
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: `You are a PostgreSQL SQL expert. Generate SQL queries based on the user's request.
You will be given the database schema context and a natural language description.
Return ONLY the SQL query, nothing else. No explanations, no markdown formatting.

Database Schema:
${schemaContext}`,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = response.content.find((b: { type: string }) => b.type === 'text');
    return textBlock?.text?.trim() ?? '';
  }

  async explainSQL(sql: string): Promise<string> {
    const client = getClient();
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: 'You are a PostgreSQL expert. Explain the given SQL query in plain English. Be concise and clear. Use bullet points for complex queries.',
      messages: [{ role: 'user', content: `Explain this SQL query:\n\n${sql}` }],
    });

    const textBlock = response.content.find((b: { type: string }) => b.type === 'text');
    return textBlock?.text?.trim() ?? '';
  }

  async optimizeSQL(sql: string, schemaContext: string): Promise<string> {
    const client = getClient();
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: `You are a PostgreSQL performance expert. Analyze and optimize the given SQL query.
Provide the optimized SQL followed by a brief explanation of what was improved.

Database Schema:
${schemaContext}`,
      messages: [{ role: 'user', content: `Optimize this SQL query:\n\n${sql}` }],
    });

    const textBlock = response.content.find((b: { type: string }) => b.type === 'text');
    return textBlock?.text?.trim() ?? '';
  }

  async fixError(sql: string, error: string, schemaContext: string): Promise<string> {
    const client = getClient();
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: `You are a PostgreSQL expert. Fix the given SQL query based on the error message.
Return ONLY the fixed SQL query. No explanations.

Database Schema:
${schemaContext}`,
      messages: [{
        role: 'user',
        content: `Fix this SQL query:\n\n${sql}\n\nError:\n${error}`,
      }],
    });

    const textBlock = response.content.find((b: { type: string }) => b.type === 'text');
    return textBlock?.text?.trim() ?? '';
  }
}
