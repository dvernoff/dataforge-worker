import type { FastifyInstance } from 'fastify';
import { nodeAuthMiddleware } from '../../../../middleware/node-auth.middleware.js';
import { requireWorkerRole } from '../../../../middleware/worker-rbac.middleware.js';
import { isModuleEnabled } from '../../../../utils/module-check.js';
import { z } from 'zod';

async function ensureTable(app: FastifyInstance) {
  const exists = await app.db.schema.hasTable('discord_webhooks');
  if (!exists) {
    await app.db.schema.createTable('discord_webhooks', (t) => {
      t.uuid('id').primary().defaultTo(app.db.fn.uuid());
      t.uuid('project_id').notNullable();
      t.string('name', 255);
      t.text('webhook_url').notNullable();
      t.specificType('table_names', 'text[]').notNullable();
      t.specificType('events', 'text[]').notNullable();
      t.text('content_template');
      t.text('embed_title');
      t.text('embed_description');
      t.string('embed_color', 7).defaultTo('auto');
      t.boolean('show_record_fields').defaultTo(true);
      t.jsonb('conditions').defaultTo('[]');
      t.boolean('is_active').defaultTo(true);
      t.timestamp('created_at').defaultTo(app.db.fn.now());
      t.index('project_id');
    });
  } else {
    const hasConditions = await app.db.schema.hasColumn('discord_webhooks', 'conditions');
    if (!hasConditions) {
      await app.db.schema.alterTable('discord_webhooks', (t) => { t.jsonb('conditions').defaultTo('[]'); });
    }
    const cols = ['content_template', 'embed_title', 'embed_description', 'embed_color', 'show_record_fields'];
    for (const col of cols) {
      const has = await app.db.schema.hasColumn('discord_webhooks', col);
      if (!has) {
        await app.db.schema.alterTable('discord_webhooks', (t) => {
          if (col === 'show_record_fields') t.boolean(col).defaultTo(true);
          else if (col === 'embed_color') t.string(col, 7).defaultTo('auto');
          else t.text(col);
        });
      }
    }
    const hasOld = await app.db.schema.hasColumn('discord_webhooks', 'message_template');
    if (hasOld) {
      await app.db.raw(`UPDATE discord_webhooks SET content_template = message_template WHERE content_template IS NULL AND message_template IS NOT NULL`);
      await app.db.schema.alterTable('discord_webhooks', (t) => { t.dropColumn('message_template'); });
    }
  }
}

const conditionSchema = z.object({
  field: z.string().min(1),
  operator: z.enum(['equals', 'not_equals', 'contains', 'gt', 'gte', 'lt', 'lte', 'is_empty', 'is_not_empty']),
  value: z.string().optional(),
});

const webhookSchema = z.object({
  name: z.string().max(255).optional(),
  webhook_url: z.string().url().max(2000),
  table_names: z.array(z.string().min(1)).min(1),
  events: z.array(z.enum(['INSERT', 'UPDATE', 'DELETE'])).min(1),
  conditions: z.array(conditionSchema).max(10).optional().nullable(),
  content_template: z.string().max(2000).optional().nullable(),
  embed_title: z.string().max(256).optional().nullable(),
  embed_description: z.string().max(4096).optional().nullable(),
  embed_color: z.string().max(7).optional().nullable(),
  show_record_fields: z.boolean().optional(),
  is_active: z.boolean().optional(),
});

export async function discordWebhookRoutes(app: FastifyInstance) {
  app.addHook('preHandler', nodeAuthMiddleware);
  app.addHook('preHandler', requireWorkerRole('editor'));

  app.get('/:projectId/discord-webhooks', async (request) => {
    const { projectId } = request.params as { projectId: string };
    await ensureTable(app);
    const rows = await app.db('discord_webhooks')
      .where({ project_id: projectId })
      .orderBy('created_at', 'desc');
    const masked = rows.map((r: Record<string, unknown>) => ({
      ...r,
      webhook_url: r.webhook_url ? String(r.webhook_url).substring(0, 40) + '••••••' : null,
    }));
    return { webhooks: masked };
  });

  app.post('/:projectId/discord-webhooks', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const body = webhookSchema.parse(request.body);
    await ensureTable(app);
    const [row] = await app.db('discord_webhooks')
      .insert({
        project_id: projectId,
        name: body.name ?? null,
        webhook_url: body.webhook_url,
        table_names: body.table_names,
        events: body.events,
        conditions: JSON.stringify(body.conditions ?? []),
        content_template: body.content_template ?? null,
        embed_title: body.embed_title ?? null,
        embed_description: body.embed_description ?? null,
        embed_color: body.embed_color ?? 'auto',
        show_record_fields: body.show_record_fields ?? true,
        is_active: body.is_active ?? true,
      })
      .returning('*');
    return { webhook: row };
  });

  app.put('/:projectId/discord-webhooks/:id', async (request) => {
    const { projectId, id } = request.params as { projectId: string; id: string };
    const body = webhookSchema.partial().parse(request.body);
    await ensureTable(app);
    const update: Record<string, unknown> = {};
    if (body.conditions !== undefined) update.conditions = JSON.stringify(body.conditions ?? []);
    for (const key of ['name', 'webhook_url', 'table_names', 'events', 'content_template', 'embed_title', 'embed_description', 'embed_color', 'show_record_fields', 'is_active'] as const) {
      if ((body as Record<string, unknown>)[key] !== undefined) update[key] = (body as Record<string, unknown>)[key];
    }
    if (update.webhook_url && String(update.webhook_url).includes('••')) delete update.webhook_url;
    const [row] = await app.db('discord_webhooks')
      .where({ id, project_id: projectId })
      .update(update)
      .returning('*');
    if (!row) return { error: 'Not found' };
    return { webhook: row };
  });

  app.delete('/:projectId/discord-webhooks/:id', async (request, reply) => {
    const { projectId, id } = request.params as { projectId: string; id: string };
    await ensureTable(app);
    await app.db('discord_webhooks').where({ id, project_id: projectId }).delete();
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

export async function fireDiscordWebhooks(
  db: import('knex').Knex,
  projectId: string,
  tableName: string,
  event: string,
  record: Record<string, unknown>
) {
  try {
    const enabled = await isModuleEnabled(db, projectId, 'discord-webhook');
    if (!enabled) return;

    const hasTable = await db.schema.hasTable('discord_webhooks');
    if (!hasTable) return;

    const hooks = await db('discord_webhooks')
      .where({ project_id: projectId, is_active: true })
      .whereRaw('? = ANY(table_names)', [tableName])
      .whereRaw('? = ANY(events)', [event]);

    for (const hook of hooks) {
      const conditions = typeof hook.conditions === 'string' ? JSON.parse(hook.conditions) : (hook.conditions ?? []);
      if (!checkConditions(conditions, record)) continue;

      const autoColor = event === 'INSERT' ? 0x57f287 : event === 'UPDATE' ? 0xfee75c : 0xed4245;
      const embedColor = (!hook.embed_color || hook.embed_color === 'auto')
        ? autoColor
        : parseInt(hook.embed_color.replace('#', ''), 16);

      const embed: Record<string, unknown> = {
        color: embedColor,
        timestamp: new Date().toISOString(),
      };

      if (hook.embed_title) {
        embed.title = applyTemplate(hook.embed_title, event, tableName, record).substring(0, 256);
      } else {
        embed.title = `${event} — ${tableName}`;
      }

      if (hook.embed_description) {
        embed.description = applyTemplate(hook.embed_description, event, tableName, record).substring(0, 4096);
      }

      if (hook.show_record_fields !== false) {
        embed.fields = Object.entries(record)
          .filter(([, v]) => v !== null && v !== undefined)
          .slice(0, 10)
          .map(([k, v]) => ({ name: k, value: String(v).substring(0, 200), inline: true }));
      }

      let content: string | undefined;
      if (hook.content_template) {
        content = applyTemplate(hook.content_template, event, tableName, record);
      }

      fetch(hook.webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: content || undefined,
          embeds: [embed],
        }),
      }).catch(() => {});
    }
  } catch {}
}
