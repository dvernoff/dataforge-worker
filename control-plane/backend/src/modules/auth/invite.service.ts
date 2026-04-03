import type { Knex } from 'knex';
import { AppError } from '../../middleware/error-handler.js';
import { generateInviteKey } from '../../utils/crypto.js';

interface CreateInviteParams {
  role: 'admin' | 'editor' | 'viewer';
  maxUses: number;
  expiresAt?: string;
  projectId: string;
  createdBy: string;
}

export class InviteService {
  constructor(private db: Knex) {}

  async create(params: CreateInviteParams) {
    const key = generateInviteKey();

    const [invite] = await this.db('invite_keys')
      .insert({
        key,
        created_by: params.createdBy,
        role: params.role,
        max_uses: params.maxUses,
        expires_at: params.expiresAt ?? null,
        project_id: params.projectId,
        is_active: true,
      })
      .returning('*');

    return invite;
  }

  async findByProject(projectId: string) {
    return this.db('invite_keys')
      .where({ project_id: projectId })
      .orderBy('created_at', 'desc');
  }

  async deactivate(id: string, projectId: string) {
    const [invite] = await this.db('invite_keys')
      .where({ id, project_id: projectId })
      .update({ is_active: false })
      .returning('*');

    if (!invite) {
      throw new AppError(404, 'Invite key not found');
    }
    return invite;
  }

  async delete(id: string, projectId: string) {
    const deleted = await this.db('invite_keys')
      .where({ id, project_id: projectId })
      .delete();

    if (!deleted) {
      throw new AppError(404, 'Invite key not found');
    }
  }
}
