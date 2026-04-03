import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { useCurrentProject, useProjectMembers } from '@/hooks/useProject';
import { projectsApi } from '@/api/projects.api';
import { systemApi } from '@/api/system.api';
import { toast } from 'sonner';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useAuthStore } from '@/stores/auth.store';
import { Plus, Trash2 } from 'lucide-react';

export function UsersPage() {
  const { t } = useTranslation(['settings', 'common']);
  usePageTitle(t('settings:users.title'));
  const user = useAuthStore((s) => s.user);
  const { data: project } = useCurrentProject();
  const queryClient = useQueryClient();
  const { data: members, isLoading } = useProjectMembers(project?.id);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteSearch, setInviteSearch] = useState('');
  const [inviteRole, setInviteRole] = useState('viewer');
  const [removeUserId, setRemoveUserId] = useState<string | null>(null);
  const [removeUserName, setRemoveUserName] = useState('');

  const { data: allUsersData } = useQuery({
    queryKey: ['system-users'],
    queryFn: () => systemApi.getAllUsers(),
    enabled: inviteOpen,
  });

  const allUsers = allUsersData?.users ?? [];
  const memberIds = new Set((members ?? []).map((m) => m.user_id));
  const filteredUsers = allUsers.filter(
    (u: Record<string, unknown>) =>
      !memberIds.has(String(u.id)) &&
      (String(u.name).toLowerCase().includes(inviteSearch.toLowerCase()) ||
        String(u.email).toLowerCase().includes(inviteSearch.toLowerCase())),
  );
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const updateRoleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      projectsApi.updateMemberRole(project!.id, userId, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-members', project?.id] });
      toast.success(t('settings:users.roleUpdated'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const addMemberMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      projectsApi.addMember(project!.id, userId, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-members', project?.id] });
      toast.success(t('settings:users.invited'));
      setInviteOpen(false);
      setInviteSearch('');
      setSelectedUserId(null);
      setInviteRole('viewer');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const removeMemberMutation = useMutation({
    mutationFn: (userId: string) => projectsApi.removeMember(project!.id, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-members', project?.id] });
      toast.success(t('settings:users.removed'));
      setRemoveUserId(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <PageWrapper>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('settings:users.title')}</h1>
        <Button onClick={() => setInviteOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />{t('settings:users.inviteUser')}
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('settings:users.headers.user')}</TableHead>
                <TableHead>{t('settings:users.headers.email')}</TableHead>
                <TableHead>{t('settings:users.headers.role')}</TableHead>
                <TableHead>{t('settings:users.headers.lastActive')}</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(members ?? []).map((m) => (
                <TableRow key={m.user_id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className="text-xs">{m.name.charAt(0).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <span className="font-medium">{m.name}</span>
                      {m.is_superadmin && <Badge variant="outline" className="text-orange-500 border-orange-500/30 text-[10px]">SA</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{m.email}</TableCell>
                  <TableCell>
                    <Select
                      value={m.role}
                      onValueChange={(v) => updateRoleMutation.mutate({ userId: m.user_id, role: v })}
                      disabled={m.user_id === user?.id}
                    >
                      <SelectTrigger className="w-28 h-8">{t(`settings:users.roles.${m.role}`)}</SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">{t('settings:users.roles.admin')}</SelectItem>
                        <SelectItem value="editor">{t('settings:users.roles.editor')}</SelectItem>
                        <SelectItem value="viewer">{t('settings:users.roles.viewer')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {m.last_login_at ? new Date(m.last_login_at).toLocaleDateString() : t('settings:users.never')}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      onClick={() => {
                        setRemoveUserId(m.user_id);
                        setRemoveUserName(m.name);
                      }}
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

      {/* Invite User Dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('settings:users.inviteUser')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t('settings:users.searchUser')}</Label>
              <Input
                value={inviteSearch}
                onChange={(e) => setInviteSearch(e.target.value)}
                placeholder={t('settings:users.searchPlaceholder')}
              />
              {inviteSearch && filteredUsers.length > 0 && (
                <div className="border rounded-lg max-h-40 overflow-y-auto">
                  {filteredUsers.slice(0, 10).map((u: Record<string, unknown>) => (
                    <button
                      key={String(u.id)}
                      className={`w-full text-left px-3 py-2 hover:bg-muted transition-colors flex items-center gap-2 ${selectedUserId === String(u.id) ? 'bg-muted' : ''}`}
                      onClick={() => setSelectedUserId(String(u.id))}
                    >
                      <Avatar className="h-6 w-6">
                        <AvatarFallback className="text-[10px]">{String(u.name).charAt(0).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <div>
                        <span className="text-sm font-medium">{String(u.name)}</span>
                        <span className="text-xs text-muted-foreground ml-2">{String(u.email)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label>{t('settings:users.headers.role')}</Label>
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger>{t(`settings:users.roles.${inviteRole}`)}</SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">{t('settings:users.roles.admin')}</SelectItem>
                  <SelectItem value="editor">{t('settings:users.roles.editor')}</SelectItem>
                  <SelectItem value="viewer">{t('settings:users.roles.viewer')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>{t('common:actions.cancel')}</Button>
            <Button
              onClick={() => {
                if (selectedUserId) {
                  addMemberMutation.mutate({ userId: selectedUserId, role: inviteRole });
                }
              }}
              disabled={!selectedUserId || addMemberMutation.isPending}
            >
              {t('settings:users.inviteBtn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove Member Confirm */}
      <ConfirmDialog
        open={!!removeUserId}
        onOpenChange={(o) => !o && setRemoveUserId(null)}
        title={t('settings:users.removeConfirm.title')}
        description={t('settings:users.removeConfirm.desc', { name: removeUserName })}
        confirmText={t('common:actions.delete')}
        variant="destructive"
        onConfirm={() => { if (removeUserId) removeMemberMutation.mutate(removeUserId); }}
        loading={removeMemberMutation.isPending}
      />
    </PageWrapper>
  );
}
