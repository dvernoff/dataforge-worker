import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Plus, Webhook, Trash2, Eye, MoreHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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

export function WebhooksListPage() {
  const { t } = useTranslation(['webhooks', 'common']);
  usePageTitle(t('webhooks:pageTitle'));
  const { data: project } = useCurrentProject();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [logsWebhookId, setLogsWebhookId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const [newWh, setNewWh] = useState({
    name: '', table_name: '', events: [] as string[], url: '', secret: '',
  });

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
      name: newWh.name || undefined,
      table_name: newWh.table_name,
      events: newWh.events,
      url: newWh.url,
      secret: newWh.secret || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks', project?.id] });
      toast.success(t('webhooks:webhookCreated'));
      setCreateOpen(false);
      setNewWh({ name: '', table_name: '', events: [], url: '', secret: '' });
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

  function toggleEvent(event: string) {
    setNewWh((prev) => ({
      ...prev,
      events: prev.events.includes(event)
        ? prev.events.filter((e) => e !== event)
        : [...prev.events, event],
    }));
  }

  return (
    <PageWrapper>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('webhooks:pageTitle')}</h1>
        <Button onClick={() => setCreateOpen(true)}>
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
          <Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4 mr-2" />{t('webhooks:createWebhook')}</Button>
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
                        <span className="font-medium">{wh.name ? String(wh.name) : String(wh.table_name)}</span>
                        <div className="flex gap-1">
                          {(wh.events as string[]).map((e) => (
                            <Badge key={e} variant="outline" className="text-[10px]">{e}</Badge>
                          ))}
                        </div>
                      </div>
                      <p className="text-sm text-muted-foreground truncate max-w-md">{String(wh.url)}</p>
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

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('webhooks:createWebhook')}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t('webhooks:form.name')}</Label>
              <Input value={newWh.name} onChange={(e) => setNewWh({ ...newWh, name: e.target.value })} placeholder={t('webhooks:form.namePlaceholder')} className="mt-1" />
            </div>
            <div>
              <Label>{t('webhooks:form.table')}</Label>
              <Select value={newWh.table_name} onValueChange={(v) => setNewWh({ ...newWh, table_name: v })}>
                <SelectTrigger className="mt-1"><SelectValue placeholder={t('webhooks:form.selectTable')} /></SelectTrigger>
                <SelectContent>
                  {tables.map((tbl) => <SelectItem key={tbl.name} value={tbl.name}>{tbl.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t('webhooks:form.events')}</Label>
              <div className="flex gap-4 mt-2">
                {EVENTS.map((e) => (
                  <div key={e} className="flex items-center gap-2">
                    <Checkbox checked={newWh.events.includes(e)} onCheckedChange={() => toggleEvent(e)} />
                    <Label>{e}</Label>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <Label>{t('webhooks:form.url')}</Label>
              <Input value={newWh.url} onChange={(e) => setNewWh({ ...newWh, url: e.target.value })} placeholder={t('webhooks:form.urlPlaceholder')} className="mt-1" />
            </div>
            <div>
              <Label>{t('webhooks:form.secret')}</Label>
              <Input value={newWh.secret} onChange={(e) => setNewWh({ ...newWh, secret: e.target.value })} placeholder={t('webhooks:form.secretPlaceholder')} className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{t('common:actions.cancel')}</Button>
            <Button onClick={() => createMutation.mutate()} disabled={!newWh.table_name || !newWh.events.length || !newWh.url || createMutation.isPending}>
              {createMutation.isPending ? t('webhooks:creating') : t('common:actions.create')}
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
