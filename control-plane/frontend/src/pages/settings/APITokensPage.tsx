import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Copy, Key, Shield } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { useCurrentProject } from '@/hooks/useProject';
import { api } from '@/api/client';
import { toast } from 'sonner';
import { usePageTitle } from '@/hooks/usePageTitle';

const SCOPES = ['read', 'write', 'delete', 'admin'] as const;

export function APITokensPage() {
  const { t } = useTranslation('settings');
  usePageTitle(t('tokens.title'));
  const { data: project } = useCurrentProject();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [newToken, setNewToken] = useState({ name: '', scopes: ['read'] as string[] });

  const { data, isLoading } = useQuery({
    queryKey: ['tokens', project?.id],
    queryFn: () => api.get<{ tokens: Record<string, unknown>[] }>(`/projects/${project!.id}/tokens`),
    enabled: !!project?.id,
  });

  const createMutation = useMutation({
    mutationFn: () => api.post<{ token: Record<string, unknown> & { token: string } }>(
      `/projects/${project!.id}/tokens`,
      { name: newToken.name, scopes: newToken.scopes }
    ),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['tokens', project?.id] });
      setRevealedToken(data.token.token as string);
      setCreateOpen(false);
      setNewToken({ name: '', scopes: ['read'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => api.post(`/projects/${project!.id}/tokens/${id}/revoke`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tokens', project?.id] });
      toast.success(t('tokens.revoked'));
    },
  });

  const tokens = data?.tokens ?? [];

  function toggleScope(scope: string) {
    setNewToken((prev) => ({
      ...prev,
      scopes: prev.scopes.includes(scope)
        ? prev.scopes.filter((s) => s !== scope)
        : [...prev.scopes, scope],
    }));
  }

  function copyToken(token: string) {
    navigator.clipboard.writeText(token);
    toast.success(t('tokens.copied'));
  }

  return (
    <PageWrapper>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('tokens.title')}</h1>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />{t('tokens.createToken')}
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : tokens.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Key className="h-12 w-12 text-muted-foreground mb-4" />
          <h2 className="text-lg font-medium mb-2">{t('tokens.noTokens')}</h2>
          <p className="text-muted-foreground mb-4">{t('tokens.noTokensDesc')}</p>
          <Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4 mr-2" />{t('tokens.createToken')}</Button>
        </div>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('tokens.headers.name')}</TableHead>
                <TableHead>{t('tokens.headers.prefix')}</TableHead>
                <TableHead>{t('tokens.headers.scopes')}</TableHead>
                <TableHead>{t('tokens.headers.lastUsed')}</TableHead>
                <TableHead>{t('tokens.headers.status')}</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {tokens.map((tk) => (
                <TableRow key={String(tk.id)}>
                  <TableCell className="font-medium">{String(tk.name)}</TableCell>
                  <TableCell className="font-mono text-sm">{String(tk.prefix)}...</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {(Array.isArray(tk.scopes) ? tk.scopes : JSON.parse(String(tk.scopes)) as string[]).map((s: string) => (
                        <Badge key={s} variant="outline" className="text-[10px]">{s}</Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {tk.last_used_at ? new Date(String(tk.last_used_at)).toLocaleDateString() : t('tokens.status.never')}
                  </TableCell>
                  <TableCell>
                    <Badge variant={tk.is_active ? 'default' : 'secondary'}>
                      {tk.is_active ? t('tokens.status.active') : t('tokens.status.revoked')}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {tk.is_active && (
                      <Button variant="outline" size="sm" onClick={() => revokeMutation.mutate(String(tk.id))}>
                        {t('tokens.revoke')}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('tokens.createDialog.title')}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t('tokens.createDialog.name')}</Label>
              <Input value={newToken.name} onChange={(e) => setNewToken({ ...newToken, name: e.target.value })} placeholder={t('tokens.createDialog.namePlaceholder')} className="mt-1" />
            </div>
            <div>
              <Label>{t('tokens.createDialog.scopes')}</Label>
              <div className="flex gap-4 mt-2">
                {SCOPES.map((s) => (
                  <div key={s} className="flex items-center gap-2">
                    <Checkbox checked={newToken.scopes.includes(s)} onCheckedChange={() => toggleScope(s)} />
                    <Label className="capitalize">{s}</Label>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate()} disabled={!newToken.name || !newToken.scopes.length || createMutation.isPending}>
              {createMutation.isPending ? t('tokens.createDialog.creating') : t('tokens.createDialog.createBtn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!revealedToken} onOpenChange={(o) => !o && setRevealedToken(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('tokens.revealDialog.title')}</DialogTitle>
            <DialogDescription>{t('tokens.revealDialog.desc')}</DialogDescription>
          </DialogHeader>
          <Alert>
            <Shield className="h-4 w-4" />
            <AlertDescription>
              <div className="flex items-center gap-2 mt-1">
                <code className="text-sm bg-muted px-2 py-1 rounded flex-1 break-all">{revealedToken}</code>
                <Button size="icon" variant="outline" onClick={() => copyToken(revealedToken!)}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </AlertDescription>
          </Alert>
          <DialogFooter>
            <Button onClick={() => setRevealedToken(null)}>{t('tokens.done')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageWrapper>
  );
}
