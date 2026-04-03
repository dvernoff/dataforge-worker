import { nanoid } from 'nanoid';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { env } from '../config/env.js';

export function generateInviteKey(): string {
  return nanoid(32);
}

export function generateApiToken(): string {
  return nanoid(32);
}

export function generateApiTokenPrefix(type: 'live' | 'test' = 'live'): string {
  return `df_${type}_${nanoid(8)}`;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, env.BCRYPT_ROUNDS);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function compareToken(token: string, hash: string): boolean {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(tokenHash, 'hex'), Buffer.from(hash, 'hex'));
}
