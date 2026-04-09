import type { FastifyInstance } from 'fastify';
import { WebSocketService } from '../realtime/websocket.service.js';

export function registerRequestLogger(app: FastifyInstance) {
  app.addHook('onResponse', async (request, reply) => {
    if (!request.url.startsWith('/api/v1/')) return;

    const projectId = request.projectId as string | undefined;
    if (!projectId) return;

    const responseTime = Math.round(reply.elapsedTime);
    const ip = request.headers['x-forwarded-for'] as string ?? request.ip;
    const userAgent = request.headers['user-agent'] ?? '';

    const cacheHeader = reply.getHeader('X-Cache') as string | undefined;
    const cacheStatus = cacheHeader === 'HIT' ? 'HIT' : cacheHeader === 'MISS' ? 'MISS' : null;

    const logEntry = {
      project_id: projectId,
      method: request.method,
      path: request.url,
      status_code: reply.statusCode,
      response_time_ms: responseTime,
      ip_address: typeof ip === 'string' ? ip.split(',')[0].trim() : ip,
      user_agent: userAgent,
      error: reply.statusCode >= 400 ? `HTTP ${reply.statusCode}` : null,
      cache_status: cacheStatus,
    };

    app.db('api_request_logs').insert(logEntry).returning('*')
      .then(([inserted]) => {
        try {
          const ws = WebSocketService.getInstance();
          ws.broadcast(`project:${projectId}`, {
            type: 'api_call' as any,
            table: '',
            action: 'INSERT',
            record: inserted,
            timestamp: new Date().toISOString(),
          });
        } catch {}
      })
      .catch(() => {});
  });
}
