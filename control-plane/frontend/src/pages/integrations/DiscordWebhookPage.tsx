import { useState, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Plus, Trash2, MoreHorizontal, Pencil, MessageCircle,
  Bold, Italic, Strikethrough, Code, Quote, ChevronDown, Variable, Eye, Palette,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuSub, DropdownMenuSubTrigger,
  DropdownMenuSubContent, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { staggerContainer, staggerItem, pulse } from '@/lib/animations';
import { useCurrentProject } from '@/hooks/useProject';
import { schemaApi } from '@/api/schema.api';
import { api } from '@/api/client';
import { toast } from 'sonner';
import { usePageTitle } from '@/hooks/usePageTitle';

const EVENTS = ['INSERT', 'UPDATE', 'DELETE'] as const;
const DISCORD_BLUE = '#5865F2';
const EVENT_COLORS: Record<string, string> = { INSERT: '#57f287', UPDATE: '#fee75c', DELETE: '#ed4245' };
const COLOR_PRESETS = [
  { label: 'Auto (by event)', value: 'auto' },
  { label: 'Discord Blue', value: '#5865F2' },
  { label: 'Green', value: '#57f287' },
  { label: 'Yellow', value: '#fee75c' },
  { label: 'Red', value: '#ed4245' },
  { label: 'Orange', value: '#e67e22' },
  { label: 'Purple', value: '#9b59b6' },
  { label: 'White', value: '#ffffff' },
];

interface DiscordWebhook {
  id: string;
  name: string | null;
  webhook_url: string;
  table_names: string[];
  events: string[];
  content_template: string | null;
  embed_title: string | null;
  embed_description: string | null;
  embed_color: string | null;
  show_record_fields: boolean;
  is_active: boolean;
  created_at: string;
}

interface ConditionRule {
  field: string;
  operator: string;
  value: string;
}

const OPERATORS = [
  { value: 'equals', label: '=' },
  { value: 'not_equals', label: '≠' },
  { value: 'contains', label: 'содержит' },
  { value: 'gt', label: '>' },
  { value: 'gte', label: '≥' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '≤' },
  { value: 'is_empty', label: 'пустое' },
  { value: 'is_not_empty', label: 'не пустое' },
];

interface FormState {
  name: string;
  webhook_url: string;
  table_names: string[];
  events: string[];
  conditions: ConditionRule[];
  content_template: string;
  embed_title: string;
  embed_description: string;
  embed_color: string;
  show_record_fields: boolean;
}

const emptyForm: FormState = {
  name: '', webhook_url: '', table_names: [], events: [], conditions: [],
  content_template: '', embed_title: '{event} — {table}', embed_description: '',
  embed_color: 'auto', show_record_fields: true,
};

const SAMPLE_RECORD: Record<string, unknown> = {
  id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  nickname: 'Player_One',
  steam_id: '76561198000000000',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  image: 'https://example.com/avatar.jpg',
};

function applyPreview(tpl: string, event: string, table: string): string {
  let r = tpl.replace(/\{event\}/g, event).replace(/\{table\}/g, table);
  r = r.replace(/\{data\.(\w+)\}/g, (_, f) => {
    const v = SAMPLE_RECORD[f];
    return v != null ? String(v) : `{data.${f}}`;
  });
  return r;
}

function discordMdToHtml(md: string): string {
  let h = md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*\*(.+?)\*\*\*/g, '<b><i>$1</i></b>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\*(.+?)\*/g, '<i>$1</i>')
    .replace(/~~(.+?)~~/g, '<s>$1</s>')
    .replace(/`([^`]+)`/g, '<code class="bg-[#2b2d31] px-1 rounded text-xs">$1</code>')
    .replace(/^&gt; (.+)$/gm, '<div class="border-l-2 border-[#4e5058] pl-2 text-[#b5bac1]">$1</div>');
  h = h.replace(/\n/g, '<br/>');
  return h;
}

function FormatToolbar({ textareaRef, field, form, setForm }: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  field: 'content_template' | 'embed_description';
  form: FormState;
  setForm: (f: FormState) => void;
}) {
  const wrap = useCallback((before: string, after: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const text = form[field];
    const selected = text.substring(start, end) || 'text';
    const newText = text.substring(0, start) + before + selected + after + text.substring(end);
    setForm({ ...form, [field]: newText });
    setTimeout(() => { el.focus(); el.setSelectionRange(start + before.length, start + before.length + selected.length); }, 0);
  }, [textareaRef, field, form, setForm]);

  const insert = useCallback((text: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const pos = el.selectionStart;
    const val = form[field];
    setForm({ ...form, [field]: val.substring(0, pos) + text + val.substring(pos) });
    setTimeout(() => { el.focus(); el.setSelectionRange(pos + text.length, pos + text.length); }, 0);
  }, [textareaRef, field, form, setForm]);

  return (
    <div className="flex items-center gap-0.5 border rounded-t-md px-1 py-0.5 bg-muted/30">
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => wrap('**', '**')} title="Bold"><Bold className="h-3.5 w-3.5" /></Button>
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => wrap('*', '*')} title="Italic"><Italic className="h-3.5 w-3.5" /></Button>
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => wrap('~~', '~~')} title="Strikethrough"><Strikethrough className="h-3.5 w-3.5" /></Button>
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => wrap('`', '`')} title="Inline code"><Code className="h-3.5 w-3.5" /></Button>
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => insert('\n> ')} title="Quote"><Quote className="h-3.5 w-3.5" /></Button>
      <div className="w-px h-4 bg-border mx-1" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1"><Variable className="h-3.5 w-3.5" />Variables<ChevronDown className="h-3 w-3" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={() => insert('{event}')}>{'event'} — INSERT / UPDATE / DELETE</DropdownMenuItem>
          <DropdownMenuItem onClick={() => insert('{table}')}>{'table'} — Table name</DropdownMenuItem>
          <DropdownMenuSeparator />
          {Object.keys(SAMPLE_RECORD).map((k) => (
            <DropdownMenuItem key={k} onClick={() => insert(`{data.${k}}`)}>{`data.${k}`}</DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function DiscordPreview({ form }: { form: FormState }) {
  const event = form.events[0] || 'INSERT';
  const table = form.table_names[0] || 'users';
  const colorHex = form.embed_color === 'auto' ? (EVENT_COLORS[event] || '#5865F2') : (form.embed_color || '#5865F2');
  const title = applyPreview(form.embed_title || '{event} — {table}', event, table);
  const desc = form.embed_description ? applyPreview(form.embed_description, event, table) : '';
  const content = form.content_template ? applyPreview(form.content_template, event, table) : '';

  const fields = form.show_record_fields
    ? Object.entries(SAMPLE_RECORD).slice(0, 6).map(([k, v]) => ({ name: k, value: String(v).substring(0, 60) }))
    : [];

  return (
    <div className="bg-[#313338] rounded-lg p-4 text-[#dbdee1] text-sm font-sans min-h-[200px]">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-full bg-[#5865F2] flex items-center justify-center shrink-0">
          <MessageCircle className="h-5 w-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="font-semibold text-white">DataForge</span>
            <span className="text-[10px] text-[#949ba4] bg-[#5865F2] px-1 rounded">BOT</span>
            <span className="text-[10px] text-[#949ba4]">Today at {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          {content && <div className="mt-1" dangerouslySetInnerHTML={{ __html: discordMdToHtml(content) }} />}
          <div className="mt-2 rounded border-l-4 bg-[#2b2d31] overflow-hidden" style={{ borderColor: colorHex }}>
            <div className="p-3 space-y-2">
              {title && <div className="font-semibold text-white" dangerouslySetInnerHTML={{ __html: discordMdToHtml(title) }} />}
              {desc && <div className="text-[13px] text-[#dbdee1]" dangerouslySetInnerHTML={{ __html: discordMdToHtml(desc) }} />}
              {fields.length > 0 && (
                <div className="grid grid-cols-3 gap-1 mt-2">
                  {fields.map((f) => (
                    <div key={f.name}>
                      <div className="text-[11px] font-semibold text-[#b5bac1]">{f.name}</div>
                      <div className="text-xs text-[#dbdee1] truncate">{f.value}</div>
                    </div>
                  ))}
                </div>
              )}
              <div className="text-[10px] text-[#949ba4] mt-2">{new Date().toLocaleString()}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function DiscordWebhookPage() {
  const { t } = useTranslation(['common']);
  usePageTitle('Discord Webhooks');
  const { data: project } = useCurrentProject();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({ ...emptyForm });
  const [dialogTab, setDialogTab] = useState('settings');
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);

  const projectId = project?.id;

  const { data, isLoading } = useQuery({
    queryKey: ['discord-webhooks', projectId],
    queryFn: () => api.get<{ webhooks: DiscordWebhook[] }>(`/projects/${projectId}/discord-webhooks`),
    enabled: !!projectId,
  });

  const { data: tablesData } = useQuery({
    queryKey: ['tables', projectId],
    queryFn: () => schemaApi.listTables(projectId!),
    enabled: !!projectId,
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name || undefined,
        webhook_url: form.webhook_url,
        table_names: form.table_names,
        events: form.events,
        conditions: form.conditions.length > 0 ? form.conditions : [],
        content_template: form.content_template || null,
        embed_title: form.embed_title || null,
        embed_description: form.embed_description || null,
        embed_color: form.embed_color || 'auto',
        show_record_fields: form.show_record_fields,
      };
      return editingId
        ? api.put(`/projects/${projectId}/discord-webhooks/${editingId}`, payload)
        : api.post(`/projects/${projectId}/discord-webhooks`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discord-webhooks', projectId] });
      toast.success(editingId ? 'Webhook updated' : 'Webhook created');
      closeDialog();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api.put(`/projects/${projectId}/discord-webhooks/${id}`, { is_active: active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['discord-webhooks', projectId] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/projects/${projectId}/discord-webhooks/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discord-webhooks', projectId] });
      toast.success('Webhook deleted');
      setDeleteTarget(null);
    },
  });

  const webhooks = data?.webhooks ?? [];
  const tables = tablesData?.tables ?? [];

  function openCreate() {
    setEditingId(null);
    setForm({ ...emptyForm });
    setDialogTab('settings');
    setDialogOpen(true);
  }

  function openEdit(wh: DiscordWebhook) {
    setEditingId(wh.id);
    setForm({
      name: wh.name ?? '',
      webhook_url: wh.webhook_url,
      table_names: wh.table_names ?? [],
      events: wh.events ?? [],
      conditions: (wh as unknown as Record<string, unknown>).conditions as ConditionRule[] ?? [],
      content_template: wh.content_template ?? '',
      embed_title: wh.embed_title ?? '{event} — {table}',
      embed_description: wh.embed_description ?? '',
      embed_color: wh.embed_color ?? 'auto',
      show_record_fields: wh.show_record_fields ?? true,
    });
    setDialogTab('settings');
    setDialogOpen(true);
  }

  function closeDialog() { setDialogOpen(false); setEditingId(null); }

  const isFormValid = form.webhook_url.length > 0 && form.table_names.length > 0 && form.events.length > 0;

  return (
    <PageWrapper>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg flex items-center justify-center" style={{ background: DISCORD_BLUE }}>
            <MessageCircle className="h-4 w-4 text-white" />
          </div>
          <h1 className="text-2xl font-bold">Discord Webhooks</h1>
        </div>
        <Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" />{t('common:actions.create')}</Button>
      </div>

      {isLoading ? (
        <div className="space-y-4">{[1, 2].map((i) => <Skeleton key={i} className="h-28" />)}</div>
      ) : webhooks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <MessageCircle className="h-12 w-12 text-muted-foreground mb-4" />
          <h2 className="text-lg font-medium mb-2">No Discord webhooks yet</h2>
          <p className="text-muted-foreground mb-4">Send notifications to Discord when data changes</p>
          <Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" />{t('common:actions.create')}</Button>
        </div>
      ) : (
        <motion.div variants={staggerContainer} initial="initial" animate="animate" className="space-y-3">
          {webhooks.map((wh) => (
            <motion.div key={wh.id} variants={staggerItem}>
              <Card>
                <CardContent>
                  <div className="flex items-start justify-between">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <motion.div className={`h-2 w-2 rounded-full`} style={{ background: wh.is_active ? DISCORD_BLUE : undefined }} {...(wh.is_active ? pulse : {})} />
                        <span className="font-medium">{wh.name || wh.table_names.join(', ')}</span>
                        {wh.events.map((e) => <Badge key={e} variant="outline" className="text-[10px]">{e}</Badge>)}
                      </div>
                      <p className="text-xs text-muted-foreground truncate max-w-md">{wh.webhook_url}</p>
                      <div className="flex gap-1 flex-wrap">
                        {wh.table_names.map((t) => <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch checked={wh.is_active} onCheckedChange={(v) => toggleMutation.mutate({ id: wh.id, active: v })} />
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(wh)}><Pencil className="h-4 w-4 mr-2" />{t('common:actions.edit')}</DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(wh.id)}><Trash2 className="h-4 w-4 mr-2" />{t('common:actions.delete')}</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      )}

      <Dialog open={dialogOpen} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>{editingId ? t('common:actions.edit') : t('common:actions.create')} Discord Webhook</DialogTitle>
          </DialogHeader>

          <Tabs value={dialogTab} onValueChange={setDialogTab} className="flex-1 flex flex-col min-h-0">
            <TabsList className="shrink-0">
              <TabsTrigger value="settings">Settings</TabsTrigger>
              <TabsTrigger value="message">Message & Embed</TabsTrigger>
              <TabsTrigger value="preview"><Eye className="h-3.5 w-3.5 mr-1" />Preview</TabsTrigger>
            </TabsList>

            <TabsContent value="settings" className="flex-1 overflow-y-auto space-y-4 mt-4">
              <div>
                <Label>Название</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Уведомления о новых игроках" className="mt-1" />
              </div>
              <div>
                <Label>Webhook URL</Label>
                <Input value={form.webhook_url} onChange={(e) => setForm({ ...form, webhook_url: e.target.value })} placeholder="https://discord.com/api/webhooks/..." className="mt-1" />
                <p className="text-xs text-muted-foreground mt-1">Настройки сервера → Интеграции → Вебхуки → Скопировать URL</p>
              </div>
              <div>
                <Label>Таблицы</Label>
                <p className="text-xs text-muted-foreground mb-2">При изменении данных в выбранных таблицах — вебхук отправится в Discord</p>
                <div className="space-y-1 max-h-36 overflow-y-auto border rounded-md p-2">
                  {tables.map((tbl) => (
                    <div key={tbl.name} className="flex items-center gap-2">
                      <Checkbox checked={form.table_names.includes(tbl.name)} onCheckedChange={() => setForm({ ...form, table_names: form.table_names.includes(tbl.name) ? form.table_names.filter((t) => t !== tbl.name) : [...form.table_names, tbl.name] })} />
                      <Label className="font-mono text-sm cursor-pointer">{tbl.name}</Label>
                    </div>
                  ))}
                </div>
                {form.table_names.length > 0 && <div className="flex gap-1 flex-wrap mt-2">{form.table_names.map((t) => <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>)}</div>}
              </div>
              <div>
                <Label>События</Label>
                <div className="flex gap-4 mt-2">
                  {EVENTS.map((e) => (
                    <div key={e} className="flex items-center gap-2">
                      <Checkbox checked={form.events.includes(e)} onCheckedChange={() => setForm({ ...form, events: form.events.includes(e) ? form.events.filter((x) => x !== e) : [...form.events, e] })} />
                      <Label>{e}</Label>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <Label>Условия отправки <span className="text-muted-foreground font-normal">(опционально)</span></Label>
                <p className="text-xs text-muted-foreground mb-2">Webhook сработает только если все условия выполнены. Без условий — отправляется всегда.</p>
                {form.conditions.map((c, i) => (
                  <div key={i} className="flex gap-2 items-center mb-2">
                    <Input value={c.field} onChange={(e) => { const nc = [...form.conditions]; nc[i] = { ...nc[i], field: e.target.value }; setForm({ ...form, conditions: nc }); }} placeholder="Колонка" className="w-32 text-sm font-mono" />
                    <select value={c.operator} onChange={(e) => { const nc = [...form.conditions]; nc[i] = { ...nc[i], operator: e.target.value }; setForm({ ...form, conditions: nc }); }} className="h-9 rounded-md border bg-background px-2 text-sm">
                      {OPERATORS.map((op) => <option key={op.value} value={op.value}>{op.label}</option>)}
                    </select>
                    {!['is_empty', 'is_not_empty'].includes(c.operator) && (
                      <Input value={c.value} onChange={(e) => { const nc = [...form.conditions]; nc[i] = { ...nc[i], value: e.target.value }; setForm({ ...form, conditions: nc }); }} placeholder="Значение" className="flex-1 text-sm" />
                    )}
                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setForm({ ...form, conditions: form.conditions.filter((_, j) => j !== i) })}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={() => setForm({ ...form, conditions: [...form.conditions, { field: '', operator: 'equals', value: '' }] })}>
                  <Plus className="h-3.5 w-3.5 mr-1" />Добавить условие
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="message" className="flex-1 overflow-y-auto space-y-5 mt-4">
              <div>
                <Label className="text-sm font-medium">Текст сообщения</Label>
                <p className="text-xs text-muted-foreground mb-2">Обычный текст над embed-блоком. Поддерживает Discord-разметку и переменные.</p>
                <FormatToolbar textareaRef={contentRef} field="content_template" form={form} setForm={setForm} />
                <Textarea ref={contentRef} value={form.content_template} onChange={(e) => setForm({ ...form, content_template: e.target.value })} placeholder="Пример: Новый **{event}** в таблице `{table}`" className="rounded-t-none border-t-0 text-sm font-mono" rows={3} />
              </div>

              <div className="grid grid-cols-[1fr_auto] gap-4 items-start">
                <div>
                  <Label className="text-sm font-medium">Заголовок embed</Label>
                  <p className="text-xs text-muted-foreground mb-1">Жирный заголовок в embed-блоке</p>
                  <Input value={form.embed_title} onChange={(e) => setForm({ ...form, embed_title: e.target.value })} placeholder="{event} — {table}" className="font-mono text-sm" />
                </div>
                <div>
                  <Label className="text-sm font-medium">Цвет</Label>
                  <p className="text-xs text-muted-foreground mb-1">Полоска слева</p>
                  <div className="flex gap-1.5">
                    {COLOR_PRESETS.slice(0, 5).map((c) => (
                      <button key={c.value} onClick={() => setForm({ ...form, embed_color: c.value })} className={`h-7 w-7 rounded border-2 transition-all ${form.embed_color === c.value ? 'border-white scale-110' : 'border-transparent'}`} style={{ background: c.value === 'auto' ? 'linear-gradient(135deg, #57f287, #fee75c, #ed4245)' : c.value }} title={c.label} />
                    ))}
                    <Input type="color" value={form.embed_color === 'auto' ? '#5865F2' : form.embed_color} onChange={(e) => setForm({ ...form, embed_color: e.target.value })} className="h-7 w-7 p-0 border-0 rounded cursor-pointer" />
                  </div>
                </div>
              </div>

              <div>
                <Label className="text-sm font-medium">Описание embed</Label>
                <p className="text-xs text-muted-foreground mb-2">Основной текст внутри embed. Здесь можно вставить данные записи через переменные.</p>
                <FormatToolbar textareaRef={descRef} field="embed_description" form={form} setForm={setForm} />
                <Textarea ref={descRef} value={form.embed_description} onChange={(e) => setForm({ ...form, embed_description: e.target.value })} placeholder={'Пример:\nИгрок **{data.nickname}** (Steam: `{data.steam_id}`)\nДобавлен в таблицу **{table}**'} className="rounded-t-none border-t-0 text-sm font-mono" rows={4} />
              </div>

              <div className="flex items-center gap-2">
                <Checkbox checked={form.show_record_fields} onCheckedChange={(v) => setForm({ ...form, show_record_fields: !!v })} />
                <div>
                  <Label>Показывать поля записи автоматически</Label>
                  <p className="text-xs text-muted-foreground">Все колонки записи будут показаны как поля embed. Выключите, если используете описание с переменными.</p>
                </div>
              </div>

              <div className="text-xs space-y-2 p-3 bg-muted/30 rounded-md border">
                <p className="font-semibold text-sm">Переменные</p>
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                  <code className="bg-muted px-1.5 py-0.5 rounded font-mono">{'{event}'}</code>
                  <span className="text-muted-foreground">Тип события: INSERT, UPDATE или DELETE</span>
                  <code className="bg-muted px-1.5 py-0.5 rounded font-mono">{'{table}'}</code>
                  <span className="text-muted-foreground">Имя таблицы, напр. <code>users</code></span>
                  <code className="bg-muted px-1.5 py-0.5 rounded font-mono">{'{data.<колонка>}'}</code>
                  <span className="text-muted-foreground">Любая колонка из записи, напр. <code>{'{data.nickname}'}</code>, <code>{'{data.steam_id}'}</code></span>
                </div>
                <p className="font-semibold text-sm mt-3">Discord-разметка</p>
                <div className="flex flex-wrap gap-2">
                  <code className="bg-muted px-1.5 py-0.5 rounded">**жирный**</code>
                  <code className="bg-muted px-1.5 py-0.5 rounded">*курсив*</code>
                  <code className="bg-muted px-1.5 py-0.5 rounded">~~зачёркнутый~~</code>
                  <code className="bg-muted px-1.5 py-0.5 rounded">`код`</code>
                  <code className="bg-muted px-1.5 py-0.5 rounded">{'> цитата'}</code>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="preview" className="flex-1 overflow-y-auto mt-4">
              <p className="text-xs text-muted-foreground mb-3">Preview with sample data. Actual values will be populated at runtime.</p>
              <DiscordPreview form={form} />
            </TabsContent>
          </Tabs>

          <DialogFooter className="shrink-0 mt-4">
            <Button variant="outline" onClick={closeDialog}>{t('common:actions.cancel')}</Button>
            <Button onClick={() => saveMutation.mutate()} disabled={!isFormValid || saveMutation.isPending}>
              {saveMutation.isPending ? '...' : editingId ? t('common:actions.save') : t('common:actions.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete Discord Webhook"
        description="This webhook will stop sending notifications."
        confirmText={t('common:actions.delete')}
        variant="destructive"
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
        loading={deleteMutation.isPending}
      />
    </PageWrapper>
  );
}
