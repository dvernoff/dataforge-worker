import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Copy, KeyRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { useCurrentProject } from '@/hooks/useProject';
import { api } from '@/api/client';
import { toast } from 'sonner';
import { usePageTitle } from '@/hooks/usePageTitle';

export function InviteKeysPage() {
  const { t } = useTranslation('settings');
  usePageTitle(t('invites.title'));
  const { data: project } = useCurrentProject();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [newInvite, setNewInvite] = useState({ role: 'viewer', maxUses: 1 });

  const { data, isLoading } = useQuery({
    queryKey: ['invites', project?.id],
    queryFn: () => api.get<{ invites: Record<string, unknown>[] }>(`/projects/${project!.id}/invites`),
    enabled: !!project?.id,
  });

  const createMutation = useMutation({
    mutationFn: () => api.post<{ invite: Record<string, unknown> }>(`/projects/${project!.id}/invites`, newInvite),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['invites', project?.id] });
      toast.success(t('invites.created'));
      const key = String(data.invite.key);
      navigator.clipboard.writeText(key);
      toast.info(t('invites.keyCopied'));
      setCreateOpen(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const invites = data?.invites ?? [];

  function copyKey(key: string) {
    navigator.clipboard.writeText(key);
    toast.success(t('invites.copiedSuccess'));
  }

  function getStatus(invite: Record<string, unknown>): { label: string; variant: 'default' | 'secondary' | 'destructive' } {
    if (!invite.is_active) return { label: t('invites.status.inactive'), variant: 'secondary' };
    if (invite.expires_at && new Date(String(invite.expires_at)) < new Date()) return { label: t('invites.status.expired'), variant: 'destructive' };
    if (Number(invite.max_uses) > 0 && Number(invite.current_uses) >= Number(invite.max_uses)) return { label: t('invites.status.depleted'), variant: 'secondary' };
    return { label: t('invites.status.active'), variant: 'default' };
  }

  return (
    <PageWrapper>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('invites.title')}</h1>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />{t('invites.createKey')}
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : invites.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <KeyRound className="h-12 w-12 text-muted-foreground mb-4" />
          <h2 className="text-lg font-medium mb-2">{t('invites.noKeys')}</h2>
          <p className="text-muted-foreground mb-4">{t('invites.noKeysDesc')}</p>
          <Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4 mr-2" />{t('invites.createKey')}</Button>
        </div>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('invites.headers.key')}</TableHead>
                <TableHead>{t('invites.headers.role')}</TableHead>
                <TableHead>{t('invites.headers.uses')}</TableHead>
                <TableHead>{t('invites.headers.status')}</TableHead>
                <TableHead>{t('invites.headers.created')}</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {invites.map((inv) => {
                const status = getStatus(inv);
                return (
                  <TableRow key={String(inv.id)}>
                    <TableCell className="font-mono text-sm">{String(inv.key).slice(0, 12)}...</TableCell>
                    <TableCell><Badge variant="outline">{String(inv.role)}</Badge></TableCell>
                    <TableCell>{String(inv.current_uses)}/{Number(inv.max_uses) || '∞'}</TableCell>
                    <TableCell><Badge variant={status.variant}>{status.label}</Badge></TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(String(inv.created_at)).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => copyKey(String(inv.key))}>
                        <Copy className="h-3 w-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('invites.createDialog.title')}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t('invites.createDialog.role')}</Label>
              <Select value={newInvite.role} onValueChange={(v) => setNewInvite({ ...newInvite, role: v })}>
                <SelectTrigger className="mt-1">{{ admin: 'Admin', editor: 'Editor', viewer: 'Viewer' }[newInvite.role] ?? newInvite.role}</SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="editor">Editor</SelectItem>
                  <SelectItem value="viewer">Viewer</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t('invites.createDialog.maxUses')}</Label>
              <Input type="number" value={newInvite.maxUses} onChange={(e) => setNewInvite({ ...newInvite, maxUses: Number(e.target.value) })} className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
              {createMutation.isPending ? t('invites.createDialog.creating') : t('invites.createDialog.createBtn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageWrapper>
  );
}
