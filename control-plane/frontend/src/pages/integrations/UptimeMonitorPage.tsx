import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Trash2, Activity, ArrowUpRight, ArrowDownRight, Clock, Wifi, WifiOff, Pencil, X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { useCurrentProject } from '@/hooks/useProject';
import { api } from '@/api/client';
import { toast } from 'sonner';
import { usePageTitle } from '@/hooks/usePageTitle';

interface Monitor {
  id: string; name: string | null; category: string | null; url: string; method: string;
  expected_status: number; expected_body: string | null; interval_minutes: number;
  timeout_ms: number; is_active: boolean; retention_days: number;
  last_status: { is_up: boolean; status_code: number; response_time_ms: number; checked_at: string; error: string | null; reason: string | null } | null;
  uptime_24h: number | null; avg_response_time_24h: number | null; checks_24h: number;
}

interface LogEntry {
  id: string; status_code: number; response_time_ms: number; is_up: boolean;
  error: string | null; reason: string | null; checked_at: string;
}

interface FormState {
  name: string; category: string; url: string; method: string; expected_status: string;
  expected_body: string; interval_minutes: string; timeout_ms: string; retention_days: string;
}

const emptyForm: FormState = {
  name: '', category: '', url: '', method: 'GET', expected_status: '200',
  expected_body: '', interval_minutes: '5', timeout_ms: '10000', retention_days: '7',
};

const INTERVALS = [
  { value: '1', label: '1 мин' }, { value: '5', label: '5 мин' },
  { value: '15', label: '15 мин' }, { value: '60', label: '1 час' }, { value: '720', label: '12 часов' },
];

function UptimeBar({ timeline }: { timeline: { is_up: boolean; checked_at: string }[] }) {
  const slots = 48;
  const now = Date.now();
  const slotMs = (24 * 60 * 60 * 1000) / slots;
  const buckets: ('up' | 'down' | 'none')[] = Array(slots).fill('none');

  for (const entry of timeline) {
    const age = now - new Date(entry.checked_at).getTime();
    const idx = slots - 1 - Math.floor(age / slotMs);
    if (idx >= 0 && idx < slots) {
      if (buckets[idx] === 'none') buckets[idx] = entry.is_up ? 'up' : 'down';
      else if (!entry.is_up) buckets[idx] = 'down';
    }
  }

  return (
    <div className="flex gap-[2px] h-8">
      {buckets.map((b, i) => (
        <div key={i} className={`flex-1 rounded-sm ${b === 'up' ? 'bg-green-500' : b === 'down' ? 'bg-red-500' : 'bg-muted'}`} title={b === 'none' ? 'No data' : b === 'up' ? 'UP' : 'DOWN'} />
      ))}
    </div>
  );
}

export function UptimeMonitorPage() {
  const { t } = useTranslation(['common']);
  usePageTitle('Uptime Monitor');
  const { data: project } = useCurrentProject();
  const queryClient = useQueryClient();
  const projectId = project?.id;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({ ...emptyForm });

  const { data, isLoading } = useQuery({
    queryKey: ['uptime-monitors', projectId],
    queryFn: () => api.get<{ monitors: Monitor[] }>(`/projects/${projectId}/uptime-monitors`),
    enabled: !!projectId,
    refetchInterval: 30_000,
  });

  const { data: statsData } = useQuery({
    queryKey: ['uptime-stats', selectedId],
    queryFn: () => api.get<{ stats: Record<string, { total: number; uptime: number; avg_ms: number; min_ms: number; max_ms: number }>; timeline: { is_up: boolean; status_code: number; response_time_ms: number; checked_at: string }[] }>(`/projects/${projectId}/uptime-monitors/${selectedId}/stats`),
    enabled: !!projectId && !!selectedId,
    refetchInterval: 30_000,
  });

  const { data: logsData } = useQuery({
    queryKey: ['uptime-logs', selectedId],
    queryFn: () => api.get<{ logs: LogEntry[] }>(`/projects/${projectId}/uptime-monitors/${selectedId}/logs?limit=50`),
    enabled: !!projectId && !!selectedId,
    refetchInterval: 30_000,
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name || undefined, category: form.category || null, url: form.url, method: form.method,
        expected_status: Number(form.expected_status), expected_body: form.expected_body || null,
        interval_minutes: Number(form.interval_minutes), timeout_ms: Number(form.timeout_ms),
        retention_days: Number(form.retention_days),
      };
      return editingId
        ? api.put(`/projects/${projectId}/uptime-monitors/${editingId}`, payload)
        : api.post(`/projects/${projectId}/uptime-monitors`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['uptime-monitors', projectId] });
      toast.success(editingId ? 'Монитор обновлён' : 'Монитор создан');
      setDialogOpen(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api.put(`/projects/${projectId}/uptime-monitors/${id}`, { is_active: active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['uptime-monitors', projectId] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/projects/${projectId}/uptime-monitors/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['uptime-monitors', projectId] });
      toast.success('Монитор удалён');
      setDeleteTarget(null);
      if (selectedId === deleteTarget) setSelectedId(null);
    },
  });

  const monitors = data?.monitors ?? [];
  const selected = monitors.find((m) => m.id === selectedId);

  function openCreate() { setEditingId(null); setForm({ ...emptyForm }); setDialogOpen(true); }
  function openEdit(m: Monitor) {
    setEditingId(m.id);
    setForm({
      name: m.name ?? '', category: m.category ?? '', url: m.url, method: m.method, expected_status: String(m.expected_status),
      expected_body: m.expected_body ?? '', interval_minutes: String(m.interval_minutes),
      timeout_ms: String(m.timeout_ms), retention_days: String(m.retention_days),
    });
    setDialogOpen(true);
  }

  return (
    <>
    <div className="flex h-[calc(100vh-3.5rem)]">
        {/* Left sidebar */}
        <div className="w-72 border-r flex flex-col shrink-0">
          <div className="p-3 border-b flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              <span className="font-semibold text-sm">Мониторинг</span>
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={openCreate}><Plus className="h-4 w-4" /></Button>
          </div>
          <ScrollArea className="flex-1">
            {isLoading ? (
              <div className="p-3 space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}</div>
            ) : monitors.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                <p>Нет мониторов</p>
                <Button variant="link" size="sm" onClick={openCreate} className="mt-1"><Plus className="h-3 w-3 mr-1" />Создать</Button>
              </div>
            ) : (() => {
              const groups: Record<string, Monitor[]> = {};
              for (const m of monitors) {
                const cat = m.category || 'Без категории';
                if (!groups[cat]) groups[cat] = [];
                groups[cat].push(m);
              }
              const cats = Object.keys(groups).sort((a, b) => a === 'Без категории' ? 1 : b === 'Без категории' ? -1 : a.localeCompare(b));
              return (
                <div className="p-1">
                  {cats.map((cat) => (
                    <div key={cat}>
                      {cats.length > 1 && (
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-3 pt-3 pb-1">{cat}</p>
                      )}
                      {groups[cat].map((m) => (
                        <button key={m.id} onClick={() => setSelectedId(m.id)}
                          className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${selectedId === m.id ? 'bg-accent' : 'hover:bg-muted'}`}>
                          <div className="flex items-center gap-2">
                            <div className={`h-2 w-2 rounded-full shrink-0 ${m.last_status?.is_up ? 'bg-green-500' : m.last_status ? 'bg-red-500' : 'bg-muted-foreground'}`} />
                            <span className="font-medium truncate text-xs">{m.name || m.url}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 ml-4">
                            <span className="text-[10px] text-muted-foreground truncate">{m.url}</span>
                          </div>
                          {m.uptime_24h != null && (
                            <div className="flex items-center gap-3 mt-0.5 ml-4">
                              <span className={`text-[10px] font-mono ${m.uptime_24h >= 99 ? 'text-green-500' : m.uptime_24h >= 95 ? 'text-yellow-500' : 'text-red-500'}`}>{m.uptime_24h}%</span>
                              {m.avg_response_time_24h != null && <span className="text-[10px] text-muted-foreground">{m.avg_response_time_24h}ms</span>}
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              );
            })()}
          </ScrollArea>
        </div>

        {/* Main content */}
        <div className="flex-1 overflow-y-auto">
          {!selected ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <div className="text-center">
                <Activity className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm">Выберите монитор или создайте новый</p>
              </div>
            </div>
          ) : (
            <div className="p-6 space-y-6">
              {/* Header */}
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-3">
                    {selected.last_status?.is_up ? (
                      <Badge className="bg-green-500/10 text-green-500 border-green-500/30"><Wifi className="h-3 w-3 mr-1" />UP</Badge>
                    ) : selected.last_status ? (
                      <Badge variant="destructive"><WifiOff className="h-3 w-3 mr-1" />DOWN</Badge>
                    ) : (
                      <Badge variant="secondary">Ожидание</Badge>
                    )}
                    <h2 className="text-xl font-bold">{selected.name || selected.url}</h2>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{selected.url}</p>
                  {selected.last_status && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Последняя проверка: {new Date(selected.last_status.checked_at).toLocaleString()} • {selected.last_status.response_time_ms}ms
                      {selected.last_status.reason && ` • ${selected.last_status.reason}`}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => openEdit(selected)}><Pencil className="h-3.5 w-3.5 mr-1" />{t('common:actions.edit')}</Button>
                  <Button variant="outline" size="sm" onClick={() => toggleMutation.mutate({ id: selected.id, active: !selected.is_active })}>
                    {selected.is_active ? 'Пауза' : 'Запустить'}
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleteTarget(selected.id)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>

              {/* Stats cards */}
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: 'Uptime 24h', value: selected.uptime_24h != null ? `${selected.uptime_24h}%` : '—', color: (selected.uptime_24h ?? 100) >= 99 ? 'text-green-500' : 'text-red-500' },
                  { label: 'Uptime 7d', value: statsData?.stats?.['7d']?.uptime != null ? `${statsData.stats['7d'].uptime}%` : '—', color: (statsData?.stats?.['7d']?.uptime ?? 100) >= 99 ? 'text-green-500' : 'text-red-500' },
                  { label: 'Avg Response', value: selected.avg_response_time_24h != null ? `${selected.avg_response_time_24h}ms` : '—', color: '' },
                  { label: 'Checks 24h', value: String(selected.checks_24h), color: '' },
                ].map((s) => (
                  <Card key={s.label}>
                    <CardContent>
                      <p className="text-xs text-muted-foreground">{s.label}</p>
                      <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Uptime bar */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium">Uptime (24h)</p>
                  <p className="text-[10px] text-muted-foreground">24 часа назад → сейчас</p>
                </div>
                <UptimeBar timeline={statsData?.timeline ?? []} />
              </div>

              {/* Config info */}
              <div className="flex gap-4 text-xs text-muted-foreground">
                <span>Метод: <code className="bg-muted px-1 rounded">{selected.method}</code></span>
                <span>Интервал: {INTERVALS.find((i) => i.value === String(selected.interval_minutes))?.label ?? `${selected.interval_minutes} мин`}</span>
                <span>Ожидаемый код: <code className="bg-muted px-1 rounded">{selected.expected_status}</code></span>
                <span>Timeout: {selected.timeout_ms}ms</span>
                <span>Хранение: {selected.retention_days}д</span>
              </div>

              {/* Logs table */}
              <div>
                <p className="text-sm font-medium mb-2">Последние проверки</p>
                <div className="border rounded-md overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">Статус</TableHead>
                        <TableHead>Код</TableHead>
                        <TableHead>Время ответа</TableHead>
                        <TableHead>Причина</TableHead>
                        <TableHead>Время</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(logsData?.logs ?? []).slice(0, 20).map((log) => (
                        <TableRow key={log.id}>
                          <TableCell>
                            {log.is_up ? <ArrowUpRight className="h-4 w-4 text-green-500" /> : <ArrowDownRight className="h-4 w-4 text-red-500" />}
                          </TableCell>
                          <TableCell>
                            <Badge variant={log.is_up ? 'default' : 'destructive'} className="text-[10px]">{log.status_code || '—'}</Badge>
                          </TableCell>
                          <TableCell className="font-mono text-xs">{log.response_time_ms}ms</TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-[300px] truncate">{log.reason || log.error || 'OK'}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{new Date(log.checked_at).toLocaleString()}</TableCell>
                        </TableRow>
                      ))}
                      {(logsData?.logs ?? []).length === 0 && (
                        <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Ещё нет проверок</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Create/Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => !o && setDialogOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editingId ? 'Редактировать' : 'Создать'} монитор</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Название</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Мой сервер" className="mt-1" />
              </div>
              <div>
                <Label>Категория <span className="text-muted-foreground font-normal">(опц.)</span></Label>
                <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Production, Staging..." className="mt-1" />
              </div>
            </div>
            <div>
              <Label>URL</Label>
              <Input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://example.com/health" className="mt-1 font-mono text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Метод</Label>
                <Select value={form.method} onValueChange={(v) => setForm({ ...form, method: v })}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="GET">GET</SelectItem>
                    <SelectItem value="POST">POST</SelectItem>
                    <SelectItem value="HEAD">HEAD</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Ожидаемый HTTP код</Label>
                <Input value={form.expected_status} onChange={(e) => setForm({ ...form, expected_status: e.target.value })} placeholder="200" className="mt-1" />
              </div>
            </div>
            <div>
              <Label>Ожидаемое содержимое ответа <span className="text-muted-foreground font-normal">(опционально)</span></Label>
              <Input value={form.expected_body} onChange={(e) => setForm({ ...form, expected_body: e.target.value })} placeholder='Подстрока, напр. "status":"ok"' className="mt-1 font-mono text-sm" />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>Интервал</Label>
                <Select value={form.interval_minutes} onValueChange={(v) => setForm({ ...form, interval_minutes: v })}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {INTERVALS.map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Timeout</Label>
                <Select value={form.timeout_ms} onValueChange={(v) => setForm({ ...form, timeout_ms: v })}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5000">5 сек</SelectItem>
                    <SelectItem value="10000">10 сек</SelectItem>
                    <SelectItem value="30000">30 сек</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Хранение логов</Label>
                <Select value={form.retention_days} onValueChange={(v) => setForm({ ...form, retention_days: v })}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 5, 7].map((d) => <SelectItem key={d} value={String(d)}>{d} {d === 1 ? 'день' : d < 5 ? 'дня' : 'дней'}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t('common:actions.cancel')}</Button>
            <Button onClick={() => saveMutation.mutate()} disabled={!form.url || saveMutation.isPending}>
              {saveMutation.isPending ? '...' : editingId ? t('common:actions.save') : t('common:actions.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Удалить монитор"
        description="Все логи этого монитора будут удалены."
        confirmText={t('common:actions.delete')}
        variant="destructive"
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
        loading={deleteMutation.isPending}
      />
    </>
  );
}
