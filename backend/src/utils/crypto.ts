import { nanoid } from 'nanoid';
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
  return bcrypt.hash(password, 12);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function hashToken(token: string): Promise<string> {
  return bcrypt.hash(token, 10);
}

export async function compareToken(token: string, hash: string): Promise<boolean> {
  return bcrypt.compare(token, hash);
}
