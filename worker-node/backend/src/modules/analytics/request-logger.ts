import type { FastifyInstance } from 'fastify';

export function registerRequestLogger(app: FastifyInstance) {
  app.addHook('onResponse', async (request, reply) => {
    if (!request.url.startsWith('/api/v1/')) return;

    const projectId = request.projectId as string | undefined;
    if (!projectId) return;

    const responseTime = Math.round(reply.elapsedTime);
    const ip = request.headers['x-forwarded-for'] as string ?? request.ip;
    const userAgent = request.headers['user-agent'] ?? '';

    try {
      await app.db('api_request_logs').insert({
        project_id: projectId,
        method: request.method,
        path: request.url,
        status_code: reply.statusCode,
        response_time_ms: responseTime,
        ip_address: typeof ip === 'string' ? ip.split(',')[0].trim() : ip,
        user_agent: userAgent,
        error: reply.statusCode >= 400 ? `HTTP ${reply.statusCode}` : null,
      });
    } catch {
    }
  });
}
