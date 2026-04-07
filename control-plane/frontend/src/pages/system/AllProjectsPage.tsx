import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { useAllProjects } from '@/hooks/useProject';
import { useAuthStore } from '@/stores/auth.store';
import { projectsApi } from '@/api/projects.api';
import { toast } from 'sonner';
import { usePageTitle } from '@/hooks/usePageTitle';

export function AllProjectsPage() {
  const { t } = useTranslation('system');
  usePageTitle(t('projects.title'));
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const { data: projects, isLoading } = useAllProjects();
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => projectsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['project'] });
      toast.success(t('projects.deleted'));
      setDeleteTarget(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <PageWrapper>
      <h1 className="text-2xl font-bold mb-6">{t('projects.title')}</h1>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('projects.headers.name')}</TableHead>
                <TableHead>{t('projects.headers.slug')}</TableHead>
                <TableHead>{t('projects.headers.owner')}</TableHead>
                <TableHead>{t('projects.headers.members')}</TableHead>
                <TableHead>{t('projects.headers.created')}</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(projects ?? []).map((p) => (
                <TableRow key={p.id} className="cursor-pointer" onClick={() => navigate(`/projects/${p.slug}/dashboard`)}>
                  <TableCell className="font-medium">
                    {p.name}
                    {p.created_by === user?.id && <Badge variant="outline" className="ml-2 text-[10px]">{t('projects.you')}</Badge>}
                  </TableCell>
                  <TableCell className="font-mono text-sm text-muted-foreground">{p.slug}</TableCell>
                  <TableCell className="text-sm">{(p as Record<string, unknown>).owner_name as string ?? '—'}</TableCell>
                  <TableCell>{(p as Record<string, unknown>).members_count as number ?? '—'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{new Date(p.created_at).toLocaleDateString()}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      onClick={() => setDeleteTarget({ id: p.id, name: p.name })}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={t('projects.deleteConfirm.title')}
        description={t('projects.deleteConfirm.desc', { name: deleteTarget?.name })}
        confirmText={t('projects.deleteConfirm.confirm')}
        variant="destructive"
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        loading={deleteMutation.isPending}
      />
    </PageWrapper>
  );
}
