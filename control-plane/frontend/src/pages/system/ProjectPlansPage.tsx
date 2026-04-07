import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Edit, Layers } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/number-input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { usePageTitle } from '@/hooks/usePageTitle';
import { projectPlansApi } from '@/api/project-quotas.api';
import { toast } from 'sonner';

const COLOR_PRESETS = [
  '#EF4444', '#F97316', '#EAB308', '#22C55E',
  '#06B6D4', '#3B82F6', '#8B5CF6', '#EC4899',
  '#6B7280', '#14B8A6', '#A855F7', '#F43F5E',
  '#84CC16', '#0EA5E9', '#6366F1', '#D946EF',
];

const QUOTA_GROUPS = [
  {
    key: 'resources',
    fields: ['max_tables', 'max_records', 'max_storage_mb', 'max_files'],
  },
  {
    key: 'apiAutomation',
    fields: ['max_api_requests', 'max_endpoints', 'max_webhooks', 'max_cron'],
  },
  {
    key: 'backups',
    fields: ['max_backups'],
  },
  {
    key: 'performance',
    fields: ['max_query_timeout_ms', 'max_concurrent_requests', 'max_rows_per_query', 'max_export_rows'],
  },
] as const;

const QUOTA_DEFAULTS: Record<string, number> = {
  max_tables: 50, max_records: 10000, max_storage_mb: 500, max_files: 100,
  max_api_requests: 1000, max_endpoints: 20, max_webhooks: 10, max_cron: 5,
  max_backups: 5,
  max_query_timeout_ms: 30000, max_concurrent_requests: 10, max_rows_per_query: 1000, max_export_rows: 10000,
};

type Plan = { id: string; name: string; color: string; description?: string; projects_count: number; created_at: string; [key: string]: unknown };

function formatQuotaSummary(plan: Plan) {
  const parts: string[] = [];
  if (plan.max_tables) parts.push(`${plan.max_tables} tbl`);
  if (plan.max_records) {
    const v = (plan.max_records as number) >= 1000 ? `${((plan.max_records as number) / 1000).toFixed(0)}K` : String(plan.max_records);
    parts.push(`${v} rec`);
  }
  if (plan.max_storage_mb) parts.push(`${plan.max_storage_mb} MB`);
  if (plan.max_api_requests) {
    const v = (plan.max_api_requests as number) >= 1000 ? `${((plan.max_api_requests as number) / 1000).toFixed(0)}K` : String(plan.max_api_requests);
    parts.push(`${v} API`);
  }
  return parts.join(', ');
}

export function ProjectPlansPage() {
  const { t } = useTranslation(['system', 'common']);
  usePageTitle(t('system:projectPlans.title'));
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editPlan, setEditPlan] = useState<Plan | null>(null);
  const [deletePlanId, setDeletePlanId] = useState<string | null>(null);

  const [planName, setPlanName] = useState('');
  const [planDescription, setPlanDescription] = useState('');
  const [planColor, setPlanColor] = useState('#3B82F6');
  const [quotaValues, setQuotaValues] = useState<Record<string, number>>({ ...QUOTA_DEFAULTS });

  const { data, isLoading } = useQuery({
    queryKey: ['project-plans'],
    queryFn: () => projectPlansApi.list(),
  });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => projectPlansApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-plans'] });
      toast.success(t('system:projectPlans.created'));
      handleCloseDialog();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => projectPlansApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-plans'] });
      toast.success(t('system:projectPlans.updated'));
      handleCloseDialog();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => projectPlansApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-plans'] });
      toast.success(t('system:projectPlans.deleted'));
      setDeletePlanId(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function handleCloseDialog() {
    setCreateOpen(false);
    setEditPlan(null);
    setPlanName('');
    setPlanDescription('');
    setPlanColor('#3B82F6');
    setQuotaValues({ ...QUOTA_DEFAULTS });
  }

  function handleOpenEdit(plan: Plan) {
    setEditPlan(plan);
    setPlanName(plan.name);
    setPlanDescription(plan.description ?? '');
    setPlanColor(plan.color ?? '#3B82F6');
    const qv: Record<string, number> = {};
    for (const key of Object.keys(QUOTA_DEFAULTS)) {
      qv[key] = (plan as unknown as Record<string, number>)[key] ?? QUOTA_DEFAULTS[key];
    }
    setQuotaValues(qv);
    setCreateOpen(true);
  }

  function handleSave() {
    const data: Record<string, unknown> = {
      name: planName,
      color: planColor,
      description: planDescription || undefined,
      ...quotaValues,
    };
    if (editPlan) {
      updateMutation.mutate({ id: editPlan.id, data });
    } else {
      createMutation.mutate(data);
    }
  }

  const plans = (data?.plans ?? []) as Plan[];
  const deletePlan = deletePlanId ? plans.find(p => p.id === deletePlanId) : null;

  return (
    <PageWrapper>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('system:projectPlans.title')}</h1>
        <Button onClick={() => { handleCloseDialog(); setCreateOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" />{t('system:projectPlans.addPlan')}
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : plans.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Layers className="h-12 w-12 text-muted-foreground mb-4" />
          <h2 className="text-lg font-medium mb-2">{t('system:projectPlans.noPlans')}</h2>
          <p className="text-muted-foreground mb-4">{t('system:projectPlans.noPlansDesc')}</p>
          <Button onClick={() => { handleCloseDialog(); setCreateOpen(true); }}>
            <Plus className="h-4 w-4 mr-2" />{t('system:projectPlans.addPlan')}
          </Button>
        </div>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('system:projectPlans.headers.name')}</TableHead>
                <TableHead>{t('system:projectPlans.headers.projects')}</TableHead>
                <TableHead>{t('system:projectPlans.headers.description')}</TableHead>
                <TableHead>{t('system:projectPlans.headers.created')}</TableHead>
                <TableHead className="w-24">{t('common:actions.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plans.map((plan) => (
                <TableRow key={plan.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div
                        className="h-3 w-3 rounded-full shrink-0"
                        style={{ backgroundColor: plan.color || '#6B7280' }}
                      />
                      <div>
                        <div className="font-medium">{plan.name}</div>
                        <div className="text-xs text-muted-foreground">{formatQuotaSummary(plan)}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-xs">
                      {plan.projects_count ?? 0}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-muted-foreground line-clamp-1">
                      {plan.description || '\u2014'}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(plan.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleOpenEdit(plan)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeletePlanId(plan.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog open={createOpen} onOpenChange={(o) => !o && handleCloseDialog()}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editPlan ? t('system:projectPlans.editPlan') : t('system:projectPlans.addPlan')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>{t('system:projectPlans.planName')}</Label>
                <Input
                  value={planName}
                  onChange={(e) => setPlanName(e.target.value)}
                  placeholder="e.g. Starter, Pro, Enterprise"
                />
              </div>
              <div className="space-y-2">
                <Label>{t('system:projectPlans.planDescription')}</Label>
                <Textarea
                  value={planDescription}
                  onChange={(e) => setPlanDescription(e.target.value)}
                  placeholder={t('system:projectPlans.planDescription')}
                  rows={2}
                />
              </div>
              <div className="space-y-2">
                <Label>{t('system:projectPlans.planColor')}</Label>
                <div className="flex flex-wrap gap-2">
                  {COLOR_PRESETS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className="h-7 w-7 rounded-full border-2 transition-all hover:scale-110"
                      style={{
                        backgroundColor: color,
                        borderColor: planColor === color ? '#fff' : 'transparent',
                        boxShadow: planColor === color ? `0 0 0 2px ${color}` : 'none',
                      }}
                      onClick={() => setPlanColor(color)}
                    />
                  ))}
                </div>
              </div>
            </div>

            <Separator />

            <div className="space-y-5">
              <Label className="text-base font-semibold">{t('system:projectPlans.quotaGroups.resources')}</Label>

              {QUOTA_GROUPS.map((group) => (
                <div key={group.key} className="space-y-3">
                  <h4 className="text-sm font-medium text-muted-foreground">
                    {t(`system:projectPlans.quotaGroups.${group.key}`)}
                  </h4>
                  <div className="grid grid-cols-2 gap-3">
                    {group.fields.map((field) => (
                      <div key={field} className="space-y-1">
                        <Label className="text-xs" htmlFor={`q-${field}`}>
                          {t(`system:projectPlans.quotaFields.${field}`)}
                        </Label>
                        <NumberInput
                          id={`q-${field}`}
                          min={0}
                          value={quotaValues[field] ?? 0}
                          onChange={(v) =>
                            setQuotaValues((prev) => ({ ...prev, [field]: v }))
                          }
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={handleCloseDialog}>{t('common:actions.cancel')}</Button>
            <Button
              onClick={handleSave}
              disabled={!planName || createMutation.isPending || updateMutation.isPending}
            >
              {editPlan ? t('common:actions.save') : t('common:actions.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deletePlanId}
        onOpenChange={(o) => !o && setDeletePlanId(null)}
        title={t('system:projectPlans.confirmDelete.title')}
        description={
          deletePlan && deletePlan.projects_count > 0
            ? t('system:projectPlans.confirmDelete.desc', { count: deletePlan.projects_count })
            : t('system:projectPlans.confirmDelete.desc', { count: 0 })
        }
        confirmText={t('common:actions.delete')}
        variant="destructive"
        onConfirm={() => { if (deletePlanId) deleteMutation.mutate(deletePlanId); }}
        loading={deleteMutation.isPending}
      />
    </PageWrapper>
  );
}
