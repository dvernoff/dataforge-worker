import type { Knex } from 'knex';
import { encrypt, decrypt } from '../../utils/encryption.js';

export class SecretsService {
  constructor(private db: Knex) {}

  async list(projectId: string) {
    const secrets = await this.db('project_secrets')
      .where({ project_id: projectId })
      .orderBy('created_at', 'desc');

    // Mask values
    return secrets.map((s: Record<string, unknown>) => ({
      ...s,
      encrypted_value: undefined,
      value_masked: '••••••••',
    }));
  }

  async getById(projectId: string, secretId: string, reveal = false) {
    const secret = await this.db('project_secrets').where({ id: secretId, project_id: projectId }).first();
    if (!secret) return null;

    if (reveal) {
      return {
        ...secret,
        decrypted_value: decrypt(secret.encrypted_value),
        encrypted_value: undefined,
      };
    }

    return {
      ...secret,
      encrypted_value: undefined,
      value_masked: '••••••••',
    };
  }

  async create(input: {
    project_id: string;
    key: string;
    value: string;
    description?: string;
    created_by?: string;
  }) {
    const encrypted = encrypt(input.value);
    const [secret] = await this.db('project_secrets')
      .insert({
        project_id: input.project_id,
        key: input.key,
        encrypted_value: encrypted,
        description: input.description,
        created_by: input.created_by,
      })
      .returning('*');

    return {
      ...secret,
      encrypted_value: undefined,
      value_masked: '••••••••',
    };
  }

  async update(projectId: string, secretId: string, input: {
    value?: string;
    description?: string;
  }) {
    const updates: Record<string, unknown> = {
      updated_at: new Date(),
    };
    if (input.value !== undefined) {
      updates.encrypted_value = encrypt(input.value);
    }
    if (input.description !== undefined) {
      updates.description = input.description;
    }

    const [secret] = await this.db('project_secrets')
      .where({ id: secretId, project_id: projectId })
      .update(updates)
      .returning('*');

    return {
      ...secret,
      encrypted_value: undefined,
      value_masked: '••••••••',
    };
  }

  async delete(projectId: string, secretId: string) {
    await this.db('project_secrets').where({ id: secretId, project_id: projectId }).delete();
  }
}
