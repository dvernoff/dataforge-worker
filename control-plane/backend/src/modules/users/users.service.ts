import type { Knex } from 'knex';
import { AppError } from '../../middleware/error-handler.js';
import { hashPassword } from '../../utils/crypto.js';

export class UsersService {
  constructor(private db: Knex) {}

  private async ensureUserColumns() {
    const hasRoleId = await this.db.schema.hasColumn('users', 'role_id');
    if (!hasRoleId) {
      await this.db.schema.alterTable('users', (t) => {
        t.uuid('role_id').nullable();
      });
    }
    const hasBlockReason = await this.db.schema.hasColumn('users', 'block_reason');
    if (!hasBlockReason) {
      await this.db.schema.alterTable('users', (t) => {
        t.text('block_reason').nullable();
      });
    }
  }

  async findAll() {
    await this.ensureUserColumns();

    let hasBlockedAt = false;
    try {
      hasBlockedAt = await this.db.schema.hasColumn('users', 'blocked_at');
    } catch { /* ignore */ }

    const hasRoles = await this.db.schema.hasTable('custom_roles');

    const query = this.db('users')
      .select(
        'users.id', 'users.email', 'users.name', 'users.is_superadmin', 'users.is_active',
        'users.last_login_at', 'users.created_at', 'users.updated_at',
        'users.role_id'
      )
      .select(
        this.db.raw('(SELECT COUNT(*) FROM project_members WHERE project_members.user_id = users.id)::int as projects_count')
      );

    if (hasRoles) {
      query.leftJoin('custom_roles', 'users.role_id', 'custom_roles.id');
      query.select('custom_roles.name as role_name', 'custom_roles.color as role_color');
    }

    if (hasBlockedAt) {
      query.select('users.blocked_at', 'users.blocked_by', 'users.block_reason');
      // Join for invited_by name
      try {
        const hasInvitedBy = await this.db.schema.hasColumn('users', 'invited_by');
        if (hasInvitedBy) {
          query.select('inviter.name as invited_by_name');
          query.leftJoin('users as inviter', 'users.invited_by', 'inviter.id');
        }
      } catch { /* ignore */ }
    }

    return query.orderBy('users.created_at', 'desc');
  }

  async findById(id: string) {
    await this.ensureUserColumns();

    const hasBlockedAt = await this.db.schema.hasColumn('users', 'blocked_at');
    const hasRoles = await this.db.schema.hasTable('custom_roles');

    const query = this.db('users')
      .where('users.id', id)
      .select(
        'users.id', 'users.email', 'users.name', 'users.is_superadmin', 'users.is_active',
        'users.last_login_at', 'users.created_at', 'users.updated_at',
        'users.role_id'
      )
      .select(
        this.db.raw('(SELECT COUNT(*) FROM project_members WHERE project_members.user_id = users.id)::int as projects_count')
      );

    if (hasRoles) {
      query.leftJoin('custom_roles', 'users.role_id', 'custom_roles.id');
      query.select('custom_roles.name as role_name', 'custom_roles.color as role_color');
    }

    if (hasBlockedAt) {
      query.select('users.blocked_at', 'users.blocked_by', 'users.block_reason');
    }

    try {
      const hasInvitedBy = await this.db.schema.hasColumn('users', 'invited_by');
      if (hasInvitedBy) {
        query.select('inviter.name as invited_by_name');
        query.leftJoin('users as inviter', 'users.invited_by', 'inviter.id');
      }
    } catch { /* ignore */ }

    const user = await query.first();
    if (!user) {
      throw new AppError(404, 'User not found');
    }
    return user;
  }

  async create(data: { email: string; password: string; name: string; is_superadmin?: boolean }) {
    const existing = await this.db('users').where({ email: data.email }).first();
    if (existing) {
      throw new AppError(409, 'User with this email already exists');
    }

    const passwordHash = await hashPassword(data.password);
    const [user] = await this.db('users')
      .insert({
        email: data.email,
        password_hash: passwordHash,
        name: data.name,
        is_superadmin: data.is_superadmin ?? false,
      })
      .returning(['id', 'email', 'name', 'is_superadmin', 'is_active', 'created_at', 'updated_at']);

    return user;
  }

  async update(id: string, data: { name?: string; email?: string; is_active?: boolean; role_id?: string | null }) {
    const [user] = await this.db('users')
      .where({ id })
      .update({ ...data, updated_at: new Date() })
      .returning(['id', 'email', 'name', 'is_superadmin', 'is_active', 'created_at', 'updated_at']);

    if (!user) {
      throw new AppError(404, 'User not found');
    }
    return user;
  }

  async assignRole(id: string, roleId: string | null) {
    await this.ensureUserColumns();
    const [user] = await this.db('users')
      .where({ id })
      .update({ role_id: roleId, updated_at: new Date() })
      .returning(['id', 'email', 'name', 'is_superadmin', 'is_active', 'role_id']);

    if (!user) {
      throw new AppError(404, 'User not found');
    }
    return user;
  }

  async getUserProjects(userId: string) {
    return this.db('project_members')
      .join('projects', 'project_members.project_id', 'projects.id')
      .where('project_members.user_id', userId)
      .select(
        'projects.id as project_id',
        'projects.name as project_name',
        'projects.slug as project_slug',
        'project_members.role',
        'project_members.created_at as joined_at'
      )
      .orderBy('project_members.created_at', 'desc');
  }

  async promoteSuperadmin(id: string) {
    const [user] = await this.db('users')
      .where({ id })
      .update({ is_superadmin: true, updated_at: new Date() })
      .returning(['id', 'email', 'name', 'is_superadmin']);

    if (!user) {
      throw new AppError(404, 'User not found');
    }
    return user;
  }

  async demoteSuperadmin(id: string) {
    const [user] = await this.db('users')
      .where({ id })
      .update({ is_superadmin: false, updated_at: new Date() })
      .returning(['id', 'email', 'name', 'is_superadmin']);

    if (!user) {
      throw new AppError(404, 'User not found');
    }
    return user;
  }

  async deactivate(id: string) {
    return this.update(id, { is_active: false });
  }

  async activate(id: string) {
    return this.update(id, { is_active: true });
  }
}
