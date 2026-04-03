import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import type { UserPayload } from '../../../../../shared/types/auth.types.js';

export function signAccessToken(payload: UserPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES,
    issuer: 'dataforge-cp',
    audience: 'dataforge',
  } as jwt.SignOptions);
}

export function signRefreshToken(userId: string): string {
  return jwt.sign({ id: userId }, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES,
    issuer: 'dataforge-cp',
    audience: 'dataforge',
  } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): UserPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET, {
    issuer: 'dataforge-cp',
    audience: 'dataforge',
  }) as UserPayload;
}

export function verifyRefreshToken(token: string): { id: string } {
  return jwt.verify(token, env.JWT_REFRESH_SECRET, {
    issuer: 'dataforge-cp',
    audience: 'dataforge',
  }) as { id: string };
}

export function signTempToken(userId: string): string {
  return jwt.sign({ id: userId, purpose: '2fa' }, env.JWT_ACCESS_SECRET, {
    expiresIn: '5m',
    issuer: 'dataforge-cp',
    audience: 'dataforge',
  } as jwt.SignOptions);
}

export function verifyTempToken(token: string): { id: string; purpose: string } {
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, {
    issuer: 'dataforge-cp',
    audience: 'dataforge',
  }) as { id: string; purpose: string };
  if (payload.purpose !== '2fa') {
    throw new Error('Invalid token purpose');
  }
  return payload;
}
