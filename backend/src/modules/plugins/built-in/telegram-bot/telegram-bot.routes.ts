import type { FastifyInstance } from 'fastify';
import { nodeAuthMiddleware } from '../../../../middleware/node-auth.middleware.js';
import { requireWorkerRole } from '../../../../middleware/worker-rbac.middleware.js';
import { isModuleEnabled } from '../../../../utils/module-check.js';
import { z } from 'zod';

const TELEGRAM_API = 'https://api.telegram.org/bot';

async function ensureTable(app: FastifyInstance) {
  const exists = await app.db.schema.hasTable('telegram_notifications');
  if (!exists) {
    await app.db.schema.createTable('telegram_notifications', (t) => {
      t.uuid('id').primary().defaultTo(app.db.fn.uuid());
      t.uuid('project_id').notNullable();
      t.string('name', 255);
      t.text('bot_token').notNullable();
      t.text('chat_id').notNullable();
      t.specificType('table_names', 'text[]').notNullable();
      t.specificType('events', 'text[]').notNullable();
      t.text('message_template');
      t.string('parse_mode', 10).defaultTo('HTML');
      t.boolean('show_record_fields').defaultTo(true);
      t.boolean('disable_preview').defaultTo(true);
      t.jsonb('conditions').defaultTo('[]');
      t.boolean('is_active').defaultTo(true);
      t.timestamp('created_at').defaultTo(app.db.fn.now());
      t.index('project_id');
    });
  } else {
    const hasConditions = await app.db.schema.hasColumn('telegram_notifications', 'conditions');
    if (!hasConditions) {
      await app.db.schema.alterTable('telegram_notifications', (t) => { t.jsonb('conditions').defaultTo('[]'); });
    }
  }
}

const conditionSchema = z.object({
  field: z.string().min(1),
  operator: z.enum(['equals', 'not_equals', 'contains', 'gt', 'gte', 'lt', 'lte', 'is_empty', 'is_not_empty']),
  value: z.string().optional(),
});

const notificationSchema = z.object({
  name: z.string().max(255).optional(),
  bot_token: z.string().min(10).max(200),
  chat_id: z.string().min(1).max(100),
  table_names: z.array(z.string().min(1)).min(1),
  events: z.array(z.enum(['INSERT', 'UPDATE', 'DELETE'])).min(1),
  conditions: z.array(conditionSchema).max(10).optional().nullable(),
  message_template: z.string().max(4096).optional().nullable(),
  parse_mode: z.enum(['HTML', 'MarkdownV2']).optional(),
  show_record_fields: z.boolean().optional(),
  disable_preview: z.boolean().optional(),
  is_active: z.boolean().optional(),
});

export async function telegramBotRoutes(app: FastifyInstance) {
  app.addHook('preHandler', nodeAuthMiddleware);
  app.addHook('preHandler', requireWorkerRole('editor'));

  app.get('/:projectId/telegram-notifications', async (request) => {
    const { projectId } = request.params as { projectId: string };
    await ensureTable(app);
    const rows = await app.db('telegram_notifications')
      .where({ project_id: projectId })
      .orderBy('created_at', 'desc');
    const masked = rows.map((r: Record<string, unknown>) => ({
      ...r,
      bot_token: r.bot_token ? String(r.bot_token).substring(0, 6) + '••••••' : null,
    }));
    return { notifications: masked };
  });

  app.post('/:projectId/telegram-notifications', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const body = notificationSchema.parse(request.body);
    await ensureTable(app);
    const [row] = await app.db('telegram_notifications')
      .insert({
        project_id: projectId,
        name: body.name ?? null,
        bot_token: body.bot_token,
        chat_id: body.chat_id,
        table_names: body.table_names,
        events: body.events,
        conditions: JSON.stringify(body.conditions ?? []),
        message_template: body.message_template ?? null,
        parse_mode: body.parse_mode ?? 'HTML',
        show_record_fields: body.show_record_fields ?? true,
        disable_preview: body.disable_preview ?? true,
        is_active: body.is_active ?? true,
      })
      .returning('*');
    return { notification: row };
  });

  app.put('/:projectId/telegram-notifications/:id', async (request) => {
    const { projectId, id } = request.params as { projectId: string; id: string };
    const body = notificationSchema.partial().parse(request.body);
    await ensureTable(app);
    const update: Record<string, unknown> = {};
    if (body.conditions !== undefined) update.conditions = JSON.stringify(body.conditions ?? []);
    for (const key of ['name', 'bot_token', 'chat_id', 'table_names', 'events', 'message_template', 'parse_mode', 'show_record_fields', 'disable_preview', 'is_active'] as const) {
      if ((body as Record<string, unknown>)[key] !== undefined) update[key] = (body as Record<string, unknown>)[key];
    }
    if (update.bot_token && String(update.bot_token).includes('••')) delete update.bot_token;
    const [row] = await app.db('telegram_notifications')
      .where({ id, project_id: projectId })
      .update(update)
      .returning('*');
    if (!row) return { error: 'Not found' };
    return { notification: row };
  });

  app.delete('/:projectId/telegram-notifications/:id', async (request, reply) => {
    const { projectId, id } = request.params as { projectId: string; id: string };
    await ensureTable(app);
    await app.db('telegram_notifications').where({ id, project_id: projectId }).delete();
    return reply.status(204).send();
  });

}

interface Condition { field: string; operator: string; value?: string; }

function checkConditions(conditions: Condition[], record: Record<string, unknown>): boolean {
  if (!conditions || conditions.length === 0) return true;
  for (const c of conditions) {
    const raw = record[c.field];
    const val = raw != null ? String(raw) : '';
    const cmp = c.value ?? '';
    switch (c.operator) {
      case 'equals': if (val !== cmp) return false; break;
      case 'not_equals': if (val === cmp) return false; break;
      case 'contains': if (!val.includes(cmp)) return false; break;
      case 'gt': if (Number(val) <= Number(cmp)) return false; break;
      case 'gte': if (Number(val) < Number(cmp)) return false; break;
      case 'lt': if (Number(val) >= Number(cmp)) return false; break;
      case 'lte': if (Number(val) > Number(cmp)) return false; break;
      case 'is_empty': if (val !== '') return false; break;
      case 'is_not_empty': if (val === '') return false; break;
    }
  }
  return true;
}

function applyTemplate(template: string, event: string, tableName: string, record: Record<string, unknown>): string {
  let result = template
    .replace(/\{event\}/g, event)
    .replace(/\{table\}/g, tableName);
  result = result.replace(/\{data\.(\w+)\}/g, (_, field) => {
    const val = record[field];
    return val !== null && val !== undefined ? String(val) : '';
  });
  return result;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function fireTelegramNotifications(
  db: import('knex').Knex,
  projectId: string,
  tableName: string,
  event: string,
  record: Record<string, unknown>
) {
  try {
    const enabled = await isModuleEnabled(db, projectId, 'telegram-bot');
    if (!enabled) return;

    const hasTable = await db.schema.hasTable('telegram_notifications');
    if (!hasTable) return;

    const hooks = await db('telegram_notifications')
      .where({ project_id: projectId, is_active: true })
      .whereRaw('? = ANY(table_names)', [tableName])
      .whereRaw('? = ANY(events)', [event]);

    for (const hook of hooks) {
      const conditions = typeof hook.conditions === 'string' ? JSON.parse(hook.conditions) : (hook.conditions ?? []);
      if (!checkConditions(conditions, record)) continue;

      let text: string;

      if (hook.message_template) {
        text = applyTemplate(hook.message_template, event, tableName, record);
      } else {
        const emoji = event === 'INSERT' ? '🟢' : event === 'UPDATE' ? '🟡' : '🔴';
        text = `${emoji} <b>${event}</b> — <code>${escapeHtml(tableName)}</code>\n`;

        if (hook.show_record_fields !== false) {
          const entries = Object.entries(record).filter(([, v]) => v != null).slice(0, 10);
          for (const [k, v] of entries) {
            text += `\n<b>${escapeHtml(k)}:</b> <code>${escapeHtml(String(v).substring(0, 200))}</code>`;
          }
        }
      }

      fetch(`${TELEGRAM_API}${hook.bot_token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: hook.chat_id,
          text,
          parse_mode: hook.parse_mode ?? 'HTML',
          disable_web_page_preview: hook.disable_preview !== false,
        }),
      }).catch(() => {});
    }
  } catch {}
}
