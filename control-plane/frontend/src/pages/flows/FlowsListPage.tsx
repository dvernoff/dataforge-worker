import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Plus, Zap, Trash2, MoreHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { staggerContainer, staggerItem } from '@/lib/animations';
import { useCurrentProject } from '@/hooks/useProject';
import { flowsApi } from '@/api/flows.api';
import { toast } from 'sonner';
import { usePageTitle } from '@/hooks/usePageTitle';

const TRIGGER_TYPES = ['manual', 'data_change', 'webhook', 'cron', 'api_call'] as const;

export function FlowsListPage() {
  const { t } = useTranslation(['flows', 'common']);
  usePageTitle(t('flows:pageTitle'));
  const { data: project } = useCurrentProject();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const [newFlow, setNewFlow] = useState({
    name: '',
    description: '',
    trigger_type: 'manual' as string,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['flows', project?.id],
    queryFn: () => flowsApi.list(project!.id),
    enabled: !!project?.id,
  });

  const createMutation = useMutation({
    mutationFn: () => flowsApi.create(project!.id, {
      name: newFlow.name,
      description: newFlow.description || undefined,
      trigger_type: newFlow.trigger_type,
    }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['flows', project?.id] });
      toast.success(t('flows:flowCreated'));
      setCreateOpen(false);
      setNewFlow({ name: '', description: '', trigger_type: 'manual' });
      // Navigate to editor
      if (data?.flow?.id) {
        navigate(`/projects/${project?.slug}/flows/${String(data.flow.id)}`);
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      flowsApi.update(project!.id, id, { is_active: active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['flows', project?.id] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => flowsApi.delete(project!.id, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flows', project?.id] });
      toast.success(t('flows:flowDeleted'));
      setDeleteTarget(null);
    },
  });

  const flows = (data?.flows ?? []) as Record<string, unknown>[];
  const slug = project?.slug ?? '';

  return (
    <PageWrapper>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('flows:pageTitle')}</h1>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          {t('flows:createFlow')}
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40" />)}</div>
      ) : flows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Zap className="h-12 w-12 text-muted-foreground mb-4" />
          <h2 className="text-lg font-medium mb-2">{t('flows:noFlows')}</h2>
          <p className="text-muted-foreground mb-4">{t('flows:noFlowsDesc')}</p>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />{t('flows:createFlow')}
          </Button>
        </div>
      ) : (
        <motion.div variants={staggerContainer} initial="initial" animate="animate" className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {flows.map((flow) => {
            const nodes = typeof flow.nodes === 'string' ? JSON.parse(flow.nodes as string) : (flow.nodes ?? []);
            return (
              <motion.div key={String(flow.id)} variants={staggerItem}>
                <Card className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => navigate(`/projects/${slug}/flows/${String(flow.id)}`)}>
                  <CardContent>
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h3 className="font-medium">{String(flow.name)}</h3>
                        {flow.description && (
                          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{String(flow.description)}</p>
                        )}
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem className="text-destructive" onClick={(e) => { e.stopPropagation(); setDeleteTarget(String(flow.id)); }}>
                            <Trash2 className="h-4 w-4 mr-2" />{t('common:actions.delete')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap mt-3">
                      <Badge variant="outline">
                        {t(`flows:form.triggerTypes.${String(flow.trigger_type)}` as const)}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {Array.isArray(nodes) ? nodes.length : 0} {t('flows:card.steps')}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {String(flow.run_count ?? 0)} {t('flows:card.runs')}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-3">
                      <div className="text-xs text-muted-foreground">
                        {flow.last_run_at
                          ? `${t('flows:card.lastRun')}: ${new Date(String(flow.last_run_at)).toLocaleString()}`
                          : null}
                      </div>
                      <Switch
                        checked={!!flow.is_active}
                        onCheckedChange={(v) => { toggleMutation.mutate({ id: String(flow.id), active: v }); }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </motion.div>
      )}

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('flows:createFlow')}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t('flows:form.name')}</Label>
              <Input value={newFlow.name} onChange={(e) => setNewFlow({ ...newFlow, name: e.target.value })} placeholder={t('flows:form.namePlaceholder')} className="mt-1" />
            </div>
            <div>
              <Label>{t('flows:form.description')}</Label>
              <Textarea value={newFlow.description} onChange={(e) => setNewFlow({ ...newFlow, description: e.target.value })} placeholder={t('flows:form.descriptionPlaceholder')} className="mt-1" rows={3} />
            </div>
            <div>
              <Label>{t('flows:form.triggerType')}</Label>
              <Select value={newFlow.trigger_type} onValueChange={(v) => setNewFlow({ ...newFlow, trigger_type: v })}>
                <SelectTrigger className="mt-1">{t(`flows:form.triggerTypes.${newFlow.trigger_type}`)}</SelectTrigger>
                <SelectContent>
                  {TRIGGER_TYPES.map((tt) => (
                    <SelectItem key={tt} value={tt}>{t(`flows:form.triggerTypes.${tt}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{t('common:actions.cancel')}</Button>
            <Button onClick={() => createMutation.mutate()} disabled={!newFlow.name || createMutation.isPending}>
              {createMutation.isPending ? t('flows:creating') : t('common:actions.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={t('flows:deleteConfirm.title')}
        description={t('flows:deleteConfirm.desc')}
        confirmText={t('common:actions.delete')}
        variant="destructive"
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
        loading={deleteMutation.isPending}
      />
    </PageWrapper>
  );
}
