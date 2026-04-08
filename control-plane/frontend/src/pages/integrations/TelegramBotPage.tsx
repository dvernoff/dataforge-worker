import { useState, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Plus, Trash2, MoreHorizontal, Pencil, Send,
  Bold, Italic, Strikethrough, Code, ChevronDown, Variable, Eye, Zap,
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
  DropdownMenuTrigger, DropdownMenuSeparator,
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
const TG_BLUE = '#0088cc';

interface TelegramNotification {
  id: string;
  name: string | null;
  bot_token: string;
  chat_id: string;
  table_names: string[];
  events: string[];
  message_template: string | null;
  parse_mode: string;
  show_record_fields: boolean;
  disable_preview: boolean;
  is_active: boolean;
}

interface ConditionRule { field: string; operator: string; value: string; }

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
  bot_token: string;
  chat_id: string;
  table_names: string[];
  events: string[];
  conditions: ConditionRule[];
  message_template: string;
  show_record_fields: boolean;
  disable_preview: boolean;
}

const emptyForm: FormState = {
  name: '', bot_token: '', chat_id: '', table_names: [], events: [], conditions: [],
  message_template: '', show_record_fields: true, disable_preview: true,
};

const SAMPLE: Record<string, unknown> = {
  id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  nickname: 'Player_One',
  steam_id: '76561198000000000',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  image: 'https://example.com/avatar.jpg',
};

function applyPreview(tpl: string): string {
  let r = tpl.replace(/\{event\}/g, 'INSERT').replace(/\{table\}/g, 'users');
  r = r.replace(/\{data\.(\w+)\}/g, (_, f) => SAMPLE[f] != null ? String(SAMPLE[f]) : `{data.${f}}`);
  return r;
}

function tgHtmlToHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/&lt;b&gt;(.+?)&lt;\/b&gt;/g, '<b>$1</b>')
    .replace(/&lt;i&gt;(.+?)&lt;\/i&gt;/g, '<i>$1</i>')
    .replace(/&lt;s&gt;(.+?)&lt;\/s&gt;/g, '<s>$1</s>')
    .replace(/&lt;code&gt;(.+?)&lt;\/code&gt;/g, '<code class="bg-[#1e1e1e] px-1 rounded text-xs text-[#e0e0e0]">$1</code>')
    .replace(/&lt;u&gt;(.+?)&lt;\/u&gt;/g, '<u>$1</u>')
    .replace(/\n/g, '<br/>');
}

function FormatToolbar({ textareaRef, form, setForm }: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  form: FormState;
  setForm: (f: FormState) => void;
}) {
  const field = 'message_template' as const;
  const wrap = useCallback((before: string, after: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const text = form[field];
    const selected = text.substring(start, end) || 'text';
    const n = text.substring(0, start) + before + selected + after + text.substring(end);
    setForm({ ...form, [field]: n });
    setTimeout(() => { el.focus(); el.setSelectionRange(start + before.length, start + before.length + selected.length); }, 0);
  }, [textareaRef, form, setForm]);

  const insert = useCallback((text: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const pos = el.selectionStart;
    const val = form[field];
    setForm({ ...form, [field]: val.substring(0, pos) + text + val.substring(pos) });
    setTimeout(() => { el.focus(); el.setSelectionRange(pos + text.length, pos + text.length); }, 0);
  }, [textareaRef, form, setForm]);

  return (
    <div className="flex items-center gap-0.5 border rounded-t-md px-1 py-0.5 bg-muted/30">
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => wrap('<b>', '</b>')} title="Bold"><Bold className="h-3.5 w-3.5" /></Button>
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => wrap('<i>', '</i>')} title="Italic"><Italic className="h-3.5 w-3.5" /></Button>
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => wrap('<s>', '</s>')} title="Strikethrough"><Strikethrough className="h-3.5 w-3.5" /></Button>
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => wrap('<code>', '</code>')} title="Code"><Code className="h-3.5 w-3.5" /></Button>
      <div className="w-px h-4 bg-border mx-1" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1"><Variable className="h-3.5 w-3.5" />Переменные<ChevronDown className="h-3 w-3" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={() => insert('{event}')}>{'event'} — INSERT / UPDATE / DELETE</DropdownMenuItem>
          <DropdownMenuItem onClick={() => insert('{table}')}>{'table'} — Имя таблицы</DropdownMenuItem>
          <DropdownMenuSeparator />
          {Object.keys(SAMPLE).map((k) => (
            <DropdownMenuItem key={k} onClick={() => insert(`{data.${k}}`)}>{`data.${k}`}</DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function TelegramPreview({ form }: { form: FormState }) {
  let text: string;
  if (form.message_template) {
    text = applyPreview(form.message_template);
  } else {
    text = '🟢 <b>INSERT</b> — <code>users</code>\n';
    if (form.show_record_fields) {
      for (const [k, v] of Object.entries(SAMPLE)) {
        text += `\n<b>${k}:</b> <code>${v}</code>`;
      }
    }
  }

  return (
    <div className="bg-[#17212b] rounded-lg p-4 text-[#f5f5f5] text-sm font-sans min-h-[200px]">
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-full flex items-center justify-center shrink-0" style={{ background: TG_BLUE }}>
          <Send className="h-4 w-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 mb-1">
            <span className="font-semibold text-[#6ab3f3]">DataForge Bot</span>
            <span className="text-[10px] text-[#6d7f8e]">{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          <div className="text-[13px] leading-5 text-[#f5f5f5]" dangerouslySetInnerHTML={{ __html: tgHtmlToHtml(text) }} />
        </div>
      </div>
    </div>
  );
}

export function TelegramBotPage() {
  const { t } = useTranslation(['common']);
  usePageTitle('Telegram Bot');
  const { data: project } = useCurrentProject();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({ ...emptyForm });
  const [dialogTab, setDialogTab] = useState('settings');
  const msgRef = useRef<HTMLTextAreaElement>(null);

  const projectId = project?.id;

  const { data, isLoading } = useQuery({
    queryKey: ['telegram-notifications', projectId],
    queryFn: () => api.get<{ notifications: TelegramNotification[] }>(`/projects/${projectId}/telegram-notifications`),
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
        bot_token: form.bot_token,
        chat_id: form.chat_id,
        table_names: form.table_names,
        events: form.events,
        conditions: form.conditions.length > 0 ? form.conditions : [],
        message_template: form.message_template || null,
        show_record_fields: form.show_record_fields,
        disable_preview: form.disable_preview,
      };
      return editingId
        ? api.put(`/projects/${projectId}/telegram-notifications/${editingId}`, payload)
        : api.post(`/projects/${projectId}/telegram-notifications`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['telegram-notifications', projectId] });
      toast.success(editingId ? 'Уведомление обновлено' : 'Уведомление создано');
      closeDialog();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api.put(`/projects/${projectId}/telegram-notifications/${id}`, { is_active: active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['telegram-notifications', projectId] }),
  });

  const testMutation = useMutation({
    mutationFn: (id: string) => api.get<{ ok?: boolean; error?: string }>(`/projects/${projectId}/telegram-notifications?test=${id}`),
    onSuccess: (data) => {
      if (data?.ok) toast.success('Тестовое сообщение отправлено!');
      else toast.error(String((data as Record<string, unknown>)?.error ?? 'Ошибка'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/projects/${projectId}/telegram-notifications/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['telegram-notifications', projectId] });
      toast.success('Уведомление удалено');
      setDeleteTarget(null);
    },
  });

  const notifications = data?.notifications ?? [];
  const tables = tablesData?.tables ?? [];

  function openCreate() { setEditingId(null); setForm({ ...emptyForm }); setDialogTab('settings'); setDialogOpen(true); }
  function openEdit(n: TelegramNotification) {
    setEditingId(n.id);
    setForm({
      name: n.name ?? '', bot_token: n.bot_token, chat_id: n.chat_id,
      table_names: n.table_names ?? [], events: n.events ?? [],
      conditions: (n as unknown as Record<string, unknown>).conditions as ConditionRule[] ?? [],
      message_template: n.message_template ?? '',
      show_record_fields: n.show_record_fields ?? true,
      disable_preview: n.disable_preview ?? true,
    });
    setDialogTab('settings'); setDialogOpen(true);
  }
  function closeDialog() { setDialogOpen(false); setEditingId(null); }

  const isFormValid = form.bot_token.length > 0 && form.chat_id.length > 0 && form.table_names.length > 0 && form.events.length > 0;

  return (
    <PageWrapper>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg flex items-center justify-center" style={{ background: TG_BLUE }}>
            <Send className="h-4 w-4 text-white" />
          </div>
          <h1 className="text-2xl font-bold">Telegram Bot</h1>
        </div>
        <Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" />{t('common:actions.create')}</Button>
      </div>

      {isLoading ? (
        <div className="space-y-4">{[1, 2].map((i) => <Skeleton key={i} className="h-28" />)}</div>
      ) : notifications.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Send className="h-12 w-12 text-muted-foreground mb-4" />
          <h2 className="text-lg font-medium mb-2">Нет Telegram-уведомлений</h2>
          <p className="text-muted-foreground mb-4">Отправляйте уведомления в Telegram при изменении данных</p>
          <Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" />{t('common:actions.create')}</Button>
        </div>
      ) : (
        <motion.div variants={staggerContainer} initial="initial" animate="animate" className="space-y-3">
          {notifications.map((n) => (
            <motion.div key={n.id} variants={staggerItem}>
              <Card>
                <CardContent>
                  <div className="flex items-start justify-between">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <motion.div className="h-2 w-2 rounded-full" style={{ background: n.is_active ? TG_BLUE : undefined }} {...(n.is_active ? pulse : {})} />
                        <span className="font-medium">{n.name || n.table_names.join(', ')}</span>
                        {n.events.map((e) => <Badge key={e} variant="outline" className="text-[10px]">{e}</Badge>)}
                      </div>
                      <p className="text-xs text-muted-foreground">Chat: <code className="bg-muted px-1 rounded">{n.chat_id}</code></p>
                      <div className="flex gap-1 flex-wrap">
                        {n.table_names.map((t) => <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch checked={n.is_active} onCheckedChange={(v) => toggleMutation.mutate({ id: n.id, active: v })} />
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(n)}><Pencil className="h-4 w-4 mr-2" />{t('common:actions.edit')}</DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(n.id)}><Trash2 className="h-4 w-4 mr-2" />{t('common:actions.delete')}</DropdownMenuItem>
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
            <DialogTitle>{editingId ? t('common:actions.edit') : t('common:actions.create')} Telegram-уведомление</DialogTitle>
          </DialogHeader>

          <Tabs value={dialogTab} onValueChange={setDialogTab} className="flex-1 flex flex-col min-h-0">
            <TabsList className="shrink-0">
              <TabsTrigger value="settings">Настройки</TabsTrigger>
              <TabsTrigger value="message">Сообщение</TabsTrigger>
              <TabsTrigger value="preview"><Eye className="h-3.5 w-3.5 mr-1" />Превью</TabsTrigger>
            </TabsList>

            <TabsContent value="settings" className="flex-1 overflow-y-auto space-y-4 mt-4">
              <div>
                <Label>Название</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Уведомления о новых игроках" className="mt-1" />
              </div>
              <div>
                <Label>Bot Token</Label>
                <Input value={form.bot_token} onChange={(e) => setForm({ ...form, bot_token: e.target.value })} placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11" className="mt-1 font-mono text-sm" type="password" />
                <p className="text-xs text-muted-foreground mt-1">Получите у @BotFather в Telegram</p>
              </div>
              <div>
                <Label>Chat ID</Label>
                <Input value={form.chat_id} onChange={(e) => setForm({ ...form, chat_id: e.target.value })} placeholder="-1001234567890" className="mt-1 font-mono text-sm" />
                <p className="text-xs text-muted-foreground mt-1">ID чата, канала или группы. Для получения используйте @userinfobot</p>
              </div>
              <div>
                <Label>Таблицы</Label>
                <p className="text-xs text-muted-foreground mb-2">При изменении данных в выбранных таблицах — бот отправит сообщение</p>
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
                <p className="text-xs text-muted-foreground mb-2">Сообщение отправится только если все условия выполнены. Без условий — отправляется всегда.</p>
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
                <Label className="text-sm font-medium">Шаблон сообщения</Label>
                <p className="text-xs text-muted-foreground mb-2">Если пустой — будет автоматический формат с emoji и полями. Поддерживает HTML-разметку Telegram.</p>
                <FormatToolbar textareaRef={msgRef} form={form} setForm={setForm} />
                <Textarea ref={msgRef} value={form.message_template} onChange={(e) => setForm({ ...form, message_template: e.target.value })} placeholder={'Пример:\n🟢 <b>{event}</b> в таблице <code>{table}</code>\nИгрок: <b>{data.nickname}</b> (Steam: <code>{data.steam_id}</code>)'} className="rounded-t-none border-t-0 text-sm font-mono" rows={6} />
              </div>

              <div className="flex items-center gap-2">
                <Checkbox checked={form.show_record_fields} onCheckedChange={(v) => setForm({ ...form, show_record_fields: !!v })} />
                <div>
                  <Label>Показывать поля записи автоматически</Label>
                  <p className="text-xs text-muted-foreground">Работает только если шаблон пустой. Все колонки будут добавлены в сообщение.</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Checkbox checked={form.disable_preview} onCheckedChange={(v) => setForm({ ...form, disable_preview: !!v })} />
                <Label>Отключить превью ссылок</Label>
              </div>

              <div className="text-xs space-y-2 p-3 bg-muted/30 rounded-md border">
                <p className="font-semibold text-sm">Переменные</p>
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                  <code className="bg-muted px-1.5 py-0.5 rounded font-mono">{'{event}'}</code>
                  <span className="text-muted-foreground">Тип события: INSERT, UPDATE или DELETE</span>
                  <code className="bg-muted px-1.5 py-0.5 rounded font-mono">{'{table}'}</code>
                  <span className="text-muted-foreground">Имя таблицы</span>
                  <code className="bg-muted px-1.5 py-0.5 rounded font-mono">{'{data.<колонка>}'}</code>
                  <span className="text-muted-foreground">Любая колонка, напр. <code>{'{data.nickname}'}</code>, <code>{'{data.steam_id}'}</code></span>
                </div>
                <p className="font-semibold text-sm mt-3">HTML-разметка Telegram</p>
                <div className="flex flex-wrap gap-2">
                  <code className="bg-muted px-1.5 py-0.5 rounded">{'<b>жирный</b>'}</code>
                  <code className="bg-muted px-1.5 py-0.5 rounded">{'<i>курсив</i>'}</code>
                  <code className="bg-muted px-1.5 py-0.5 rounded">{'<s>зачёркнутый</s>'}</code>
                  <code className="bg-muted px-1.5 py-0.5 rounded">{'<code>код</code>'}</code>
                  <code className="bg-muted px-1.5 py-0.5 rounded">{'<u>подчёркнутый</u>'}</code>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="preview" className="flex-1 overflow-y-auto mt-4">
              <p className="text-xs text-muted-foreground mb-3">Превью с примерными данными. Реальные значения подставятся при отправке.</p>
              <TelegramPreview form={form} />
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
        title="Удалить Telegram-уведомление"
        description="Уведомление перестанет отправляться."
        confirmText={t('common:actions.delete')}
        variant="destructive"
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
        loading={deleteMutation.isPending}
      />
    </PageWrapper>
  );
}
