import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { env } from '../config/env.js';

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
 * Parse PostgreSQL error into a user-friendly message.
 * Returns null if the error is not a recognized PG error.
 */
/**
 * Fire-and-forget: log quota violation to CP audit log.
 * Shows up in project audit trail so user/admin can see what was blocked.
 */
function logQuotaViolation(request: FastifyRequest, action: string, details: Record<string, unknown>) {
  const projectId = request.projectId;
  const userId = request.userId;
  if (!projectId || !userId) return;

  fetch(`${env.CONTROL_PLANE_URL}/api/internal/audit`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-node-api-key': env.NODE_API_KEY,
    },
    body: JSON.stringify({
      project_id: projectId,
      user_id: userId,
      action,
      resource_type: 'quota',
      details,
    }),
    signal: AbortSignal.timeout(3000),
  }).catch(() => {});
}

interface PgError extends Error {
  code?: string;
  column?: string;
  detail?: string;
  constraint?: string;
  table?: string;
}

function parsePgError(error: PgError): { status: number; message: string } | null {
  const code = error.code;
  if (!code || typeof code !== 'string') return null;

  const col = error.column ?? '';
  const detail = error.detail ?? '';
  const constraint = error.constraint ?? '';
  const table = error.table ?? '';

  switch (code) {
    // ─── Data Exceptions ────────────────────────────────
    case '22003': // numeric_value_out_of_range
      return {
        status: 400,
        message: `Value out of range for column type. Integer columns support values from -2147483648 to 2147483647. Use bigint for larger numbers.`,
      };
    case '22001': // string_data_right_truncation
      return {
        status: 400,
        message: `Value too long for column${col ? ` "${col}"` : ''}. Reduce the text length or change column type to "text".`,
      };
    case '22P02': // invalid_text_representation
      return {
        status: 400,
        message: `Invalid value format${detail ? `: ${detail}` : ''}. Check that the value matches the column type.`,
      };
    case '22007': // invalid_datetime_format
      return {
        status: 400,
        message: `Invalid date/time format. Use ISO 8601 format: YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS.`,
      };
    case '22008': // datetime_field_overflow
      return {
        status: 400,
        message: `Date/time value out of range.`,
      };

    // ─── Integrity Constraint Violations ─────────────────
    case '23502': // not_null_violation
      return {
        status: 400,
        message: `Column "${error.column ?? 'unknown'}" cannot be empty (NOT NULL constraint).`,
      };
    case '23503': // foreign_key_violation
      return {
        status: 400,
        message: detail
          ? `Foreign key violation: ${detail}`
          : `Cannot complete this action — it would violate a foreign key constraint${constraint ? ` "${constraint}"` : ''}.`,
      };
    case '23505': // unique_violation
      return {
        status: 409,
        message: detail
          ? `Duplicate value: ${detail}`
          : `This value already exists (unique constraint${constraint ? ` "${constraint}"` : ''}).`,
      };
    case '23514': // check_constraint_violation
      return {
        status: 400,
        message: `Value violates check constraint${constraint ? ` "${constraint}"` : ''}${table ? ` on table "${table}"` : ''}.`,
      };

    // ─── Schema / DDL Errors ────────────────────────────
    case '42P07': // duplicate_table
      return { status: 409, message: `Table already exists.` };
    case '42P01': // undefined_table
      return { status: 404, message: `Table not found.` };
    case '42703': // undefined_column
      return { status: 404, message: `Column not found${detail ? `: ${detail}` : ''}.` };
    case '42701': // duplicate_column
      return { status: 409, message: `Column with this name already exists.` };
    case '42830': // invalid_foreign_key
      return { status: 400, message: `Target column must have a UNIQUE or PRIMARY KEY constraint.` };
    case '42804': // datatype_mismatch
      return { status: 400, message: `Incompatible data types${detail ? `: ${detail}` : ''}.` };
    case '42710': // duplicate_object
      return { status: 409, message: `Object "${constraint || 'unknown'}" already exists.` };
    case '2BP01': // dependent_objects_still_exist
      return { status: 400, message: `Cannot drop — dependent objects exist (indexes, foreign keys, or views). Remove them first.` };

    // ─── Query Cancellation (quota timeout) ───────────────
    case '57014': // query_canceled (statement_timeout)
      return { status: 408, message: `Query exceeded time limit and was cancelled. Optimize your query or contact admin to increase quota.` };
    case '57P01': // admin_shutdown
      return { status: 503, message: `Server is shutting down. Try again later.` };

    // ─── Insufficient Resources ─────────────────────────
    case '53100': // disk_full
      return { status: 507, message: `Disk full. Contact administrator.` };
    case '53200': // out_of_memory
      return { status: 507, message: `Server out of memory. Try a smaller operation.` };

    // ─── Syntax / Access ────────────────────────────────
    case '42601': // syntax_error
      return { status: 400, message: `SQL syntax error. Check your expression.` };
    case '42501': // insufficient_privilege
      return { status: 403, message: `Insufficient permissions for this operation.` };

    default:
      return null;
  }
}

export function errorHandler(
  error: FastifyError | Error,
  _request: FastifyRequest,
  reply: FastifyReply
): void {
  if (error instanceof AppError) {
    const payload: Record<string, unknown> = {
      error: error.message,
      details: error.details,
    };
    // Forward extra fields (errorCode, column, targetType, etc.)
    for (const key of ['errorCode', 'column', 'targetType'] as const) {
      if (key in error) payload[key] = (error as Record<string, unknown>)[key];
    }
    reply.status(error.statusCode).send(payload);
    return;
  }

  if (error instanceof ZodError) {
    reply.status(400).send({
      error: 'Validation error',
      details: error.flatten().fieldErrors,
    });
    return;
  }

  // ─── PostgreSQL errors ──────────────────────────────
  const pgErr = error as PgError;
  const pgResult = parsePgError(pgErr);
  if (pgResult) {
    const payload: Record<string, unknown> = {
      error: pgResult.message,
      errorCode: `PG_${pgErr.code}`,
    };
    // Forward useful PG metadata for frontend translation interpolation
    if (pgErr.column) payload.column = pgErr.column;
    if (pgErr.detail) payload.detail = pgErr.detail;
    if (pgErr.constraint) payload.constraint = pgErr.constraint;
    if (pgErr.table) payload.table = pgErr.table;

    // Log quota-related violations to project audit
    if (pgErr.code === '57014') {
      logQuotaViolation(_request, 'quota.query_timeout', {
        path: _request.url,
        method: _request.method,
      });
    }

    reply.status(pgResult.status).send(payload);
    return;
  }

  if ('statusCode' in error && typeof error.statusCode === 'number') {
    reply.status(error.statusCode).send({
      error: error.message,
    });
    return;
  }

  _request.log.error(error, 'Unhandled error');
  if (process.env.NODE_ENV === 'production') {
    reply.status(500).send({
      error: 'Internal server error',
    });
  } else {
    reply.status(500).send({
      error: 'Internal server error',
      message: error.message,
    });
  }
}
