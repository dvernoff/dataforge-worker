import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/**
 * Track a server error in the tracked_errors table.
 * Fire-and-forget — never throws.
 */
function trackError(request: FastifyRequest, severity: 'error' | 'warning' | 'critical', title: string, message?: string, stack?: string) {
  const db = request.server.db;
  if (!db) return;

  // Determine source from request path
  let source: string = 'api';
  const url = request.url ?? '';
  if (url.includes('/webhooks')) source = 'webhook';
  else if (url.includes('/cron')) source = 'cron';

  db('tracked_errors')
    .insert({
      source,
      severity,
      title,
      message: message ?? null,
      stack_trace: stack ?? null,
      metadata: JSON.stringify({
        method: request.method,
        url: request.url,
        user_id: request.user?.id ?? null,
      }),
      status: 'open',
    })
    .catch(() => { /* swallow — don't let tracking errors break error handling */ });
}

export function errorHandler(
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply
): void {
  if (error instanceof AppError) {
    // Track 5xx app errors
    if (error.statusCode >= 500) {
      trackError(request, 'error', error.message, JSON.stringify(error.details), error.stack);
    }
    reply.status(error.statusCode).send({
      error: error.message,
      details: error.details,
    });
    return;
  }

  if (error instanceof ZodError) {
    reply.status(400).send({
      error: 'Validation error',
      details: error.flatten().fieldErrors,
    });
    return;
  }

  if ('statusCode' in error && typeof error.statusCode === 'number') {
    if (error.statusCode >= 500) {
      trackError(request, 'error', error.message, undefined, error.stack);
    }
    reply.status(error.statusCode).send({
      error: error.message,
    });
    return;
  }

  // Unhandled errors — always track as critical
  request.log.error(error, 'Unhandled error');
  trackError(request, 'critical', error.message, undefined, error.stack);

  if (process.env.NODE_ENV === 'production') {
    reply.status(500).send({
      error: 'Internal server error',
    });
  } else {
    reply.status(500).send({
      error: 'Internal server error',
      stack: error.stack,
    });
  }
}
