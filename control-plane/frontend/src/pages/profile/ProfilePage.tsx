import { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useAuthStore } from '@/stores/auth.store';
import { quotasApi } from '@/api/quotas.api';
import { projectsApi } from '@/api/projects.api';
import { authApi } from '@/api/auth.api';
import { api } from '@/api/client';
import { toast } from 'sonner';
import { User, Shield, BarChart3, FolderKanban, Server, Info, CheckCircle2, XCircle } from 'lucide-react';

export function ProfilePage() {
  const { t } = useTranslation(['common', 'settings', 'system']);
  usePageTitle(t('common:nav.profile'));
  const { user } = useAuthStore();
  const queryClient = useQueryClient();

  const [name, setName] = useState(user?.name ?? '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

  const [setupStep, setSetupStep] = useState<'idle' | 'password' | 'qr' | 'done'>('idle');
  const [setupData, setSetupData] = useState<{ secret: string; uri: string; backup_codes: string[] } | null>(null);
  const [verifyCode, setVerifyCode] = useState('');
  const [setupPassword, setSetupPassword] = useState('');
  const [disablePassword, setDisablePassword] = useState('');
  const [showDisable, setShowDisable] = useState(false);
  const is2FAEnabled = user?.totp_enabled ?? false;

  // Quotas
  const { data: quotaData } = useQuery({
    queryKey: ['quotas', 'me'],
    queryFn: () => quotasApi.getMyQuota(),
  });

  // Projects
  const { data: projectsData } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const data = await projectsApi.list();
      return data.projects;
    },
  });

  // Update name
  const updateNameMutation = useMutation({
    mutationFn: () => api.put(`/users/${user?.id}`, { name }),
    onSuccess: () => {
      toast.success(t('common:profile.nameSaved'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Change password
  const changePasswordMutation = useMutation({
    mutationFn: () =>
      api.post('/auth/change-password', {
        currentPassword,
        newPassword,
      }),
    onSuccess: () => {
      toast.success(t('common:profile.passwordChanged'));
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const setupMutation = useMutation({
    mutationFn: (password: string) => authApi.twoFASetup(password),
    onSuccess: (data) => {
      setSetupData(data);
      setSetupStep('qr');
      setSetupPassword('');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const verifySetupMutation = useMutation({
    mutationFn: () => authApi.twoFAVerifySetup(verifyCode),
    onSuccess: () => {
      setSetupStep('done');
      setVerifyCode('');
      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
      toast.success(t('common:profile.twofa.enabled'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const disableMutation = useMutation({
    mutationFn: () => authApi.twoFADisable(disablePassword),
    onSuccess: () => {
      setShowDisable(false);
      setDisablePassword('');
      setSetupStep('idle');
      setSetupData(null);
      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
      toast.success(t('common:profile.twofa.disabled'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleChangePassword = () => {
    if (newPassword !== confirmNewPassword) {
      toast.error(t('common:errors.passwordMatch'));
      return;
    }
    if (newPassword.length < 6) {
      toast.error(t('common:errors.passwordMin'));
      return;
    }
    changePasswordMutation.mutate();
  };

  const quotaFields = [
    'max_projects',
  ];

  const quotaKeyMap: Record<string, string> = {
    max_projects: 'maxProjects',
  };

  const initials = user?.name
    ? user.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
    : '?';

  return (
    <PageWrapper>
      <h1 className="text-2xl font-bold mb-6">{t('common:profile.title')}</h1>

      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general">
            <User className="h-4 w-4 mr-1" />
            {t('common:profile.tabs.general')}
          </TabsTrigger>
          <TabsTrigger value="security">
            <Shield className="h-4 w-4 mr-1" />
            {t('common:profile.tabs.security')}
          </TabsTrigger>
          <TabsTrigger value="quotas">
            <BarChart3 className="h-4 w-4 mr-1" />
            {t('common:profile.tabs.quotas')}
          </TabsTrigger>
          <TabsTrigger value="projects">
            <FolderKanban className="h-4 w-4 mr-1" />
            {t('common:profile.tabs.projects')}
          </TabsTrigger>
        </TabsList>

        {/* General Tab */}
        <TabsContent value="general" className="space-y-6 mt-4">
          <Card>
            <CardHeader>
              <CardTitle>{t('common:profile.general')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4 mb-4">
                <Avatar className="h-16 w-16">
                  <AvatarFallback className="text-lg bg-primary/20 text-primary">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="text-lg font-medium">{user?.name}</p>
                  <p className="text-sm text-muted-foreground">{user?.email}</p>
                </div>
              </div>
              <Separator />
              <div className="space-y-2">
                <Label htmlFor="profile-name">{t('common:profile.name')}</Label>
                <Input
                  id="profile-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>{t('common:profile.email')}</Label>
                <Input value={user?.email ?? ''} disabled />
                <p className="text-xs text-muted-foreground">{t('common:profile.emailReadonly')}</p>
              </div>
              <Button
                onClick={() => updateNameMutation.mutate()}
                disabled={updateNameMutation.isPending}
              >
                {t('common:actions.save')}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Security Tab */}
        <TabsContent value="security" className="space-y-6 mt-4">
          <Card>
            <CardHeader>
              <CardTitle>{t('common:profile.changePassword')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="current-password">{t('common:profile.currentPassword')}</Label>
                <Input
                  id="current-password"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-password">{t('common:profile.newPassword')}</Label>
                <Input
                  id="new-password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-new-password">{t('common:profile.confirmNewPassword')}</Label>
                <Input
                  id="confirm-new-password"
                  type="password"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                />
              </div>
              <Button
                onClick={handleChangePassword}
                disabled={changePasswordMutation.isPending || !currentPassword || !newPassword}
              >
                {t('common:profile.changePassword')}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                {t('common:profile.twofa.title')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Status */}
              <div className="flex items-center gap-2">
                {is2FAEnabled ? (
                  <>
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                    <span className="font-medium">{t('common:profile.twofa.enabled')}</span>
                    <Badge variant="outline" className="border-green-500/50 text-green-500">
                      {t('common:profile.twofa.enabled')}
                    </Badge>
                  </>
                ) : (
                  <>
                    <XCircle className="h-5 w-5 text-muted-foreground" />
                    <span className="text-muted-foreground">{t('common:profile.twofa.disabled')}</span>
                  </>
                )}
              </div>

              {/* Enable flow */}
              {!is2FAEnabled && setupStep === 'idle' && (
                <Button onClick={() => setSetupStep('password')}>
                  {t('common:profile.twofa.enable')}
                </Button>
              )}

              {!is2FAEnabled && setupStep === 'password' && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">{t('common:profile.twofa.enterPassword')}</p>
                  <Input
                    type="password"
                    placeholder={t('common:profile.currentPassword')}
                    value={setupPassword}
                    onChange={(e) => setSetupPassword(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && setupPassword && setupMutation.mutate(setupPassword)}
                  />
                  <div className="flex gap-2">
                    <Button onClick={() => setupMutation.mutate(setupPassword)} disabled={!setupPassword || setupMutation.isPending}>
                      {setupMutation.isPending ? '...' : t('common:profile.twofa.confirm')}
                    </Button>
                    <Button variant="outline" onClick={() => { setSetupStep('idle'); setSetupPassword(''); }}>
                      {t('common:cancel')}
                    </Button>
                  </div>
                </div>
              )}

              {!is2FAEnabled && setupStep === 'qr' && setupData && (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">{t('common:profile.twofa.scanQr')}</p>

                  <QRCodeCanvas uri={setupData.uri} />

                  <div className="p-3 bg-muted rounded-lg">
                    <p className="text-xs text-muted-foreground mb-1">Secret key (manual entry)</p>
                    <code className="text-sm font-mono">{setupData.secret}</code>
                  </div>

                  {/* Backup codes */}
                  <div className="space-y-2">
                    <p className="text-sm font-medium">{t('common:profile.twofa.backupCodes')}</p>
                    <p className="text-xs text-muted-foreground">{t('common:profile.twofa.backupDesc')}</p>
                    <div className="grid grid-cols-2 gap-2 p-3 bg-muted rounded-lg">
                      {setupData.backup_codes.map((code, i) => (
                        <code key={i} className="text-sm font-mono">
                          {code}
                        </code>
                      ))}
                    </div>
                  </div>

                  {/* Verify */}
                  <div className="space-y-2">
                    <Label htmlFor="verify-code">{t('common:profile.twofa.enterCode')}</Label>
                    <Input
                      id="verify-code"
                      value={verifyCode}
                      onChange={(e) => setVerifyCode(e.target.value)}
                      placeholder="000000"
                      maxLength={6}
                      className="max-w-xs"
                    />
                  </div>

                  <Button
                    onClick={() => verifySetupMutation.mutate()}
                    disabled={verifySetupMutation.isPending || !verifyCode}
                  >
                    {verifySetupMutation.isPending ? '...' : t('common:profile.twofa.enable')}
                  </Button>
                </div>
              )}

              {setupStep === 'done' && !is2FAEnabled && (
                <p className="text-sm text-green-500">{t('common:profile.twofa.enabled')}</p>
              )}

              {/* Disable flow */}
              {is2FAEnabled && !showDisable && (
                <Button variant="destructive" onClick={() => setShowDisable(true)}>
                  {t('common:profile.twofa.disable')}
                </Button>
              )}

              {is2FAEnabled && showDisable && (
                <div className="space-y-3 p-4 border border-destructive/50 rounded-lg">
                  <Label htmlFor="disable-password">{t('common:profile.twofa.confirmPassword')}</Label>
                  <Input
                    id="disable-password"
                    type="password"
                    value={disablePassword}
                    onChange={(e) => setDisablePassword(e.target.value)}
                    placeholder="Password"
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="destructive"
                      onClick={() => disableMutation.mutate()}
                      disabled={disableMutation.isPending || !disablePassword}
                    >
                      {disableMutation.isPending ? '...' : t('common:profile.twofa.disable')}
                    </Button>
                    <Button variant="outline" onClick={() => { setShowDisable(false); setDisablePassword(''); }}>
                      {t('common:profile.twofa.cancel')}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Quotas Tab */}
        <TabsContent value="quotas" className="space-y-6 mt-4">
          {/* Personal Node hint */}
          <Card className="overflow-hidden border-primary/20 bg-primary/5 p-4">
            <CardContent className="p-0">
              <div className="flex items-start gap-4">
                <div className="rounded-lg bg-primary/10 p-2.5">
                  <Server className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="font-medium text-sm">{t('common:profile.personalNodeTitle')}</p>
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                      {t('common:profile.personalNodeBadge')}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {t('common:profile.personalNodeDesc')}
                  </p>
                  <Button size="sm" className="mt-3" asChild>
                    <Link to="/settings/my-nodes">{t('common:profile.personalNodeBtn')}</Link>
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('common:profile.quotasTitle')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {quotaData ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {quotaFields.map((field) => {
                      const max = quotaData.quota?.[field] ?? 0;
                      const usageKey = field.replace(/^max_/, '');
                      const used = quotaData.usage?.[usageKey] ?? 0;
                      const pct = max > 0 ? Math.min((used / max) * 100, 100) : 0;
                      return (
                        <div key={field} className="space-y-1">
                          <div className="flex items-center justify-between text-sm">
                            <span>{t(`system:globalSettings.quotas.${quotaKeyMap[field]}`)}</span>
                            <span className="text-muted-foreground">
                              {used}/{max === 0 ? '\u221E' : max}
                            </span>
                          </div>
                          <Progress value={pct} className="h-2" />
                        </div>
                      );
                    })}
                  </div>

                  {/* Resource quotas note */}
                  <Separator />
                  <div className="flex items-start gap-2 p-3 rounded-md bg-muted/50">
                    <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                    <p className="text-sm text-muted-foreground">
                      {t('common:profile.resourcesMovedNote')}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground">{t('common:actions.loading')}</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Projects Tab */}
        <TabsContent value="projects" className="space-y-6 mt-4">
          <Card>
            <CardHeader>
              <CardTitle>{t('common:profile.projectsList')}</CardTitle>
            </CardHeader>
            <CardContent>
              {projectsData && projectsData.length > 0 ? (
                <div className="space-y-2">
                  {projectsData.map((p) => (
                    <div key={p.id} className="flex items-center justify-between p-3 rounded-lg border">
                      <div>
                        <p className="font-medium">{p.name}</p>
                        <p className="text-sm text-muted-foreground">{p.slug}</p>
                      </div>
                      <Badge variant="outline">
                        {p.user_role ?? 'member'}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground">{t('common:profile.noProjects')}</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </PageWrapper>
  );
}

function QRCodeCanvas({ uri }: { uri: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current && uri) {
      QRCode.toCanvas(canvasRef.current, uri, {
        width: 200,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
      }).catch(() => {});
    }
  }, [uri]);

  return (
    <div className="flex justify-center p-4 bg-white rounded-lg w-fit">
      <canvas ref={canvasRef} />
    </div>
  );
}
