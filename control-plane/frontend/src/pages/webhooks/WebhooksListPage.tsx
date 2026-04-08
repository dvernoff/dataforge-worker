import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Plus, Webhook, Trash2, Eye, MoreHorizontal, Pencil } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { staggerContainer, staggerItem, pulse } from '@/lib/animations';
import { useCurrentProject } from '@/hooks/useProject';
import { webhooksApi } from '@/api/webhooks.api';
import { schemaApi } from '@/api/schema.api';
import { toast } from 'sonner';
import { usePageTitle } from '@/hooks/usePageTitle';

const EVENTS = ['INSERT', 'UPDATE', 'DELETE'] as const;

interface WebhookForm {
  name: string;
  table_names: string[];
  events: string[];
  url: string;
  secret: string;
}

const emptyForm: WebhookForm = { name: '', table_names: [], events: [], url: '', secret: '' };

export function WebhooksListPage() {
  const { t } = useTranslation(['webhooks', 'common']);
  usePageTitle(t('webhooks:pageTitle'));
  const { data: project } = useCurrentProject();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [logsWebhookId, setLogsWebhookId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [form, setForm] = useState<WebhookForm>({ ...emptyForm });

  const { data, isLoading } = useQuery({
    queryKey: ['webhooks', project?.id],
    queryFn: () => webhooksApi.list(project!.id),
    enabled: !!project?.id,
  });

  const { data: tablesData } = useQuery({
    queryKey: ['tables', project?.id],
    queryFn: () => schemaApi.listTables(project!.id),
    enabled: !!project?.id,
  });

  const { data: logsData } = useQuery({
    queryKey: ['webhook-logs', logsWebhookId],
    queryFn: () => webhooksApi.getLogs(project!.id, logsWebhookId!),
    enabled: !!logsWebhookId && !!project?.id,
  });

  const createMutation = useMutation({
    mutationFn: () => webhooksApi.create(project!.id, {
      name: form.name || undefined,
      table_names: form.table_names,
      events: form.events,
      url: form.url,
      secret: form.secret || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks', project?.id] });
      toast.success(t('webhooks:webhookCreated'));
      closeDialog();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: () => webhooksApi.update(project!.id, editingId!, {
      name: form.name || undefined,
      table_names: form.table_names,
      events: form.events,
      url: form.url,
      secret: form.secret || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks', project?.id] });
      toast.success(t('webhooks:webhookUpdated'));
      closeDialog();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      webhooksApi.update(project!.id, id, { is_active: active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['webhooks', project?.id] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => webhooksApi.delete(project!.id, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks', project?.id] });
      toast.success(t('webhooks:webhookDeleted'));
      setDeleteTarget(null);
    },
  });

  const webhooks = (data?.webhooks ?? []) as (Record<string, unknown> & { stats: { total: number; success_count: number; last_triggered: string | null } })[];
  const tables = tablesData?.tables ?? [];

  function openCreate() {
    setEditingId(null);
    setForm({ ...emptyForm });
    setDialogOpen(true);
  }

  function openEdit(wh: Record<string, unknown>) {
    setEditingId(String(wh.id));
    setForm({
      name: String(wh.name ?? ''),
      table_names: (wh.table_names as string[]) ?? (wh.table_name ? [String(wh.table_name)] : []),
      events: (wh.events as string[]) ?? [],
      url: String(wh.url ?? ''),
      secret: String(wh.secret ?? ''),
    });
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditingId(null);
    setForm({ ...emptyForm });
  }

  function toggleEvent(event: string) {
    setForm((prev) => ({
      ...prev,
      events: prev.events.includes(event)
        ? prev.events.filter((e) => e !== event)
        : [...prev.events, event],
    }));
  }

  function toggleTable(tableName: string) {
    setForm((prev) => ({
      ...prev,
      table_names: prev.table_names.includes(tableName)
        ? prev.table_names.filter((t) => t !== tableName)
        : [...prev.table_names, tableName],
    }));
  }

  function handleSave() {
    if (editingId) {
      updateMutation.mutate();
    } else {
      createMutation.mutate();
    }
  }

  const isFormValid = form.table_names.length > 0 && form.events.length > 0 && form.url.length > 0;
  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <PageWrapper>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('webhooks:pageTitle')}</h1>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" />
          {t('webhooks:createWebhook')}
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-4">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-32" />)}</div>
      ) : webhooks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Webhook className="h-12 w-12 text-muted-foreground mb-4" />
          <h2 className="text-lg font-medium mb-2">{t('webhooks:noWebhooks')}</h2>
          <p className="text-muted-foreground mb-4">{t('webhooks:noWebhooksDesc')}</p>
          <Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" />{t('webhooks:createWebhook')}</Button>
        </div>
      ) : (
        <motion.div variants={staggerContainer} initial="initial" animate="animate" className="space-y-4">
          {webhooks.map((wh) => (
            <motion.div key={String(wh.id)} variants={staggerItem}>
              <Card>
                <CardContent>
                  <div className="flex items-start justify-between">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <motion.div
                          className={`h-2 w-2 rounded-full ${wh.is_active ? 'bg-green-500' : 'bg-muted-foreground'}`}
                          {...(wh.is_active ? pulse : {})}
                        />
                        <span className="font-medium">{wh.name ? String(wh.name) : ((wh.table_names as string[]) ?? []).join(', ') || String(wh.table_name ?? '')}</span>
                        <div className="flex gap-1">
                          {(wh.events as string[]).map((e) => (
                            <Badge key={e} variant="outline" className="text-[10px]">{e}</Badge>
                          ))}
                        </div>
                      </div>
                      <p className="text-sm text-muted-foreground truncate max-w-md">{String(wh.url)}</p>
                      <div className="flex gap-2 flex-wrap">
                        {((wh.table_names as string[]) ?? (wh.table_name ? [String(wh.table_name)] : [])).map((t) => (
                          <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>
                        ))}
                      </div>
                      <div className="flex gap-4 text-xs text-muted-foreground">
                        {wh.stats.total > 0 && (
                          <span>
                            {t('webhooks:stats.successRate', {
                              rate: Math.round((wh.stats.success_count / wh.stats.total) * 100),
                              success: wh.stats.success_count,
                              total: wh.stats.total,
                            })}
                          </span>
                        )}
                        {wh.stats.last_triggered && (
                          <span>{t('webhooks:stats.lastTriggered', { date: new Date(wh.stats.last_triggered).toLocaleString() })}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={!!wh.is_active}
                        onCheckedChange={(v) => toggleMutation.mutate({ id: String(wh.id), active: v })}
                      />
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(wh)}>
                            <Pencil className="h-4 w-4 mr-2" />{t('webhooks:editWebhook')}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setLogsWebhookId(String(wh.id))}>
                            <Eye className="h-4 w-4 mr-2" />{t('webhooks:viewLogs')}
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(String(wh.id))}>
                            <Trash2 className="h-4 w-4 mr-2" />{t('common:actions.delete')}
                          </DropdownMenuItem>
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
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? t('webhooks:editWebhook') : t('webhooks:createWebhook')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 max-h-[60vh] overflow-y-auto">
            <div>
              <Label>{t('webhooks:form.name')}</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t('webhooks:form.namePlaceholder')} className="mt-1" />
            </div>
            <div>
              <Label>{t('webhooks:form.tables')}</Label>
              <div className="mt-2 space-y-1 max-h-40 overflow-y-auto border rounded-md p-2">
                {tables.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('webhooks:form.noTables')}</p>
                ) : (
                  tables.map((tbl) => (
                    <div key={tbl.name} className="flex items-center gap-2">
                      <Checkbox
                        checked={form.table_names.includes(tbl.name)}
                        onCheckedChange={() => toggleTable(tbl.name)}
                      />
                      <Label className="font-mono text-sm cursor-pointer" onClick={() => toggleTable(tbl.name)}>{tbl.name}</Label>
                    </div>
                  ))
                )}
              </div>
              {form.table_names.length > 0 && (
                <div className="flex gap-1 flex-wrap mt-2">
                  {form.table_names.map((t) => (
                    <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>
                  ))}
                </div>
              )}
            </div>
            <div>
              <Label>{t('webhooks:form.events')}</Label>
              <div className="flex gap-4 mt-2">
                {EVENTS.map((e) => (
                  <div key={e} className="flex items-center gap-2">
                    <Checkbox checked={form.events.includes(e)} onCheckedChange={() => toggleEvent(e)} />
                    <Label>{e}</Label>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <Label>{t('webhooks:form.url')}</Label>
              <Input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder={t('webhooks:form.urlPlaceholder')} className="mt-1" />
            </div>
            <div>
              <Label>{t('webhooks:form.secret')}</Label>
              <Input value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} placeholder={t('webhooks:form.secretPlaceholder')} className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>{t('common:actions.cancel')}</Button>
            <Button onClick={handleSave} disabled={!isFormValid || isSaving}>
              {isSaving ? t('webhooks:creating') : editingId ? t('common:actions.save') : t('common:actions.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={!!logsWebhookId} onOpenChange={(o) => !o && setLogsWebhookId(null)}>
        <SheetContent className="w-full sm:max-w-lg">
          <SheetHeader><SheetTitle>{t('webhooks:logs.title')}</SheetTitle></SheetHeader>
          <div className="mt-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('webhooks:logs.time')}</TableHead>
                  <TableHead>{t('webhooks:logs.event')}</TableHead>
                  <TableHead>{t('webhooks:logs.status')}</TableHead>
                  <TableHead>{t('webhooks:logs.duration')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(logsData?.logs ?? []).map((log: Record<string, unknown>) => (
                  <TableRow key={String(log.id)}>
                    <TableCell className="text-xs">{new Date(String(log.sent_at)).toLocaleString()}</TableCell>
                    <TableCell><Badge variant="outline">{String(log.event)}</Badge></TableCell>
                    <TableCell>
                      <Badge variant={Number(log.response_status) >= 200 && Number(log.response_status) < 300 ? 'default' : 'destructive'}>
                        {String(log.response_status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">{String(log.duration_ms)}ms</TableCell>
                  </TableRow>
                ))}
                {(logsData?.logs ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-8">{t('webhooks:logs.noLogs')}</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={t('webhooks:deleteConfirm.title')}
        description={t('webhooks:deleteConfirm.desc')}
        confirmText={t('common:actions.delete')}
        variant="destructive"
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
        loading={deleteMutation.isPending}
      />
    </PageWrapper>
  );
}
