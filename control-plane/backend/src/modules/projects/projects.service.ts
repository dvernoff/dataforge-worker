import type { Knex } from 'knex';
import { AppError } from '../../middleware/error-handler.js';
import { generateSchemaName } from '../../utils/slug.js';
import type { CreateProjectInput, UpdateProjectInput } from '../../../../../shared/types/project.types.js';

export class ProjectsService {
  constructor(private db: Knex) {}

  async create(input: CreateProjectInput, userId: string) {
    const dbSchema = generateSchemaName(input.slug);

    const existing = await this.db('projects').where({ slug: input.slug }).first();
    if (existing) {
      throw new AppError(409, 'Project with this slug already exists');
    }

    if (input.node_id) {
      const node = await this.db('nodes').where({ id: input.node_id }).first();
      if (!node) throw new AppError(404, 'Node not found');
      if (node.owner_id && node.owner_id !== userId) {
        throw new AppError(403, 'Cannot assign project to another user\'s personal node');
      }
    }

    let defaultPlanId: string | null = null;
    const isPersonalNode = input.node_id
      ? !!(await this.db('nodes').where({ id: input.node_id }).whereNotNull('owner_id').first())
      : false;

    if (!isPersonalNode) {
      try {
        let defaultPlanName = 'Basic';
        try {
          const setting = await this.db('system_settings').where({ key: 'default_project_plan' }).first();
          if (setting?.value) defaultPlanName = setting.value;
        } catch {}
        const plan = await this.db('project_plans')
          .where({ name: defaultPlanName })
          .select('id')
          .first();
        if (plan) defaultPlanId = plan.id;
      } catch {}
    }

    const result = await this.db.transaction(async (trx) => {
      const [project] = await trx('projects')
        .insert({
          name: input.name,
          slug: input.slug,
          description: input.description ?? null,
          db_schema: dbSchema,
          node_id: input.node_id,
          plan_id: defaultPlanId,
          created_by: userId,
        })
        .returning('*');

      await trx('project_members').insert({
        project_id: project.id,
        user_id: userId,
        role: 'admin',
      });

      return project;
    });

    return result;
  }

  async findAll(userId: string, isSuperadmin: boolean) {
    if (isSuperadmin) {
      return this.db('projects')
        .select('projects.*')
        .select(this.db.raw('(SELECT name FROM users WHERE users.id = projects.created_by) as owner_name'))
        .select(
          this.db.raw('(SELECT COUNT(*) FROM project_members WHERE project_members.project_id = projects.id)::int as members_count')
        )
        .select(
          this.db.raw(`(SELECT role FROM project_members WHERE project_members.project_id = projects.id AND project_members.user_id = ?) as user_role`, [userId])
        )
        .orderBy('projects.created_at', 'desc');
    }

    return this.db('projects')
      .join('project_members', 'projects.id', 'project_members.project_id')
      .where('project_members.user_id', userId)
      .select('projects.*', 'project_members.role as user_role')
      .orderBy('projects.created_at', 'desc');
  }

  async findBySlug(slug: string) {
    const project = await this.db('projects').where({ slug }).first();
    if (!project) {
      throw new AppError(404, 'Project not found');
    }
    return project;
  }

  async findById(id: string) {
    const project = await this.db('projects').where({ id }).first();
    if (!project) {
      throw new AppError(404, 'Project not found');
    }
    return project;
  }

  async update(id: string, input: UpdateProjectInput) {
    const [project] = await this.db('projects')
      .where({ id })
      .update({
        ...input,
        updated_at: new Date(),
      })
      .returning('*');

    if (!project) {
      throw new AppError(404, 'Project not found');
    }

    return project;
  }

  async delete(id: string) {
    const project = await this.findById(id);

    await this.db.transaction(async (trx) => {
      try {
        const backups = await trx('backups').where({ project_id: id }).select('file_path');
        const fs = await import('fs');
        for (const b of backups) {
          try { if (b.file_path && fs.existsSync(b.file_path)) fs.unlinkSync(b.file_path); } catch {}
        }
      } catch {}

      const cleanupTables = [
        'backups', 'backup_schedules', 'api_tokens',
        'project_members', 'audit_logs', 'invite_keys',
      ];
      for (const table of cleanupTables) {
        try { await trx(table).where({ project_id: id }).delete(); } catch {}
      }

      await trx('projects').where({ id }).delete();
    });
  }

  async getMembers(projectId: string) {
    return this.db('project_members')
      .join('users', 'project_members.user_id', 'users.id')
      .where('project_members.project_id', projectId)
      .select(
        'project_members.id',
        'project_members.role',
        'project_members.created_at',
        'users.id as user_id',
        'users.email',
        'users.name',
        'users.is_superadmin',
        'users.last_login_at'
      );
  }

  async addMember(projectId: string, userId: string, role: string) {
    const existing = await this.db('project_members')
      .where({ project_id: projectId, user_id: userId })
      .first();

    if (existing) {
      throw new AppError(409, 'User is already a member of this project');
    }

    const [member] = await this.db('project_members')
      .insert({ project_id: projectId, user_id: userId, role })
      .returning('*');

    return member;
  }

  async updateMemberRole(projectId: string, userId: string, role: string) {
    const project = await this.db('projects').where({ id: projectId }).select('created_by').first();
    if (project?.created_by === userId) {
      throw new AppError(403, 'Cannot change the role of the project creator');
    }

    const current = await this.db('project_members')
      .where({ project_id: projectId, user_id: userId })
      .first();

    if (!current) {
      throw new AppError(404, 'Member not found');
    }

    if (current.role === 'admin' && role !== 'admin') {
      const adminCount = await this.db('project_members')
        .where({ project_id: projectId, role: 'admin' })
        .count('* as count')
        .first();

      if (Number(adminCount?.count) <= 1) {
        throw new AppError(400, 'Cannot demote the last admin of a project');
      }
    }

    const [member] = await this.db('project_members')
      .where({ project_id: projectId, user_id: userId })
      .update({ role })
      .returning('*');

    return member;
  }

  async removeMember(projectId: string, userId: string) {
    // Prevent removing the project creator
    const project = await this.db('projects')
      .where({ id: projectId })
      .select('created_by')
      .first();

    if (project?.created_by === userId) {
      throw new AppError(400, 'Cannot remove the project creator');
    }

    // Prevent removing the last admin
    const member = await this.db('project_members')
      .where({ project_id: projectId, user_id: userId })
      .first();

    if (!member) {
      throw new AppError(404, 'Member not found');
    }

    if (member.role === 'admin') {
      const adminCount = await this.db('project_members')
        .where({ project_id: projectId, role: 'admin' })
        .count('* as count')
        .first();

      if (Number(adminCount?.count) <= 1) {
        throw new AppError(400, 'Cannot remove the last admin of a project');
      }
    }

    await this.db('project_members')
      .where({ project_id: projectId, user_id: userId })
      .delete();
  }
}
