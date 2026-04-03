import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Plus, Clock, Trash2, Play, MoreHorizontal, Eye } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { staggerContainer, staggerItem } from '@/lib/animations';
import { useCurrentProject } from '@/hooks/useProject';
import { cronApi } from '@/api/cron.api';
import { toast } from 'sonner';
import { usePageTitle } from '@/hooks/usePageTitle';

export function CronJobsListPage() {
  const { t } = useTranslation(['cron', 'common']);
  usePageTitle(t('cron:pageTitle'));
  const { data: project } = useCurrentProject();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const slug = project?.slug ?? '';

  const { data, isLoading } = useQuery({
    queryKey: ['cron-jobs', project?.id],
    queryFn: () => cronApi.list(project!.id),
    enabled: !!project?.id,
  });

  const toggleMutation = useMutation({
    mutationFn: (jobId: string) => cronApi.toggle(project!.id, jobId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cron-jobs', project?.id] }),
  });

  const runNowMutation = useMutation({
    mutationFn: (jobId: string) => cronApi.runNow(project!.id, jobId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cron-jobs', project?.id] });
      toast.success(t('cron:jobTriggered'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => cronApi.delete(project!.id, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cron-jobs', project?.id] });
      toast.success(t('cron:jobDeleted'));
      setDeleteTarget(null);
    },
  });

  const jobs = (data?.jobs ?? []) as Record<string, unknown>[];

  return (
    <PageWrapper>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('cron:pageTitle')}</h1>
        <Button onClick={() => navigate(`/projects/${slug}/cron/new`)}>
          <Plus className="h-4 w-4 mr-2" />
          {t('cron:createJob')}
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : jobs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Clock className="h-12 w-12 text-muted-foreground mb-4" />
          <h2 className="text-lg font-medium mb-2">{t('cron:noJobs')}</h2>
          <p className="text-muted-foreground mb-4">{t('cron:noJobsDesc')}</p>
          <Button onClick={() => navigate(`/projects/${slug}/cron/new`)}>
            <Plus className="h-4 w-4 mr-2" />{t('cron:createJob')}
          </Button>
        </div>
      ) : (
        <motion.div variants={staggerContainer} initial="initial" animate="animate">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('cron:table.name')}</TableHead>
                <TableHead>{t('cron:table.expression')}</TableHead>
                <TableHead>{t('cron:table.lastStatus')}</TableHead>
                <TableHead>{t('cron:table.runCount')}</TableHead>
                <TableHead>{t('cron:table.active')}</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((job) => (
                <motion.tr key={String(job.id)} variants={staggerItem} className="border-b transition-colors hover:bg-muted/50 cursor-pointer" onClick={() => navigate(`/projects/${slug}/cron/${String(job.id)}`)}>
                  <TableCell className="font-medium">{String(job.name)}</TableCell>
                  <TableCell>
                    <code className="text-xs bg-muted px-2 py-1 rounded">{String(job.cron_expression)}</code>
                  </TableCell>
                  <TableCell>
                    {job.last_status ? (
                      <Badge variant={job.last_status === 'success' ? 'default' : 'destructive'}>{String(job.last_status)}</Badge>
                    ) : (
                      <span className="text-muted-foreground text-sm">{t('common:status.never')}</span>
                    )}
                  </TableCell>
                  <TableCell>{String(job.run_count ?? 0)}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Switch checked={!!job.is_active} onCheckedChange={() => toggleMutation.mutate(String(job.id))} />
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => navigate(`/projects/${slug}/cron/${String(job.id)}`)}>
                          <Eye className="h-4 w-4 mr-2" />{t('common:actions.edit')}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => runNowMutation.mutate(String(job.id))}>
                          <Play className="h-4 w-4 mr-2" />{t('cron:actions.runNow')}
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(String(job.id))}>
                          <Trash2 className="h-4 w-4 mr-2" />{t('common:actions.delete')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </motion.tr>
              ))}
            </TableBody>
          </Table>
        </motion.div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={t('cron:deleteConfirm.title')}
        description={t('cron:deleteConfirm.desc')}
        confirmText={t('common:actions.delete')}
        variant="destructive"
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
        loading={deleteMutation.isPending}
      />
    </PageWrapper>
  );
}
