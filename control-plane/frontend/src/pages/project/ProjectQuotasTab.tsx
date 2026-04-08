import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { projectQuotasApi, projectPlansApi } from '@/api/project-quotas.api';
import { Infinity, Gauge, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';

const QUOTA_GROUPS = [
  {
    key: 'resources',
    fields: ['max_tables', 'max_records', 'max_storage_mb', 'max_files'],
  },
  {
    key: 'apiAutomation',
    fields: ['max_api_requests', 'max_endpoints', 'max_cron'],
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

function getProgressColor(pct: number): string {
  if (pct >= 90) return '[&>div]:bg-destructive';
  if (pct >= 70) return '[&>div]:bg-amber-500';
  return '';
}

function formatPerfValue(field: string, val: number) {
  if (field === 'max_query_timeout_ms') return `${(val / 1000).toFixed(0)}s`;
  return val.toLocaleString();
}

export function ProjectQuotasTab({ projectId }: { projectId: string }) {
  const { t } = useTranslation(['settings', 'system']);
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isSuperadmin = user?.is_superadmin ?? false;

  const { data, isLoading } = useQuery({
    queryKey: ['project-quota', projectId],
    queryFn: () => projectQuotasApi.getProjectQuota(projectId),
    enabled: !!projectId,
  });

  const { data: plansData } = useQuery({
    queryKey: ['project-plans'],
    queryFn: () => projectPlansApi.list(),
    enabled: isSuperadmin,
  });

  const assignPlanMutation = useMutation({
    mutationFn: (planId: string) => projectQuotasApi.assignPlan(projectId, planId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-quota', projectId] });
      toast.success(t('settings:projectQuotas.planChanged'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader><Skeleton className="h-6 w-48" /></CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8" />)}
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const { quota, usage, source, plan_name, plan_color } = data;
  const isPersonalNode = source === 'personal_node';
  const plans = plansData?.plans ?? [];

  const sourceBadge = () => {
    if (source === 'plan' && plan_name) {
      return (
        <Badge
          variant="outline"
          style={{
            backgroundColor: `${plan_color}1A`,
            color: plan_color,
            borderColor: `${plan_color}33`,
          }}
        >
          {plan_name}
        </Badge>
      );
    }
    if (source === 'project_override') {
      return <Badge variant="secondary">{t('settings:projectQuotas.source.override')}</Badge>;
    }
    if (source === 'personal_node') {
      return <Badge variant="default">{t('settings:projectQuotas.source.personal_node')}</Badge>;
    }
    return <Badge variant="secondary">{t('settings:projectQuotas.source.default')}</Badge>;
  };

  const currentPlanId = plans.find(p => p.name === plan_name)?.id;

  const progressGroups = QUOTA_GROUPS.filter(g => g.key !== 'performance');
  const perfGroup = QUOTA_GROUPS.find(g => g.key === 'performance');

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{t('settings:projectQuotas.title')}</CardTitle>
          <div className="flex items-center gap-2">
            {sourceBadge()}
          </div>
        </div>
        {isSuperadmin && !isPersonalNode && plans.length > 0 && (
          <div className="flex items-center gap-3 mt-3 pt-3 border-t">
            <ShieldCheck className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-sm text-muted-foreground">{t('settings:projectQuotas.changePlan')}:</span>
            <Select
              value={currentPlanId ?? ''}
              onValueChange={(val) => assignPlanMutation.mutate(val)}
              disabled={assignPlanMutation.isPending}
            >
              <SelectTrigger className="w-48 h-8">
                <SelectValue placeholder={t('settings:projectQuotas.selectPlan')} />
              </SelectTrigger>
              <SelectContent>
                {plans.map((plan) => (
                  <SelectItem key={plan.id} value={plan.id}>
                    <div className="flex items-center gap-2">
                      <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: plan.color }} />
                      {plan.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-6">
        {isPersonalNode ? (
          <div className="space-y-4">
            {QUOTA_GROUPS.map((group) => (
              <div key={group.key}>
                <h4 className="text-sm font-medium text-muted-foreground mb-3">
                  {t(`settings:projectQuotas.groups.${group.key}`)}
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {group.fields.map((field) => (
                    <div key={field} className="rounded-md border p-3 text-center">
                      <div className="text-lg font-semibold flex items-center justify-center gap-1">
                        <Infinity className="h-5 w-5" />
                      </div>
                      <div className="text-xs text-muted-foreground">{t(`settings:projectQuotas.fields.${field}`)}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-6">
            {progressGroups.map((group) => (
              <div key={group.key}>
                <h4 className="text-sm font-medium text-muted-foreground mb-3">
                  {t(`settings:projectQuotas.groups.${group.key}`)}
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {group.fields.map((field) => {
                    const limit = quota?.[field] ?? 0;
                    const usageKey = field.replace(/^max_/, '');
                    const used = usage?.[usageKey] ?? 0;
                    const pct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;

                    return (
                      <div key={field} className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <span>{t(`settings:projectQuotas.fields.${field}`)}</span>
                          <span className="text-muted-foreground">
                            {typeof used === 'number' && used % 1 !== 0 ? used.toFixed(2) : used} / {limit === 0 ? '\u221E' : limit.toLocaleString()}
                          </span>
                        </div>
                        <Progress value={pct} className={`h-2 ${getProgressColor(pct)}`} />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            {perfGroup && (
              <>
                <Separator />
                <div>
                  <h4 className="text-sm font-medium flex items-center gap-1.5 mb-3">
                    <Gauge className="h-4 w-4" />
                    {t(`settings:projectQuotas.groups.performance`)}
                  </h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {perfGroup.fields.map((field) => {
                      const val = quota?.[field] ?? 0;
                      return (
                        <div key={field} className="rounded-md border p-3 text-center">
                          <div className="text-lg font-semibold">{formatPerfValue(field, val)}</div>
                          <div className="text-xs text-muted-foreground">{t(`settings:projectQuotas.fields.${field}`)}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
