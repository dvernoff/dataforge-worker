import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyAccessToken } from '../modules/auth/jwt.utils.js';
import type { UserPayload } from '../../../../shared/types/auth.types.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: UserPayload;
  }
}

export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    reply.status(401).send({ error: 'Access token required' });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const payload = verifyAccessToken(token);

    // Re-validate critical fields from database (never trust JWT alone)
    const { db } = request.server;
    const dbUser = await db('users')
      .where({ id: payload.id })
      .select('is_superadmin', 'is_active')
      .first();

    if (!dbUser) {
      reply.status(401).send({ error: 'User no longer exists' });
      return;
    }

    if (!dbUser.is_active) {
      reply.status(403).send({ error: 'Account is deactivated' });
      return;
    }

    // Override JWT claims with DB truth
    payload.is_superadmin = dbUser.is_superadmin;
    request.user = payload;
  } catch {
    reply.status(401).send({ error: 'Invalid or expired access token' });
  }
}
