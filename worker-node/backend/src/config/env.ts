import { z } from 'zod';
import dotenv from 'dotenv';
import os from 'os';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, '../../../.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4001),
  HOST: z.string().default('0.0.0.0'),

  DATABASE_URL: z.string().url(),
  DATABASE_POOL_MIN: z.coerce.number().default(2),
  DATABASE_POOL_MAX: z.coerce.number().default(10),

  REDIS_URL: z.string().default('redis://localhost:6379'),

  NODE_API_KEY: z.string().min(16),
  CONTROL_PLANE_URL: z.string().url(),
  NODE_ID: z.string().default(os.hostname()),

  CORS_ORIGIN: z.string().default('*'),

  RATE_LIMIT_MAX: z.coerce.number().default(200),
  RATE_LIMIT_WINDOW: z.coerce.number().default(60000),

  WEBHOOK_TIMEOUT: z.coerce.number().default(10000),
  WEBHOOK_MAX_RETRIES: z.coerce.number().default(3),

  ENCRYPTION_KEY: z.string().optional(),

  // Secret shared between Control Plane and Worker for /internal/* routes
  INTERNAL_SECRET: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
