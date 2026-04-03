import type { Knex } from 'knex';
import { AppError } from '../../middleware/error-handler.js';
import { generateApiToken, generateApiTokenPrefix, hashToken } from '../../utils/crypto.js';

export class TokensService {
  constructor(private db: Knex) {}

  async create(projectId: string, userId: string, input: {
    name: string;
    scopes: string[];
    allowed_ips?: string[];
    expires_at?: string;
  }) {
    const token = `df_live_${generateApiToken()}`;
    const prefix = token.slice(0, 12);
    const tokenHash = hashToken(token);

    const [record] = await this.db('api_tokens')
      .insert({
        project_id: projectId,
        user_id: userId,
        name: input.name,
        token_hash: tokenHash,
        prefix,
        scopes: JSON.stringify(input.scopes), // jsonb column — Knex needs stringified JSON for insert
        allowed_ips: input.allowed_ips ?? null,
        is_active: true,
        expires_at: input.expires_at ?? null,
      })
      .returning('*');

    // Return the full token ONLY on creation
    return { ...record, token };
  }

  async findAll(projectId: string) {
    return this.db('api_tokens')
      .where({ project_id: projectId })
      .select('id', 'project_id', 'user_id', 'name', 'prefix', 'scopes', 'allowed_ips', 'is_active', 'expires_at', 'last_used_at', 'created_at')
      .orderBy('created_at', 'desc');
  }

  async revoke(id: string, projectId: string) {
    const [token] = await this.db('api_tokens')
      .where({ id, project_id: projectId })
      .update({ is_active: false })
      .returning('*');

    if (!token) throw new AppError(404, 'Token not found');
    return token;
  }

  async delete(id: string, projectId: string) {
    const deleted = await this.db('api_tokens')
      .where({ id, project_id: projectId })
      .delete();
    if (!deleted) throw new AppError(404, 'Token not found');
  }
}
