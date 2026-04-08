import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Play, Save, Plus, Terminal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { CronBuilder } from '@/components/cron/CronBuilder';
import { useCurrentProject } from '@/hooks/useProject';
import { cronApi } from '@/api/cron.api';
import { toast } from 'sonner';
import { usePageTitle } from '@/hooks/usePageTitle';
import { cn } from '@/lib/utils';

const ACTION_TYPES = [
  { value: 'sql', icon: Terminal },
] as const;

export function CronJobEditorPage() {
  const { t } = useTranslation(['cron', 'common']);
  const { id } = useParams<{ id: string }>();
  const isNew = id === 'new';
  usePageTitle(isNew ? t('cron:createJob') : t('cron:editJob'));
  const { data: project } = useCurrentProject();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    name: '',
    cron_expression: '0 * * * *',
    action_type: 'sql',
    action_config: {} as Record<string, unknown>,
  });

  // Load existing job (edit mode)
  const { data, isLoading } = useQuery({
    queryKey: ['cron-job', project?.id, id],
    queryFn: () => cronApi.getById(project!.id, id!),
    enabled: !!project?.id && !!id && !isNew,
  });

  useEffect(() => {
    if (data?.job && !isNew) {
      const job = data.job as Record<string, unknown>;
      const config = typeof job.action_config === 'string'
        ? JSON.parse(job.action_config as string)
        : (job.action_config as Record<string, unknown>) ?? {};
      setForm({
        name: String(job.name ?? ''),
        cron_expression: String(job.cron_expression ?? '0 * * * *'),
        action_type: String(job.action_type ?? 'sql'),
        action_config: config,
      });
    }
  }, [data, isNew]);

  // Create mutation
  const createMutation = useMutation({
    mutationFn: () => cronApi.create(project!.id, {
      ...form,
      is_active: false,
    }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['cron-jobs', project?.id] });
      toast.success(t('cron:jobCreated'));
      const jobId = (res as { job: { id: string } }).job?.id;
      if (jobId) navigate(`/projects/${project?.slug}/cron/${jobId}`, { replace: true });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: () => cronApi.update(project!.id, id!, form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cron-job', project?.id, id] });
      queryClient.invalidateQueries({ queryKey: ['cron-jobs', project?.id] });
      toast.success(t('cron:jobUpdated'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleMutation = useMutation({
    mutationFn: () => cronApi.toggle(project!.id, id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cron-job', project?.id, id] });
      queryClient.invalidateQueries({ queryKey: ['cron-jobs', project?.id] });
    },
  });

  const runNowMutation = useMutation({
    mutationFn: () => cronApi.runNow(project!.id, id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cron-job', project?.id, id] });
      toast.success(t('cron:jobTriggered'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Create + immediately test
  const testMutation = useMutation({
    mutationFn: async () => {
      const res = await cronApi.create(project!.id, { ...form, is_active: false });
      const jobId = (res as { job: { id: string } }).job?.id;
      if (jobId) {
        await cronApi.runNow(project!.id, jobId);
        return jobId;
      }
      throw new Error('Failed to create job');
    },
    onSuccess: (jobId) => {
      queryClient.invalidateQueries({ queryKey: ['cron-jobs', project?.id] });
      toast.success(t('cron:jobTriggered'));
      navigate(`/projects/${project?.slug}/cron/${jobId}`, { replace: true });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const recentRuns = !isNew ? (((data?.job as Record<string, unknown>)?.recent_runs ?? []) as Record<string, unknown>[]) : [];
  const slug = project?.slug ?? '';

  if (isLoading && !isNew) {
    return <PageWrapper><Skeleton className="h-96" /></PageWrapper>;
  }

  function updateConfig(key: string, value: unknown) {
    setForm((prev) => ({ ...prev, action_config: { ...prev.action_config, [key]: value } }));
  }

  function handleSave() {
    if (!form.name.trim()) { toast.error(t('cron:form.nameRequired')); return; }
    if (isNew) createMutation.mutate();
    else updateMutation.mutate();
  }

  const saving = createMutation.isPending || updateMutation.isPending;

  return (
    <PageWrapper>
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="icon" onClick={() => navigate(`/projects/${slug}/cron`)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-2xl font-bold">{isNew ? t('cron:createJob') : t('cron:editJob')}</h1>
        <div className="ml-auto flex items-center gap-3">
          {!isNew && (
            <label className="flex items-center gap-2 cursor-pointer">
              <Switch
                checked={!!(data?.job as Record<string, unknown>)?.is_active}
                onCheckedChange={() => toggleMutation.mutate()}
              />
              <span className="text-sm">{t('cron:table.active')}</span>
            </label>
          )}
          {isNew ? (
            <Button variant="outline" onClick={() => testMutation.mutate()} disabled={!form.name.trim() || testMutation.isPending}>
              <Play className="h-4 w-4 mr-2" />{t('cron:actions.createAndTest')}
            </Button>
          ) : (
            <Button variant="outline" onClick={() => runNowMutation.mutate()} disabled={runNowMutation.isPending}>
              <Play className="h-4 w-4 mr-2" />{t('cron:actions.runNow')}
            </Button>
          )}
          <Button onClick={handleSave} disabled={saving}>
            {isNew ? <Plus className="h-4 w-4 mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            {saving ? t('cron:creating') : isNew ? t('common:actions.create') : t('common:actions.save')}
          </Button>
        </div>
      </div>

      <div className="grid gap-6">
        {/* Basic info */}
        <Card>
          <CardContent className="space-y-5">
            <div>
              <Label className="mb-2 block">{t('cron:form.name')}</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t('cron:form.namePlaceholder')} />
            </div>
            <div>
              <Label className="mb-2 block">{t('cron:form.cronExpression')}</Label>
              <CronBuilder value={form.cron_expression || '0 * * * *'} onChange={(v) => setForm({ ...form, cron_expression: v })} />
            </div>
          </CardContent>
        </Card>

        {/* Action type */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('cron:form.actionType')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Pill selector */}
            <div className="flex gap-2">
              {ACTION_TYPES.map(({ value, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setForm({ ...form, action_type: value, action_config: {} })}
                  className={cn(
                    'flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all border',
                    form.action_type === value
                      ? 'bg-primary/10 border-primary/40 text-primary'
                      : 'bg-muted/50 border-transparent text-muted-foreground hover:text-foreground hover:bg-muted',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {t(`cron:form.actionTypes.${value}`)}
                </button>
              ))}
            </div>

            {/* Description */}
            <p className="text-sm text-muted-foreground">
              {t(`cron:actionTypeDesc.${form.action_type}`)}
            </p>

            {/* SQL form */}
            {form.action_type === 'sql' && (
              <div>
                <Label>{t('cron:form.sqlQuery')}</Label>
                <Textarea
                  value={String(form.action_config.query ?? '')}
                  onChange={(e) => updateConfig('query', e.target.value)}
                  placeholder={t('cron:form.sqlQueryPlaceholder')}
                  className="mt-1 font-mono text-sm"
                  rows={6}
                />
              </div>
            )}

          </CardContent>
        </Card>

        {/* Run History (edit mode only) */}
        {!isNew && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('cron:runs.title')}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('cron:runs.time')}</TableHead>
                    <TableHead>{t('cron:runs.status')}</TableHead>
                    <TableHead>{t('cron:runs.duration')}</TableHead>
                    <TableHead>{t('cron:runs.error')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentRuns.map((run) => {
                    const started = run.started_at ? new Date(String(run.started_at)) : null;
                    const completed = run.completed_at ? new Date(String(run.completed_at)) : null;
                    const durationMs = started && completed ? completed.getTime() - started.getTime() : null;
                    return (
                      <TableRow key={String(run.id)}>
                        <TableCell className="text-xs">{started?.toLocaleString() ?? '-'}</TableCell>
                        <TableCell>
                          <Badge variant={run.status === 'success' ? 'default' : run.status === 'running' ? 'secondary' : 'destructive'}>
                            {String(run.status)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">{durationMs !== null ? `${durationMs}ms` : '-'}</TableCell>
                        <TableCell className="text-xs text-destructive max-w-xs truncate">{run.error ? String(run.error) : '-'}</TableCell>
                      </TableRow>
                    );
                  })}
                  {recentRuns.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground py-8">{t('cron:runs.noRuns')}</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </PageWrapper>
  );
}
