import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { useCurrentProject } from '@/hooks/useProject';
import { projectsApi } from '@/api/projects.api';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { usePageTitle } from '@/hooks/usePageTitle';
import { api } from '@/api/client';
import { ProjectQuotasTab } from '@/pages/project/ProjectQuotasTab';

export function ProjectSettingsPage() {
  const { t } = useTranslation('settings');
  usePageTitle(t('projectSettings.title'));
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: project } = useCurrentProject();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteSlugInput, setDeleteSlugInput] = useState('');

  useEffect(() => {
    if (project) {
      setName(project.name ?? '');
      setDescription(project.description ?? '');
    }
  }, [project]);

  const updateMutation = useMutation({
    mutationFn: () => projectsApi.update(project!.id, { name, description }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', project?.slug] });
      toast.success(t('projectSettings.saved'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => projectsApi.delete(project!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['project'] });
      navigate('/');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    updateMutation.mutate();
  };

  const handleDelete = () => {
    deleteMutation.mutate();
  };

  const canDelete = deleteSlugInput === project?.slug;

  return (
    <PageWrapper>
      <h1 className="text-2xl font-bold mb-6">{t('projectSettings.title')}</h1>

      {/* General Section */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>{t('projectSettings.general')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="project-name">{t('projectSettings.name')}</Label>
              <Input
                id="project-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="project-slug">{t('projectSettings.slug')}</Label>
              <Input
                id="project-slug"
                value={project?.slug ?? ''}
                readOnly
                className="text-muted-foreground"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="project-description">{t('projectSettings.description')}</Label>
              <Textarea
                id="project-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
              />
            </div>

            <Button type="submit" disabled={updateMutation.isPending}>
              {updateMutation.isPending
                ? t('projectSettings.saving')
                : t('projectSettings.save')}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Project Quotas */}
      {project && (
        <div className="mb-6">
          <ProjectQuotasTab projectId={project.id} />
        </div>
      )}

      {/* Cache Management */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>{t('projectSettings.cache.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t('projectSettings.cache.description')}
          </p>
          <Button
            variant="outline"
            onClick={async () => {
              try {
                await api.post('/system/cache/flush');
                toast.success(t('projectSettings.cache.cleared'));
              } catch (err) {
                toast.error((err as Error).message);
              }
            }}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            {t('projectSettings.cache.clearAll')}
          </Button>
        </CardContent>
      </Card>

      <Separator className="my-6" />

      {/* Danger Zone */}
      <Card className="border-destructive">
        <CardHeader>
          <CardTitle className="text-destructive">{t('projectSettings.dangerZone')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{t('projectSettings.deleteDesc')}</p>

          <div className="space-y-2">
            <Label htmlFor="delete-slug-confirm">{t('projectSettings.deleteConfirm')}</Label>
            <Input
              id="delete-slug-confirm"
              value={deleteSlugInput}
              onChange={(e) => setDeleteSlugInput(e.target.value)}
              placeholder={project?.slug}
            />
          </div>

          <Button
            variant="destructive"
            disabled={!canDelete}
            onClick={() => setDeleteOpen(true)}
          >
            {t('projectSettings.deleteProject')}
          </Button>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('projectSettings.deleteProject')}
        description={t('projectSettings.deleteDesc')}
        variant="destructive"
        onConfirm={handleDelete}
        loading={deleteMutation.isPending}
      />
    </PageWrapper>
  );
}
