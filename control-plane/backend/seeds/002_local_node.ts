import type { Knex } from 'knex';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, '../../.env') });

function encryptApiKey(plaintext: string, secretsKey: string): string {
  const key = crypto.createHash('sha256').update(secretsKey).digest();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
}

export async function seed(knex: Knex): Promise<void> {
  if (process.env.NODE_ENV !== 'development') {
    return;
  }

  const workerApiKey = process.env.WORKER_NODE_API_KEY;
  if (!workerApiKey) {
    console.log('WORKER_NODE_API_KEY not set, skipping local node seed');
    return;
  }

  // Check if local node already exists
  const existing = await knex('nodes').where({ slug: 'local' }).first();
  if (existing) {
    console.log('Local node already exists, skipping seed');
    return;
  }

  const rounds = Number(process.env.BCRYPT_ROUNDS ?? 12);
  const apiKeyHash = await bcrypt.hash(workerApiKey, rounds);

  // In dev mode, worker is accessible via Docker service name
  const workerUrl = process.env.LOCAL_WORKER_URL ?? 'http://worker:4001';

  // Insert base node data (columns from migration)
  await knex('nodes').insert({
    name: 'Local Worker',
    slug: 'local',
    url: workerUrl,
    region: 'local',
    status: 'online',
    is_local: true,
    max_projects: 100,
    api_key_hash: apiKeyHash,
  });

  // Try to add encrypted API key if the column exists (added by ensurePersonalNodeColumns)
  const encryptionKey = process.env.SECRETS_ENCRYPTION_KEY;
  if (encryptionKey) {
    const hasColumn = await knex.schema.hasColumn('nodes', 'api_key_encrypted');
    if (hasColumn) {
      try {
        const apiKeyEncrypted = encryptApiKey(workerApiKey, encryptionKey);
        await knex('nodes').where({ slug: 'local' }).update({ api_key_encrypted: apiKeyEncrypted });
      } catch {
        // Encryption failed, proxy will fall back to shared key
      }
    }
  }

  console.log(`Local node created: ${workerUrl}`);
}
