import type { Knex } from 'knex';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, '../../.env') });

export async function seed(knex: Knex): Promise<void> {
  const email = process.env.ADMIN_EMAIL ?? 'admin@dataforge.local';
  const password = process.env.ADMIN_PASSWORD ?? 'Admin123!@#';
  const name = process.env.ADMIN_NAME ?? 'Superadmin';
  const rounds = Number(process.env.BCRYPT_ROUNDS ?? 12);

  // Check if superadmin already exists
  const existing = await knex('users').where({ email }).first();
  if (existing) {
    console.log('Superadmin already exists, skipping seed');
    return;
  }

  const passwordHash = await bcrypt.hash(password, rounds);

  await knex('users').insert({
    email,
    password_hash: passwordHash,
    name,
    is_superadmin: true,
    is_active: true,
  });

  console.log(`Superadmin created: ${email}`);
}
