import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Shield, ShieldOff, UserX, Ban, CheckCircle, Trash2, Save, KeyRound, Copy } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useAuthStore } from '@/stores/auth.store';
import { systemApi } from '@/api/system.api';
import { rolesApi } from '@/api/roles.api';
import { quotasApi } from '@/api/quotas.api';
import { toast } from 'sonner';

const QUOTA_FIELDS = [
  'max_projects', 'max_tables', 'max_records', 'max_api_requests',
  'max_storage_mb', 'max_endpoints', 'max_webhooks', 'max_files',
  'max_backups', 'max_cron', 'max_ai_requests_per_day', 'max_ai_tokens_per_day',
  'max_query_timeout_ms', 'max_concurrent_requests', 'max_rows_per_query', 'max_export_rows',
] as const;

const USAGE_MAP: Record<string, string> = {
  max_projects: 'projects',
  max_ai_requests_per_day: 'ai_requests_today',
  max_ai_tokens_per_day: 'ai_tokens_today',
};

function getProgressColor(pct: number): string {
  if (pct >= 90) return '[&>div]:bg-destructive';
  if (pct >= 70) return '[&>div]:bg-amber-500';
  return '';
}

export function UserDetailPage() {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation(['system', 'common']);
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuthStore();

  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [roleInitialized, setRoleInitialized] = useState(false);
  const [blockReason, setBlockReason] = useState('');
  const [confirmAction, setConfirmAction] = useState<string | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideValues, setOverrideValues] = useState<Record<string, number>>({});
  const [resetPasswordConfirm, setResetPasswordConfirm] = useState(false);
  const [generatedPassword, setGeneratedPassword] = useState<string | null>(null);

  // Queries
  const { data: userData, isLoading: userLoading } = useQuery({
    queryKey: ['system-user', userId],
    queryFn: () => systemApi.getUser(userId!),
    enabled: !!userId,
  });

  const { data: quotaData } = useQuery({
    queryKey: ['user-quota', userId],
    queryFn: () => quotasApi.getUserQuota(userId!),
    enabled: !!userId,
  });

  const { data: projectsData } = useQuery({
    queryKey: ['user-projects', userId],
    queryFn: () => systemApi.getUserProjects(userId!),
    enabled: !!userId,
  });

  const { data: rolesData } = useQuery({
    queryKey: ['custom-roles'],
    queryFn: () => rolesApi.getAll(),
  });

  const user = userData?.user;
  usePageTitle(user ? String(user.name) : t('system:users.title'));

  // Initialize role selection from user data
  if (user && !roleInitialized) {
    setSelectedRoleId(user.role_id ? String(user.role_id) : null);
    setRoleInitialized(true);
  }

  const roles = rolesData?.roles ?? [];
  const quota = quotaData?.quota as Record<string, number> | undefined;
  const usage = quotaData?.usage as Record<string, number> | undefined;
  const quotaSource = (quotaData as Record<string, unknown>)?.source as string | undefined;
  const quotaRoleName = (quotaData as Record<string, unknown>)?.role_name as string | undefined;
  const projects = projectsData?.projects ?? [];
  const isSelf = currentUser?.id === userId;

  // Mutations
  const assignRoleMutation = useMutation({
    mutationFn: () => systemApi.assignRole(userId!, selectedRoleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system-user', userId] });
      queryClient.invalidateQueries({ queryKey: ['user-quota', userId] });
      queryClient.invalidateQueries({ queryKey: ['system-users'] });
      toast.success(t('system:users.detail.roleAssigned'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const blockMutation = useMutation({
    mutationFn: () => systemApi.blockUser(userId!, blockReason || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system-user', userId] });
      queryClient.invalidateQueries({ queryKey: ['system-users'] });
      toast.success(t('system:users.actionCompleted'));
      setBlockReason('');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const unblockMutation = useMutation({
    mutationFn: () => systemApi.unblockUser(userId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system-user', userId] });
      queryClient.invalidateQueries({ queryKey: ['system-users'] });
      toast.success(t('system:users.actionCompleted'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const actionMutation = useMutation({
    mutationFn: async () => {
      if (!confirmAction || !userId) throw new Error('No action');
      switch (confirmAction) {
        case 'promote': return systemApi.promoteUser(userId);
        case 'demote': return systemApi.demoteUser(userId);
        case 'deactivate': return systemApi.deactivateUser(userId);
        case 'delete': {
          await systemApi.deleteUser(userId);
          navigate('/system/users');
          return;
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system-user', userId] });
      queryClient.invalidateQueries({ queryKey: ['system-users'] });
      toast.success(t('system:users.actionCompleted'));
      setConfirmAction(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const saveOverrideMutation = useMutation({
    mutationFn: () => quotasApi.setUserQuota(userId!, overrideValues),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-quota', userId] });
      toast.success(t('system:users.detail.quotaOverrideSaved'));
      setOverrideOpen(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const resetQuotaMutation = useMutation({
    mutationFn: () => quotasApi.deleteUserQuota(userId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-quota', userId] });
      toast.success(t('system:users.detail.quotaReset'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const resetPasswordMutation = useMutation({
    mutationFn: () => systemApi.resetPassword(userId!),
    onSuccess: (data) => {
      setResetPasswordConfirm(false);
      setGeneratedPassword(data.password);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (userLoading) {
    return (
      <PageWrapper>
        <div className="space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-40" />
          <Skeleton className="h-60" />
        </div>
      </PageWrapper>
    );
  }

  if (!user) {
    return (
      <PageWrapper>
        <p className="text-muted-foreground">User not found.</p>
      </PageWrapper>
    );
  }

  return (
    <PageWrapper>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="icon" onClick={() => navigate('/system/users')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-2xl font-bold">{t('system:users.detail.backToUsers')}</h1>
      </div>

      <div className="space-y-6">
        {/* User Info Card */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <Avatar className="h-16 w-16">
                <AvatarFallback className="text-xl">{String(user.name).charAt(0).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="flex-1 space-y-1">
                <h2 className="text-xl font-semibold">{String(user.name)}</h2>
                <p className="text-sm text-muted-foreground">{String(user.email)}</p>
                <div className="flex items-center gap-2 pt-1">
                  {user.is_superadmin && (
                    <Badge className="bg-orange-500/10 text-orange-500 border-orange-500/20" variant="outline">SUPERADMIN</Badge>
                  )}
                  {user.role_name ? (
                    <Badge
                      variant="outline"
                      style={{
                        backgroundColor: `${String(user.role_color)}1A`,
                        color: String(user.role_color),
                        borderColor: `${String(user.role_color)}33`,
                      }}
                    >
                      {String(user.role_name)}
                    </Badge>
                  ) : (
                    <Badge variant="secondary">{t('system:users.detail.noRole')}</Badge>
                  )}
                  {user.blocked_at ? (
                    <Badge variant="destructive">{t('system:users.status.blocked')}</Badge>
                  ) : user.is_active ? (
                    <Badge variant="default">{t('system:users.status.active')}</Badge>
                  ) : (
                    <Badge variant="secondary">{t('system:users.status.inactive')}</Badge>
                  )}
                </div>
              </div>
              <div className="text-right text-sm text-muted-foreground space-y-1">
                <div>{t('system:users.detail.memberSince')}: {new Date(String(user.created_at)).toLocaleDateString()}</div>
                <div>{t('system:users.detail.lastLogin')}: {user.last_login_at ? new Date(String(user.last_login_at)).toLocaleDateString() : t('system:users.status.never')}</div>
                <div>{t('system:users.headers.projects')}: {String(user.projects_count ?? 0)}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Role Assignment */}
        <Card>
          <CardHeader>
            <CardTitle>{t('system:users.detail.roleAssignment')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-3">
              <div className="flex-1 space-y-2">
                <Label>{t('system:users.detail.assignRole')}</Label>
                <Select
                  value={selectedRoleId ?? '__none__'}
                  onValueChange={(v) => setSelectedRoleId(v === '__none__' ? null : v)}
                >
                  <SelectTrigger>
                    {selectedRoleId && roles.find(r => r.id === selectedRoleId) ? (
                      <div className="flex items-center gap-2">
                        <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: roles.find(r => r.id === selectedRoleId)?.color }} />
                        {roles.find(r => r.id === selectedRoleId)?.name}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">{t('system:users.detail.noRole')}</span>
                    )}
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{t('system:users.detail.noRole')}</SelectItem>
                    {roles.map((role) => (
                      <SelectItem key={role.id} value={role.id}>
                        <div className="flex items-center gap-2">
                          <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: role.color }} />
                          {role.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={() => assignRoleMutation.mutate()}
                disabled={assignRoleMutation.isPending}
              >
                <Save className="h-4 w-4 mr-2" />
                {t('common:actions.save')}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Quota Overview */}
        {quota && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>{t('system:users.detail.quotaOverview')}</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    {quotaSource === 'user_override'
                      ? t('system:users.detail.quotaSource.override')
                      : quotaSource === 'role'
                        ? t('system:users.detail.quotaSource.role', { name: quotaRoleName })
                        : t('system:users.detail.quotaSource.default')}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const vals: Record<string, number> = {};
                      for (const f of QUOTA_FIELDS) vals[f] = quota[f] ?? 0;
                      setOverrideValues(vals);
                      setOverrideOpen(true);
                    }}
                  >
                    {t('system:users.detail.overrideQuotas')}
                  </Button>
                  {quotaSource === 'user_override' && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => resetQuotaMutation.mutate()}
                      disabled={resetQuotaMutation.isPending}
                    >
                      {t('system:users.detail.resetToRole')}
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {QUOTA_FIELDS.map((field) => {
                  const limit = quota[field] ?? 0;
                  const usageKey = USAGE_MAP[field] || field.replace('max_', '');
                  const used = usage?.[usageKey] ?? 0;
                  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;

                  return (
                    <div key={field} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span>{t(`system:roles.quotaFields.${field}`)}</span>
                        <span className="text-muted-foreground">{used} / {limit}</span>
                      </div>
                      <Progress value={pct} className={`h-2 ${getProgressColor(pct)}`} />
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Block / Security */}
        <Card>
          <CardHeader>
            <CardTitle>{t('system:users.detail.blockSecurity')}</CardTitle>
          </CardHeader>
          <CardContent>
            {user.blocked_at ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Badge variant="destructive">{t('system:users.status.blocked')}</Badge>
                  <span className="text-sm text-muted-foreground">
                    {new Date(String(user.blocked_at)).toLocaleDateString()}
                  </span>
                </div>
                {user.block_reason && (
                  <p className="text-sm"><span className="font-medium">{t('system:users.detail.blockReason')}:</span> {String(user.block_reason)}</p>
                )}
                <Button onClick={() => unblockMutation.mutate()} disabled={unblockMutation.isPending}>
                  <CheckCircle className="h-4 w-4 mr-2" />
                  {t('system:users.unblock')}
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label>{t('system:users.detail.blockReason')}</Label>
                  <Textarea
                    value={blockReason}
                    onChange={(e) => setBlockReason(e.target.value)}
                    placeholder={t('system:users.detail.blockReasonPlaceholder')}
                    rows={2}
                  />
                </div>
                <Button
                  variant="destructive"
                  onClick={() => blockMutation.mutate()}
                  disabled={isSelf || blockMutation.isPending}
                >
                  <Ban className="h-4 w-4 mr-2" />
                  {t('system:users.block')}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* User Projects */}
        <Card>
          <CardHeader>
            <CardTitle>{t('system:users.detail.userProjects')}</CardTitle>
          </CardHeader>
          <CardContent>
            {projects.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('system:users.detail.noProjects')}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('system:users.detail.projectName')}</TableHead>
                    <TableHead>{t('system:users.detail.projectRole')}</TableHead>
                    <TableHead>{t('system:users.detail.joinedAt')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {projects.map((p) => (
                    <TableRow key={p.project_id}>
                      <TableCell>
                        <Link to={`/${p.project_slug}`} className="text-primary hover:underline font-medium">
                          {p.project_name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{p.role}</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(p.joined_at).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Admin Actions */}
        {!isSelf && (
          <Card>
            <CardHeader>
              <CardTitle>{t('system:users.detail.adminActions')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-3">
                {!user.is_superadmin ? (
                  <Button variant="outline" onClick={() => setConfirmAction('promote')}>
                    <Shield className="h-4 w-4 mr-2" />{t('system:users.promote')}
                  </Button>
                ) : (
                  <Button variant="outline" onClick={() => setConfirmAction('demote')}>
                    <ShieldOff className="h-4 w-4 mr-2" />{t('system:users.demote')}
                  </Button>
                )}
                {user.is_active && (
                  <Button variant="outline" onClick={() => setConfirmAction('deactivate')}>
                    <UserX className="h-4 w-4 mr-2" />{t('system:users.deactivate')}
                  </Button>
                )}
                <Button variant="outline" onClick={() => setResetPasswordConfirm(true)}>
                  <KeyRound className="h-4 w-4 mr-2" />{t('system:users.detail.resetPassword')}
                </Button>
                <Button variant="destructive" onClick={() => setConfirmAction('delete')}>
                  <Trash2 className="h-4 w-4 mr-2" />{t('system:users.deleteUser')}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Override Quotas Dialog */}
      <Dialog open={overrideOpen} onOpenChange={setOverrideOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('system:users.detail.overrideQuotas')}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            {QUOTA_FIELDS.map((field) => (
              <div key={field} className="space-y-1">
                <Label className="text-xs">{t(`system:roles.quotaFields.${field}`)}</Label>
                <Input
                  type="number"
                  min={0}
                  value={overrideValues[field] ?? ''}
                  onChange={(e) => setOverrideValues(prev => ({ ...prev, [field]: Number(e.target.value) }))}
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverrideOpen(false)}>{t('common:actions.cancel')}</Button>
            <Button onClick={() => saveOverrideMutation.mutate()} disabled={saveOverrideMutation.isPending}>
              {t('common:actions.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Password Confirm */}
      <ConfirmDialog
        open={resetPasswordConfirm}
        onOpenChange={setResetPasswordConfirm}
        title={t('system:users.detail.resetPassword')}
        description={t('system:users.detail.resetPasswordConfirm')}
        confirmText={t('system:users.detail.resetPassword')}
        variant="default"
        onConfirm={() => resetPasswordMutation.mutate()}
        loading={resetPasswordMutation.isPending}
      />

      {/* Generated Password Dialog */}
      <Dialog open={!!generatedPassword} onOpenChange={(o) => !o && setGeneratedPassword(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('system:users.detail.newPassword')}</DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input readOnly value={generatedPassword ?? ''} className="font-mono" />
            <Button
              variant="outline"
              size="icon"
              onClick={() => {
                navigator.clipboard.writeText(generatedPassword ?? '');
                toast.success(t('system:users.detail.passwordCopied'));
              }}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setGeneratedPassword(null)}>{t('common:actions.close')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm Action Dialog */}
      <ConfirmDialog
        open={!!confirmAction}
        onOpenChange={(o) => !o && setConfirmAction(null)}
        title={confirmAction ? t(`system:users.confirmActions.${confirmAction}`) : ''}
        description={t('system:users.confirmActions.desc', { action: confirmAction, name: user.name })}
        confirmText={confirmAction === 'deactivate' ? t('system:users.confirmActions.deactivateConfirm') : t('system:users.confirmActions.confirm')}
        variant={['deactivate', 'delete'].includes(confirmAction ?? '') ? 'destructive' : 'default'}
        onConfirm={() => actionMutation.mutate()}
        loading={actionMutation.isPending}
      />
    </PageWrapper>
  );
}
