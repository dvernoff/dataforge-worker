import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { requireSuperadmin } from '../../middleware/rbac.middleware.js';
import { logAudit } from '../audit/audit.middleware.js';
import { AppError } from '../../middleware/error-handler.js';
import { z } from 'zod';

const QUOTA_FIELDS = [
  'max_projects', 'max_tables', 'max_records', 'max_api_requests',
  'max_storage_mb', 'max_endpoints', 'max_webhooks', 'max_files',
  'max_backups', 'max_cron', 'max_ai_requests_per_day', 'max_ai_tokens_per_day',
  'max_query_timeout_ms', 'max_concurrent_requests', 'max_rows_per_query', 'max_export_rows',
] as const;

const QUOTA_DEFAULTS: Record<string, number> = {
  max_projects: 10,
  max_tables: 50,
  max_records: 10000,
  max_api_requests: 1000,
  max_storage_mb: 500,
  max_endpoints: 20,
  max_webhooks: 10,
  max_files: 100,
  max_backups: 5,
  max_cron: 5,
  max_ai_requests_per_day: 50,
  max_ai_tokens_per_day: 100000,
  max_query_timeout_ms: 30000,
  max_concurrent_requests: 10,
  max_rows_per_query: 1000,
  max_export_rows: 10000,
};

export async function rolesRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  async function ensureCustomRolesTable() {
    const exists = await app.db.schema.hasTable('custom_roles');
    if (!exists) {
      await app.db.schema.createTable('custom_roles', (t) => {
        t.uuid('id').primary().defaultTo(app.db.fn.uuid());
        t.string('name').notNullable().unique();
        t.string('color', 7).defaultTo('#6B7280');
        t.text('description').nullable();
        t.jsonb('permissions').defaultTo('[]');
        t.jsonb('default_quotas').defaultTo('{}');
        // Quota columns
        t.integer('max_projects').defaultTo(10);
        t.integer('max_tables').defaultTo(50);
        t.integer('max_records').defaultTo(10000);
        t.integer('max_api_requests').defaultTo(1000);
        t.integer('max_storage_mb').defaultTo(500);
        t.integer('max_endpoints').defaultTo(20);
        t.integer('max_webhooks').defaultTo(10);
        t.integer('max_files').defaultTo(100);
        t.integer('max_backups').defaultTo(5);
        t.integer('max_cron').defaultTo(5);
        t.integer('max_ai_requests_per_day').defaultTo(50);
        t.integer('max_ai_tokens_per_day').defaultTo(100000);
        t.timestamp('created_at').defaultTo(app.db.fn.now());
        t.timestamp('updated_at').defaultTo(app.db.fn.now());
      });
    }
  }

  // GET /api/system/roles — list all custom roles (superadmin only)
  app.get('/', { preHandler: [requireSuperadmin()] }, async () => {
    await ensureCustomRolesTable();

    // Ensure users.role_id exists before subquery
    const hasRoleId = await app.db.schema.hasColumn('users', 'role_id');
    let usersCountExpr: string;
    if (hasRoleId) {
      usersCountExpr = `(SELECT COUNT(*)::int FROM users WHERE users.role_id = custom_roles.id)`;
    } else {
      usersCountExpr = '0';
    }

    const roles = await app.db('custom_roles')
      .select('custom_roles.*')
      .select(app.db.raw(`${usersCountExpr} as users_count`))
      .orderBy('created_at', 'desc');
    return { roles };
  });

  // POST /api/system/roles — create a custom role (superadmin only)
  app.post('/', { preHandler: [requireSuperadmin()] }, async (request) => {
    await ensureCustomRolesTable();

    const quotaSchema: Record<string, z.ZodTypeAny> = {};
    for (const field of QUOTA_FIELDS) {
      quotaSchema[field] = z.coerce.number().int().min(0).optional();
    }

    const body = z.object({
      name: z.string().min(1).max(100),
      color: z.string().max(7).optional(),
      description: z.string().max(500).optional(),
      ...quotaSchema,
    }).parse(request.body);

    const insert: Record<string, unknown> = {
      name: body.name,
      color: body.color ?? '#6B7280',
      description: body.description ?? null,
    };
    for (const field of QUOTA_FIELDS) {
      insert[field] = (body as Record<string, unknown>)[field] ?? QUOTA_DEFAULTS[field];
    }

    const [role] = await app.db('custom_roles')
      .insert(insert)
      .returning('*');

    logAudit(request, 'role.create', 'custom_role', role.id, { name: body.name });
    return { role: { ...role, users_count: 0 } };
  });

  // PUT /api/system/roles/:id — update a custom role (superadmin only)
  app.put('/:id', { preHandler: [requireSuperadmin()] }, async (request) => {
    await ensureCustomRolesTable();

    const { id } = request.params as { id: string };

    const quotaSchema: Record<string, z.ZodTypeAny> = {};
    for (const field of QUOTA_FIELDS) {
      quotaSchema[field] = z.coerce.number().int().min(0).optional();
    }

    const body = z.object({
      name: z.string().min(1).max(100).optional(),
      color: z.string().max(7).optional(),
      description: z.string().max(500).optional(),
      ...quotaSchema,
    }).parse(request.body);

    const update: Record<string, unknown> = { updated_at: new Date() };
    if (body.name !== undefined) update.name = body.name;
    if (body.color !== undefined) update.color = body.color;
    if (body.description !== undefined) update.description = body.description;
    for (const field of QUOTA_FIELDS) {
      const val = (body as Record<string, unknown>)[field];
      if (val !== undefined) update[field] = val;
    }

    const [role] = await app.db('custom_roles')
      .where({ id })
      .update(update)
      .returning('*');

    if (!role) {
      throw new AppError(404, 'Role not found');
    }

    logAudit(request, 'role.update', 'custom_role', id, { name: body.name });
    return { role };
  });

  // DELETE /api/system/roles/:id — delete a custom role (superadmin only)
  app.delete('/:id', { preHandler: [requireSuperadmin()] }, async (request) => {
    await ensureCustomRolesTable();

    const { id } = request.params as { id: string };

    const hasSettings = await app.db.schema.hasTable('system_settings');
    if (hasSettings) {
      const defaultRoleSetting = await app.db('system_settings').where({ key: 'default_role' }).first();
      if (defaultRoleSetting && defaultRoleSetting.value === id) {
        throw new AppError(400, 'Cannot delete the default role. Change the default role in Global Settings first.');
      }
    }

    const role = await app.db('custom_roles').where({ id }).first();
    if (!role) {
      throw new AppError(404, 'Role not found');
    }

    // Unassign users from this role
    const hasRoleId = await app.db.schema.hasColumn('users', 'role_id');
    if (hasRoleId) {
      await app.db('users').where({ role_id: id }).update({ role_id: null });
    }

    await app.db('custom_roles').where({ id }).del();

    logAudit(request, 'role.delete', 'custom_role', id, { name: role.name });
    return { success: true };
  });
}
