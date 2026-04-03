import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus, LayoutDashboard, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { useCurrentProject } from '@/hooks/useProject';
import { usePageTitle } from '@/hooks/usePageTitle';
import { dashboardsApi, type Dashboard } from '@/api/dashboards.api';
import { toast } from 'sonner';

export function DashboardsListPage() {
  const { t } = useTranslation(['dashboards', 'common']);
  usePageTitle(t('dashboards:title'));
  const { data: project } = useCurrentProject();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['dashboards', project?.id],
    queryFn: () => dashboardsApi.list(project!.id),
    enabled: !!project?.id,
  });

  const createMutation = useMutation({
    mutationFn: () => dashboardsApi.create(project!.id, { name, description: description || undefined }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['dashboards', project?.id] });
      setDialogOpen(false);
      setName('');
      setDescription('');
      toast.success(t('dashboards:created'));
      navigate(`/projects/${project!.slug}/dashboards/${result.dashboard.id}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => dashboardsApi.delete(project!.id, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboards', project?.id] });
      setDeleteId(null);
      toast.success(t('dashboards:deleted'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const dashboards = data?.dashboards ?? [];

  return (
    <PageWrapper>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('dashboards:title')}</h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              {t('dashboards:create')}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('dashboards:create')}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>{t('dashboards:name')}</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('dashboards:namePlaceholder')} />
              </div>
              <div className="space-y-2">
                <Label>{t('dashboards:description')}</Label>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('dashboards:descriptionPlaceholder')} rows={2} />
              </div>
              <Button onClick={() => createMutation.mutate()} disabled={!name || createMutation.isPending} className="w-full">
                {createMutation.isPending ? t('common:actions.creating') : t('common:actions.create')}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {dashboards.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <LayoutDashboard className="h-12 w-12 text-muted-foreground mb-4" />
          <h2 className="text-lg font-medium mb-2">{t('dashboards:empty')}</h2>
          <p className="text-muted-foreground mb-4">{t('dashboards:emptyDesc')}</p>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />{t('dashboards:create')}
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {dashboards.map((d) => (
            <Card key={d.id} className="cursor-pointer hover:shadow-md transition-shadow group" onClick={() => navigate(`/projects/${project!.slug}/dashboards/${d.id}`)}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <CardTitle className="text-base">{d.name}</CardTitle>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 opacity-0 group-hover:opacity-100"
                    onClick={(e) => { e.stopPropagation(); setDeleteId(d.id); }}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
                {d.description && <CardDescription>{d.description}</CardDescription>}
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  {((d.widgets as unknown[]) ?? []).length} {t('dashboards:widgets')} · {new Date(d.created_at).toLocaleDateString()}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={(open) => { if (!open) setDeleteId(null); }}
        title={t('common:confirm.deleteTitle')}
        description={t('common:confirm.deleteDescription')}
        confirmText={t('common:actions.delete')}
        variant="destructive"
        onConfirm={() => { if (deleteId) deleteMutation.mutate(deleteId); }}
        loading={deleteMutation.isPending}
      />
    </PageWrapper>
  );
}
