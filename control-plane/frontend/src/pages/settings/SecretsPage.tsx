import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus, Eye, EyeOff, Trash2, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { useCurrentProject } from '@/hooks/useProject';
import { usePageTitle } from '@/hooks/usePageTitle';
import { api } from '@/api/client';
import { toast } from 'sonner';

interface Secret {
  id: string;
  key: string;
  description: string | null;
  value_masked: string;
  decrypted_value?: string;
  created_at: string;
}

export function SecretsPage() {
  const { t } = useTranslation(['settings', 'common']);
  usePageTitle(t('settings:secrets.title'));
  const { data: project } = useCurrentProject();
  const queryClient = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set());
  const [revealedValues, setRevealedValues] = useState<Record<string, string>>({});

  const { data, isLoading } = useQuery({
    queryKey: ['secrets', project?.id],
    queryFn: () => api.get<{ secrets: Secret[] }>(`/projects/${project!.id}/secrets`),
    enabled: !!project?.id,
  });

  const createMutation = useMutation({
    mutationFn: () => api.post(`/projects/${project!.id}/secrets`, {
      key: newKey,
      value: newValue,
      description: newDesc || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['secrets', project?.id] });
      setDialogOpen(false);
      setNewKey('');
      setNewValue('');
      setNewDesc('');
      toast.success(t('settings:secrets.created'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/projects/${project!.id}/secrets/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['secrets', project?.id] });
      setDeleteId(null);
      toast.success(t('settings:secrets.deleted'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleReveal = async (secretId: string) => {
    if (revealedIds.has(secretId)) {
      setRevealedIds((prev) => {
        const next = new Set(prev);
        next.delete(secretId);
        return next;
      });
      return;
    }

    try {
      const result = await api.get<{ secret: Secret }>(
        `/projects/${project!.id}/secrets/${secretId}?reveal=true`
      );
      if (result.secret.decrypted_value) {
        setRevealedValues((prev) => ({ ...prev, [secretId]: result.secret.decrypted_value! }));
        setRevealedIds((prev) => new Set(prev).add(secretId));
      }
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const secrets = data?.secrets ?? [];

  return (
    <PageWrapper>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('settings:secrets.title')}</h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              {t('settings:secrets.addSecret')}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('settings:secrets.addSecret')}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>{t('settings:secrets.key')}</Label>
                <Input
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
                  placeholder="MY_SECRET_KEY"
                  className="font-mono"
                />
              </div>
              <div className="space-y-2">
                <Label>{t('settings:secrets.value')}</Label>
                <Input
                  type="password"
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  placeholder={t('settings:secrets.valuePlaceholder')}
                />
              </div>
              <div className="space-y-2">
                <Label>{t('settings:secrets.description')}</Label>
                <Textarea
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder={t('settings:secrets.descriptionPlaceholder')}
                  rows={2}
                />
              </div>
              <Button
                onClick={() => createMutation.mutate()}
                disabled={!newKey || !newValue || createMutation.isPending}
                className="w-full"
              >
                {createMutation.isPending ? t('common:actions.creating') : t('common:actions.create')}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Alert className="mb-4">
        <Info className="h-4 w-4" />
        <AlertDescription>{t('settings:secrets.info')}</AlertDescription>
      </Alert>

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('settings:secrets.key')}</TableHead>
              <TableHead>{t('settings:secrets.value')}</TableHead>
              <TableHead>{t('settings:secrets.description')}</TableHead>
              <TableHead>{t('common:table.created')}</TableHead>
              <TableHead className="w-24">{t('common:actions.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {secrets.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  {t('settings:secrets.noSecrets')}
                </TableCell>
              </TableRow>
            ) : (
              secrets.map((secret) => (
                <TableRow key={secret.id}>
                  <TableCell>
                    <Badge variant="secondary" className="font-mono">
                      {secret.key}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {revealedIds.has(secret.id) ? revealedValues[secret.id] : secret.value_masked}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                    {secret.description ?? '-'}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(secret.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => handleReveal(secret.id)}
                        title={revealedIds.has(secret.id) ? t('settings:secrets.hide') : t('settings:secrets.reveal')}
                      >
                        {revealedIds.has(secret.id) ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive"
                        onClick={() => setDeleteId(secret.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

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
