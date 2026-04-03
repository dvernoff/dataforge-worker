import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, History, RotateCcw, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { useCurrentProject } from '@/hooks/useProject';
import { schemaApi, type SchemaVersion } from '@/api/schema.api';
import { toast } from 'sonner';
import { showErrorToast } from '@/lib/show-error-toast';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useTranslation } from 'react-i18next';

export function SchemaHistoryPage() {
  const { t } = useTranslation(['tables', 'common']);
  usePageTitle(t('versioning.title'));
  const { slug } = useParams<{ slug: string }>();
  const { data: project } = useCurrentProject();
  const queryClient = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [rollbackTarget, setRollbackTarget] = useState<SchemaVersion | null>(null);
  const [diffTarget, setDiffTarget] = useState<SchemaVersion | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['schema-versions', project?.id],
    queryFn: () => schemaApi.listSchemaVersions(project!.id),
    enabled: !!project?.id,
  });

  const createMutation = useMutation({
    mutationFn: () => schemaApi.createSchemaVersion(project!.id, description),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schema-versions', project?.id] });
      toast.success(t('versioning.snapshotCreated'));
      setCreateOpen(false);
      setDescription('');
    },
    onError: (err: Error) => showErrorToast(err),
  });

  const rollbackMutation = useMutation({
    mutationFn: (versionId: string) => schemaApi.rollbackSchemaVersion(project!.id, versionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schema-versions', project?.id] });
      queryClient.invalidateQueries({ queryKey: ['table'] });
      toast.success(t('versioning.rollbackSuccess'));
      setRollbackTarget(null);
    },
    onError: (err: Error) => showErrorToast(err),
  });

  const versions = data?.versions ?? [];

  function renderDiff(version: SchemaVersion) {
    const diff = typeof version.diff === 'string' ? JSON.parse(version.diff as unknown as string) : version.diff;
    if (!diff) return null;

    return (
      <div className="space-y-3">
        {diff.tables_added?.length > 0 && (
          <div>
            <p className="text-sm font-medium text-green-600 mb-1">+ {t('versioning.added')}</p>
            <div className="flex flex-wrap gap-1">
              {diff.tables_added.map((name: string) => (
                <Badge key={name} variant="outline" className="border-green-500/50 text-green-600">{name}</Badge>
              ))}
            </div>
          </div>
        )}
        {diff.tables_removed?.length > 0 && (
          <div>
            <p className="text-sm font-medium text-red-600 mb-1">- {t('versioning.removed')}</p>
            <div className="flex flex-wrap gap-1">
              {diff.tables_removed.map((name: string) => (
                <Badge key={name} variant="outline" className="border-red-500/50 text-red-600">{name}</Badge>
              ))}
            </div>
          </div>
        )}
        {diff.tables_modified?.length > 0 && (
          <div>
            <p className="text-sm font-medium text-yellow-600 mb-1">~ {t('versioning.modified')}</p>
            {diff.tables_modified.map((mod: { table: string; columns_added: string[]; columns_removed: string[]; columns_modified: string[] }) => (
              <div key={mod.table} className="ml-2 mb-2">
                <p className="font-mono text-sm font-medium">{mod.table}</p>
                {mod.columns_added?.length > 0 && (
                  <p className="text-xs text-green-600 ml-2">+ {mod.columns_added.join(', ')}</p>
                )}
                {mod.columns_removed?.length > 0 && (
                  <p className="text-xs text-red-600 ml-2">- {mod.columns_removed.join(', ')}</p>
                )}
                {mod.columns_modified?.length > 0 && (
                  <p className="text-xs text-yellow-600 ml-2">~ {mod.columns_modified.join(', ')}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  function getChangeCount(version: SchemaVersion): number {
    const diff = typeof version.diff === 'string' ? JSON.parse(version.diff as unknown as string) : version.diff;
    if (!diff) return 0;
    return (diff.tables_added?.length ?? 0) + (diff.tables_removed?.length ?? 0) + (diff.tables_modified?.length ?? 0);
  }

  return (
    <PageWrapper>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <History className="h-6 w-6 text-muted-foreground" />
          <h1 className="text-2xl font-bold">{t('versioning.title')}</h1>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          {t('versioning.createSnapshot')}
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : versions.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            {t('versioning.noVersions')}
          </CardContent>
        </Card>
      ) : (
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-5 top-0 bottom-0 w-0.5 bg-border" />

          <div className="space-y-4">
            {versions.map((version) => (
              <div key={version.id} className="relative flex gap-4">
                {/* Timeline dot */}
                <div className="relative z-10 flex-shrink-0">
                  <div className="h-10 w-10 rounded-full bg-background border-2 border-primary flex items-center justify-center dark:bg-background">
                    <span className="text-xs font-bold text-primary">v{version.version}</span>
                  </div>
                </div>

                {/* Content */}
                <Card className="flex-1">
                  <CardContent className="py-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium">{version.description}</p>
                        <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                          <span>{t('versioning.version')} {version.version}</span>
                          <span>{t('versioning.createdBy')}: {version.created_by}</span>
                          <span>{new Date(version.created_at).toLocaleString()}</span>
                          {getChangeCount(version) > 0 && (
                            <Badge variant="secondary">
                              {getChangeCount(version)} {t('versioning.changes')}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setDiffTarget(version)}
                        >
                          <Eye className="h-3 w-3 mr-1" />
                          {t('versioning.viewDiff')}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setRollbackTarget(version)}
                        >
                          <RotateCcw className="h-3 w-3 mr-1" />
                          {t('versioning.rollback')}
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Create Snapshot Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('versioning.createSnapshot')}</DialogTitle>
          </DialogHeader>
          <div>
            <Label>{t('versioning.description')}</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('versioning.descriptionPlaceholder')}
              className="mt-1"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{t('common:actions.cancel')}</Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!description || createMutation.isPending}
            >
              {createMutation.isPending ? t('versioning.creating') : t('versioning.createBtn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diff Dialog */}
      <Dialog open={!!diffTarget} onOpenChange={(o) => !o && setDiffTarget(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {diffTarget && t('versioning.diffTitle', { version: diffTarget.version })}
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[400px]">
            {diffTarget && renderDiff(diffTarget)}
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDiffTarget(null)}>{t('common:actions.close')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rollback Confirmation */}
      <ConfirmDialog
        open={!!rollbackTarget}
        onOpenChange={(o) => !o && setRollbackTarget(null)}
        title={t('versioning.rollbackTitle')}
        description={t('versioning.rollbackDesc', { version: rollbackTarget?.version ?? '' })}
        confirmText={t('versioning.rollbackConfirm')}
        variant="destructive"
        onConfirm={() => {
          if (rollbackTarget) {
            rollbackMutation.mutate(rollbackTarget.id);
          }
        }}
        loading={rollbackMutation.isPending}
      />
    </PageWrapper>
  );
}
