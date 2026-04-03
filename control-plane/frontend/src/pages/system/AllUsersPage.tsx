import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Plus, Shield, ShieldOff, UserX, Ban, CheckCircle, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { useAuthStore } from '@/stores/auth.store';
import { systemApi } from '@/api/system.api';
import { toast } from 'sonner';
import { usePageTitle } from '@/hooks/usePageTitle';

export function AllUsersPage() {
  const { t } = useTranslation(['system', 'common']);
  usePageTitle(t('users.title'));
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { user: currentUser } = useAuthStore();
  const [createOpen, setCreateOpen] = useState(false);
  const [newUser, setNewUser] = useState({ name: '', email: '', password: '' });
  const [confirmAction, setConfirmAction] = useState<{ type: string; userId: string; name: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['system-users'],
    queryFn: () => systemApi.getAllUsers(),
  });

  const createMutation = useMutation({
    mutationFn: () => systemApi.createUser(newUser),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system-users'] });
      toast.success(t('system:users.created'));
      setCreateOpen(false);
      setNewUser({ name: '', email: '', password: '' });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const actionMutation = useMutation({
    mutationFn: async () => {
      if (!confirmAction) throw new Error('No action');
      switch (confirmAction.type) {
        case 'promote': return systemApi.promoteUser(confirmAction.userId);
        case 'demote': return systemApi.demoteUser(confirmAction.userId);
        case 'deactivate': return systemApi.deactivateUser(confirmAction.userId);
        case 'block': return systemApi.blockUser(confirmAction.userId);
        case 'unblock': return systemApi.unblockUser(confirmAction.userId);
        case 'delete': return systemApi.deleteUser(confirmAction.userId);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system-users'] });
      toast.success(t('system:users.actionCompleted'));
      setConfirmAction(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const users = data?.users ?? [];

  return (
    <PageWrapper>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('system:users.title')}</h1>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />{t('system:users.createUser')}
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('system:users.headers.user')}</TableHead>
                <TableHead>{t('system:users.headers.email')}</TableHead>
                <TableHead>{t('system:users.headers.role')}</TableHead>
                <TableHead>{t('system:users.headers.invitedBy')}</TableHead>
                <TableHead>{t('system:users.headers.projects')}</TableHead>
                <TableHead>{t('system:users.headers.lastLogin')}</TableHead>
                <TableHead>{t('system:users.headers.status')}</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u: Record<string, unknown>) => (
                <TableRow
                  key={String(u.id)}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => navigate(`/system/users/${u.id}`)}
                >
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className="text-xs">{String(u.name).charAt(0).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <span className="font-medium">{String(u.name)}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{String(u.email)}</TableCell>
                  <TableCell>
                    {u.is_superadmin ? (
                      <Badge className="bg-orange-500/10 text-orange-500 border-orange-500/20" variant="outline">
                        {t('system:users.roleSuperadmin')}
                      </Badge>
                    ) : u.role_name ? (
                      <Badge
                        variant="outline"
                        style={{
                          backgroundColor: `${String(u.role_color)}1A`,
                          color: String(u.role_color),
                          borderColor: `${String(u.role_color)}33`,
                        }}
                      >
                        {String(u.role_name)}
                      </Badge>
                    ) : (
                      <span className="text-sm text-muted-foreground">{t('system:users.detail.noRole')}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {u.invited_by_name ? String(u.invited_by_name) : '-'}
                  </TableCell>
                  <TableCell>{String(u.projects_count ?? 0)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {u.last_login_at ? new Date(String(u.last_login_at)).toLocaleDateString() : t('system:users.status.never')}
                  </TableCell>
                  <TableCell>
                    {u.blocked_at ? (
                      <Badge variant="destructive">{t('system:users.status.blocked')}</Badge>
                    ) : u.is_active ? (
                      <Badge variant="default">{t('system:users.status.active')}</Badge>
                    ) : (
                      <Badge variant="secondary">{t('system:users.status.inactive')}</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {String(u.id) !== currentUser?.id && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" onClick={(e) => e.stopPropagation()}>
                            {t('system:users.actions')}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                          {!u.is_superadmin && (
                            <DropdownMenuItem onClick={() => setConfirmAction({ type: 'promote', userId: String(u.id), name: String(u.name) })}>
                              <Shield className="h-4 w-4 mr-2" />{t('system:users.promote')}
                            </DropdownMenuItem>
                          )}
                          {u.is_superadmin && (
                            <DropdownMenuItem onClick={() => setConfirmAction({ type: 'demote', userId: String(u.id), name: String(u.name) })}>
                              <ShieldOff className="h-4 w-4 mr-2" />{t('system:users.demote')}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          {!u.blocked_at ? (
                            <DropdownMenuItem onClick={() => setConfirmAction({ type: 'block', userId: String(u.id), name: String(u.name) })}>
                              <Ban className="h-4 w-4 mr-2" />{t('system:users.block')}
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem onClick={() => setConfirmAction({ type: 'unblock', userId: String(u.id), name: String(u.name) })}>
                              <CheckCircle className="h-4 w-4 mr-2" />{t('system:users.unblock')}
                            </DropdownMenuItem>
                          )}
                          {u.is_active && (
                            <DropdownMenuItem className="text-destructive" onClick={() => setConfirmAction({ type: 'deactivate', userId: String(u.id), name: String(u.name) })}>
                              <UserX className="h-4 w-4 mr-2" />{t('system:users.deactivate')}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive" onClick={() => setConfirmAction({ type: 'delete', userId: String(u.id), name: String(u.name) })}>
                            <Trash2 className="h-4 w-4 mr-2" />{t('system:users.deleteUser')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Create User Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('system:users.createDialog.title')}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>{t('system:users.createDialog.name')}</Label><Input value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.target.value })} className="mt-1" /></div>
            <div><Label>{t('system:users.createDialog.email')}</Label><Input type="email" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} className="mt-1" /></div>
            <div><Label>{t('system:users.createDialog.password')}</Label><Input type="password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} className="mt-1" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{t('common:actions.cancel')}</Button>
            <Button onClick={() => createMutation.mutate()} disabled={!newUser.name || !newUser.email || !newUser.password || createMutation.isPending}>
              {createMutation.isPending ? t('system:users.createDialog.creating') : t('system:users.createDialog.createBtn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!confirmAction}
        onOpenChange={(o) => !o && setConfirmAction(null)}
        title={confirmAction ? t(`system:users.confirmActions.${confirmAction.type}`) : ''}
        description={t('system:users.confirmActions.desc', { action: confirmAction?.type, name: confirmAction?.name })}
        confirmText={confirmAction?.type === 'deactivate' ? t('system:users.confirmActions.deactivateConfirm') : t('system:users.confirmActions.confirm')}
        variant={['deactivate', 'block', 'delete'].includes(confirmAction?.type ?? '') ? 'destructive' : 'default'}
        onConfirm={() => actionMutation.mutate()}
        loading={actionMutation.isPending}
      />
    </PageWrapper>
  );
}
