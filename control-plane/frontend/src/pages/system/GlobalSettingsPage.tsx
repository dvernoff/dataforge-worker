import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Download, Upload } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { usePageTitle } from '@/hooks/usePageTitle';
import { toast } from 'sonner';
import { rolesApi } from '@/api/roles.api';
import { projectPlansApi } from '@/api/project-quotas.api';
import { api } from '@/api/client';

export function GlobalSettingsPage() {
  const { t } = useTranslation('system');
  usePageTitle(t('globalSettings.title'));
  const queryClient = useQueryClient();

  // General
  const [instanceName, setInstanceName] = useState('');
  const [instanceUrl, setInstanceUrl] = useState('');

  // Auth Defaults
  const [sessionTtl, setSessionTtl] = useState(60);
  const [minPasswordLength, setMinPasswordLength] = useState(8);

  // Rate Limiting
  const [defaultRateLimit, setDefaultRateLimit] = useState(100);
  const [rateLimitWindow, setRateLimitWindow] = useState('60000');

  // Security
  const [maxBodySize, setMaxBodySize] = useState(10);
  const [secRateLimitMax, setSecRateLimitMax] = useState(100);
  const [secRateLimitWindow, setSecRateLimitWindow] = useState('60000');
  const [bruteForceMax, setBruteForceMax] = useState(5);
  const [bruteForceLockout, setBruteForceLockout] = useState(15);
  const [corsOrigin, setCorsOrigin] = useState('');

  // Alerts
  const [failedLoginThreshold, setFailedLoginThreshold] = useState(10);
  const [alertEmail, setAlertEmail] = useState('');
  const [enableAlerts, setEnableAlerts] = useState(false);

  // Data Retention
  const [auditRetentionDays, setAuditRetentionDays] = useState(30);
  const [requestRetentionDays, setRequestRetentionDays] = useState(30);
  const [backupRetentionDays, setBackupRetentionDays] = useState(14);
  // Maintenance Mode
  const [maintenanceMode, setMaintenanceMode] = useState(false);

  // Defaults
  const [defaultProjectPlan, setDefaultProjectPlan] = useState('Basic');

  // Registration Settings
  const [registrationEnabled, setRegistrationEnabled] = useState(true);
  const [requireInvite, setRequireInvite] = useState(true);
  const [defaultRole, setDefaultRole] = useState('');
  const [maxUsersLimit, setMaxUsersLimit] = useState(0);

  // Fetch system settings
  const { data: systemSettings } = useQuery({
    queryKey: ['system-settings'],
    queryFn: () => api.get<{ settings: Record<string, string> }>('/system/settings'),
  });

  // Fetch roles for default role selector
  const { data: rolesData } = useQuery({
    queryKey: ['custom-roles'],
    queryFn: () => rolesApi.getAll(),
  });

  // Fetch project plans
  const { data: plansData } = useQuery({
    queryKey: ['project-plans'],
    queryFn: () => projectPlansApi.getAll(),
  });

  useEffect(() => {
    if (systemSettings?.settings) {
      const s = systemSettings.settings;
      setRegistrationEnabled(s.registration_enabled !== 'false');
      setRequireInvite(s.require_invite !== 'false');
      setDefaultRole(s.default_role ?? '');
      setMaxUsersLimit(Number(s.max_users ?? '0'));
      if (s.audit_retention_days) setAuditRetentionDays(Number(s.audit_retention_days));
      if (s.request_retention_days) setRequestRetentionDays(Number(s.request_retention_days));
      if (s.backup_retention_days) setBackupRetentionDays(Number(s.backup_retention_days));
      if (s.default_project_plan) setDefaultProjectPlan(s.default_project_plan);
    }
  }, [systemSettings]);

  const saveSettingsMutation = useMutation({
    mutationFn: (data: Record<string, string>) =>
      api.put('/system/settings', { settings: data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system-settings'] });
      toast.success(t('globalSettings.saved'));
    },
  });

  const handleSaveRegistration = () => {
    saveSettingsMutation.mutate({
      registration_enabled: String(registrationEnabled),
      require_invite: String(requireInvite),
      default_role: defaultRole,
      max_users: String(maxUsersLimit),
    });
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    toast.success(t('globalSettings.saved'));
  };

  const roles = rolesData?.roles ?? [];
  const selectedRole = roles.find(r => r.id === defaultRole);

  return (
    <PageWrapper>
      <h1 className="text-2xl font-bold mb-6">{t('globalSettings.title')}</h1>

      <form onSubmit={handleSave} className="space-y-6">
        {/* General */}
        <Card>
          <CardHeader>
            <CardTitle>{t('globalSettings.general')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="instance-name">{t('globalSettings.instanceName')}</Label>
              <Input
                id="instance-name"
                value={instanceName}
                onChange={(e) => setInstanceName(e.target.value)}
                placeholder={t('globalSettings.instanceNamePlaceholder')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="instance-url">{t('globalSettings.instanceUrl')}</Label>
              <Input
                id="instance-url"
                value={instanceUrl}
                onChange={(e) => setInstanceUrl(e.target.value)}
                placeholder="https://example.com"
              />
            </div>
          </CardContent>
        </Card>

        {/* Auth Defaults */}
        <Card>
          <CardHeader>
            <CardTitle>{t('globalSettings.authDefaults')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="session-ttl">{t('globalSettings.sessionTtl')}</Label>
              <Input
                id="session-ttl"
                type="number"
                min={1}
                value={sessionTtl}
                onChange={(e) => setSessionTtl(Number(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="min-password-length">{t('globalSettings.minPasswordLength')}</Label>
              <Input
                id="min-password-length"
                type="number"
                min={1}
                value={minPasswordLength}
                onChange={(e) => setMinPasswordLength(Number(e.target.value))}
              />
            </div>
          </CardContent>
        </Card>

        {/* Registration */}
        <Card>
          <CardHeader>
            <CardTitle>{t('globalSettings.registration.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="registration-enabled">{t('globalSettings.registration.enableRegistration')}</Label>
                <p className="text-sm text-muted-foreground">{t('globalSettings.registration.enableRegistrationDesc')}</p>
              </div>
              <Switch
                id="registration-enabled"
                checked={registrationEnabled}
                onCheckedChange={setRegistrationEnabled}
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="require-invite">{t('globalSettings.registration.requireInvite')}</Label>
                <p className="text-sm text-muted-foreground">{t('globalSettings.registration.requireInviteDesc')}</p>
              </div>
              <Switch
                id="require-invite"
                checked={requireInvite}
                onCheckedChange={setRequireInvite}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="default-role">{t('globalSettings.registration.defaultRole')}</Label>
              {roles.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('globalSettings.registration.noRolesWarning')}</p>
              ) : (
                <Select value={defaultRole} onValueChange={setDefaultRole}>
                  <SelectTrigger id="default-role">
                    {selectedRole ? (
                      <div className="flex items-center gap-2">
                        <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: selectedRole.color }} />
                        {selectedRole.name}
                      </div>
                    ) : (
                      <SelectValue placeholder={t('globalSettings.registration.defaultRole')} />
                    )}
                  </SelectTrigger>
                  <SelectContent>
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
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="max-users">{t('globalSettings.registration.maxUsers')}</Label>
              <Input
                id="max-users"
                type="number"
                min={0}
                value={maxUsersLimit}
                onChange={(e) => setMaxUsersLimit(Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">{t('globalSettings.registration.maxUsersHint')}</p>
            </div>
            <Button type="button" onClick={handleSaveRegistration} disabled={saveSettingsMutation.isPending}>
              {t('globalSettings.save')}
            </Button>
          </CardContent>
        </Card>

        {/* Defaults for new projects */}
        <Card>
          <CardHeader>
            <CardTitle>{t('globalSettings.defaults.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{t('globalSettings.defaults.description')}</p>
            <div className="space-y-2">
              <Label>{t('globalSettings.defaults.defaultProjectPlan')}</Label>
              <Select value={defaultProjectPlan} onValueChange={setDefaultProjectPlan}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(plansData?.plans ?? []).map((plan) => (
                    <SelectItem key={plan.id} value={plan.name}>
                      <span className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: plan.color }} />
                        {plan.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => saveSettingsMutation.mutate({ default_project_plan: defaultProjectPlan })} disabled={saveSettingsMutation.isPending}>
              {t('globalSettings.save')}
            </Button>
          </CardContent>
        </Card>

        {/* Rate Limiting */}
        <Card>
          <CardHeader>
            <CardTitle>{t('globalSettings.rateLimiting')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="default-rate-limit">{t('globalSettings.defaultRateLimit')}</Label>
              <Input
                id="default-rate-limit"
                type="number"
                min={1}
                value={defaultRateLimit}
                onChange={(e) => setDefaultRateLimit(Number(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rate-limit-window">{t('globalSettings.rateLimitWindow')}</Label>
              <Select value={rateLimitWindow} onValueChange={setRateLimitWindow}>
                <SelectTrigger id="rate-limit-window">
                  {{ '1000': '1s (1000ms)', '10000': '10s (10000ms)', '60000': '1m (60000ms)', '300000': '5m (300000ms)', '3600000': '1h (3600000ms)' }[rateLimitWindow] ?? rateLimitWindow}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1000">1s (1000ms)</SelectItem>
                  <SelectItem value="10000">10s (10000ms)</SelectItem>
                  <SelectItem value="60000">1m (60000ms)</SelectItem>
                  <SelectItem value="300000">5m (300000ms)</SelectItem>
                  <SelectItem value="3600000">1h (3600000ms)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Security */}
        <Card>
          <CardHeader>
            <CardTitle>{t('globalSettings.security.security')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="max-body-size">{t('globalSettings.security.maxBodySize')}</Label>
              <Input id="max-body-size" type="number" min={1} value={maxBodySize} onChange={(e) => setMaxBodySize(Number(e.target.value))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sec-rate-limit-max">{t('globalSettings.security.rateLimitMax')}</Label>
              <Input id="sec-rate-limit-max" type="number" min={1} value={secRateLimitMax} onChange={(e) => setSecRateLimitMax(Number(e.target.value))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sec-rate-limit-window">{t('globalSettings.security.rateLimitWindow')}</Label>
              <Select value={secRateLimitWindow} onValueChange={setSecRateLimitWindow}>
                <SelectTrigger id="sec-rate-limit-window">
                  {{ '1000': '1s (1000ms)', '10000': '10s (10000ms)', '60000': '1m (60000ms)', '300000': '5m (300000ms)', '3600000': '1h (3600000ms)' }[secRateLimitWindow] ?? secRateLimitWindow}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1000">1s (1000ms)</SelectItem>
                  <SelectItem value="10000">10s (10000ms)</SelectItem>
                  <SelectItem value="60000">1m (60000ms)</SelectItem>
                  <SelectItem value="300000">5m (300000ms)</SelectItem>
                  <SelectItem value="3600000">1h (3600000ms)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="brute-force-max">{t('globalSettings.security.bruteForceMax')}</Label>
              <Input id="brute-force-max" type="number" min={1} value={bruteForceMax} onChange={(e) => setBruteForceMax(Number(e.target.value))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="brute-force-lockout">{t('globalSettings.security.bruteForceLockout')}</Label>
              <Input id="brute-force-lockout" type="number" min={1} value={bruteForceLockout} onChange={(e) => setBruteForceLockout(Number(e.target.value))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cors-origin">{t('globalSettings.security.corsOrigin')}</Label>
              <Input id="cors-origin" value={corsOrigin} onChange={(e) => setCorsOrigin(e.target.value)} placeholder="https://example.com" />
            </div>
          </CardContent>
        </Card>

        {/* Alerts */}
        <Card>
          <CardHeader>
            <CardTitle>{t('globalSettings.alerts.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="failed-login-threshold">{t('globalSettings.alerts.failedLoginThreshold')}</Label>
              <Input id="failed-login-threshold" type="number" min={1} value={failedLoginThreshold} onChange={(e) => setFailedLoginThreshold(Number(e.target.value))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="alert-email">{t('globalSettings.alerts.alertEmail')}</Label>
              <Input id="alert-email" type="email" value={alertEmail} onChange={(e) => setAlertEmail(e.target.value)} placeholder="admin@example.com" />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="enable-alerts">{t('globalSettings.alerts.enableAlerts')}</Label>
              <Switch id="enable-alerts" checked={enableAlerts} onCheckedChange={setEnableAlerts} />
            </div>
          </CardContent>
        </Card>

        {/* Data Retention */}
        <Card>
          <CardHeader>
            <CardTitle>{t('globalSettings.dataRetention.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{t('globalSettings.dataRetention.description')}</p>
            <div className="space-y-2">
              <Label htmlFor="audit-retention">{t('globalSettings.dataRetention.auditRetention')}</Label>
              <Input id="audit-retention" type="number" min={1} max={365} value={auditRetentionDays} onChange={(e) => setAuditRetentionDays(Number(e.target.value))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="request-retention">{t('globalSettings.dataRetention.requestRetention')}</Label>
              <Input id="request-retention" type="number" min={1} max={365} value={requestRetentionDays} onChange={(e) => setRequestRetentionDays(Number(e.target.value))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="backup-retention">{t('globalSettings.dataRetention.backupRetention')}</Label>
              <Input id="backup-retention" type="number" min={1} max={365} value={backupRetentionDays} onChange={(e) => setBackupRetentionDays(Number(e.target.value))} />
            </div>
            <Button onClick={() => saveSettingsMutation.mutate({
              audit_retention_days: String(auditRetentionDays),
              request_retention_days: String(requestRetentionDays),
              backup_retention_days: String(backupRetentionDays),
            })}>
              {t('globalSettings.save')}
            </Button>
          </CardContent>
        </Card>

        {/* Maintenance Mode */}
        <Card>
          <CardHeader>
            <CardTitle>{t('globalSettings.maintenance')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="maintenance-mode">{t('globalSettings.maintenanceToggle')}</Label>
                <p className="text-sm text-muted-foreground">{t('globalSettings.maintenanceDesc')}</p>
              </div>
              <Switch id="maintenance-mode" checked={maintenanceMode} onCheckedChange={setMaintenanceMode} />
            </div>
          </CardContent>
        </Card>

        <Separator />

        {/* System Backup */}
        <Card>
          <CardHeader>
            <CardTitle>{t('globalSettings.backup.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{t('globalSettings.backup.description')}</p>
            <div className="flex gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={async () => {
                  try {
                    const exportData = await api.post<Record<string, unknown>>('/system/export');
                    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `dataforge-export-${new Date().toISOString().slice(0, 10)}.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                    toast.success(t('globalSettings.backup.exported'));
                  } catch (err) {
                    toast.error((err as Error).message);
                  }
                }}
              >
                <Download className="h-4 w-4 mr-2" />
                {t('globalSettings.backup.exportButton')}
              </Button>
              <div className="relative">
                <input
                  type="file"
                  accept=".json"
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      const text = await file.text();
                      const data = JSON.parse(text);
                      await api.post('/system/import', data);
                      toast.success(t('globalSettings.backup.imported'));
                    } catch (err) {
                      toast.error((err as Error).message);
                    }
                    e.target.value = '';
                  }}
                />
                <Button type="button" variant="outline">
                  <Upload className="h-4 w-4 mr-2" />
                  {t('globalSettings.backup.importButton')}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Separator />

        <Button type="submit">{t('globalSettings.save')}</Button>
      </form>
    </PageWrapper>
  );
}
