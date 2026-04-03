import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { Download, Upload, Eye, EyeOff, DollarSign } from 'lucide-react';
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
  const [auditRetentionDays, setAuditRetentionDays] = useState(90);
  const [requestRetentionDays, setRequestRetentionDays] = useState(30);
  const [timeTravelDays, setTimeTravelDays] = useState(7);

  // Maintenance Mode
  const [maintenanceMode, setMaintenanceMode] = useState(false);

  // Registration Settings
  const [registrationEnabled, setRegistrationEnabled] = useState(true);
  const [requireInvite, setRequireInvite] = useState(true);
  const [defaultRole, setDefaultRole] = useState('');
  const [maxUsersLimit, setMaxUsersLimit] = useState(0);

  // AI Configuration
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiApiKey, setAiApiKey] = useState('');
  const [aiModel, setAiModel] = useState('claude-sonnet-4-20250514');
  const [aiKeyVisible, setAiKeyVisible] = useState(false);

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

  useEffect(() => {
    if (systemSettings?.settings) {
      const s = systemSettings.settings;
      setAiEnabled(s.ai_enabled === 'true');
      setAiApiKey(s.ai_api_key_ref ?? '');
      setAiModel(s.ai_model ?? 'claude-sonnet-4-20250514');
      setRegistrationEnabled(s.registration_enabled !== 'false');
      setRequireInvite(s.require_invite !== 'false');
      setDefaultRole(s.default_role ?? '');
      setMaxUsersLimit(Number(s.max_users ?? '0'));
      setTimeTravelDays(Number(s.time_travel_days ?? '7'));
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

  const handleSaveAiSettings = () => {
    saveSettingsMutation.mutate({
      ai_enabled: String(aiEnabled),
      ai_api_key_ref: aiApiKey,
      ai_model: aiModel,
    });
  };

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
            <div className="space-y-2">
              <Label htmlFor="audit-retention">{t('globalSettings.dataRetention.auditRetention')}</Label>
              <Input id="audit-retention" type="number" min={1} value={auditRetentionDays} onChange={(e) => setAuditRetentionDays(Number(e.target.value))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="request-retention">{t('globalSettings.dataRetention.requestRetention')}</Label>
              <Input id="request-retention" type="number" min={1} value={requestRetentionDays} onChange={(e) => setRequestRetentionDays(Number(e.target.value))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="time-travel-days">{t('globalSettings.dataRetention.timeTravelDays')}</Label>
              <p className="text-sm text-muted-foreground">{t('globalSettings.dataRetention.timeTravelDaysDesc')}</p>
              <Input id="time-travel-days" type="number" min={1} max={90} value={timeTravelDays} onChange={(e) => setTimeTravelDays(Number(e.target.value))} />
            </div>
            <Button type="button" onClick={() => saveSettingsMutation.mutate({ time_travel_days: String(timeTravelDays) })}>
              {t('globalSettings.save')}
            </Button>
          </CardContent>
        </Card>

        {/* AI Configuration */}
        <Card>
          <CardHeader>
            <CardTitle>{t('globalSettings.ai.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="ai-enabled">{t('globalSettings.ai.enableAi')}</Label>
                <p className="text-sm text-muted-foreground">{t('globalSettings.ai.enableAiDesc')}</p>
              </div>
              <Switch id="ai-enabled" checked={aiEnabled} onCheckedChange={setAiEnabled} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ai-api-key">{t('globalSettings.ai.apiKey')}</Label>
              <div className="relative">
                <Input
                  id="ai-api-key"
                  type={aiKeyVisible ? 'text' : 'password'}
                  value={aiApiKey}
                  onChange={(e) => setAiApiKey(e.target.value)}
                  placeholder={t('globalSettings.ai.apiKeyPlaceholder')}
                  className="pr-10"
                />
                <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setAiKeyVisible(!aiKeyVisible)}>
                  {aiKeyVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">{t('globalSettings.ai.apiKeyNote')}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ai-model">{t('globalSettings.ai.model')}</Label>
              <Select value={aiModel} onValueChange={setAiModel}>
                <SelectTrigger id="ai-model">
                  <SelectValue placeholder={t('globalSettings.ai.modelPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="claude-sonnet-4-20250514">Claude Sonnet 4</SelectItem>
                  <SelectItem value="claude-opus-4-20250514">Claude Opus 4</SelectItem>
                  <SelectItem value="claude-haiku-235-20250514">Claude Haiku 3.5</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="button" onClick={handleSaveAiSettings} disabled={saveSettingsMutation.isPending}>
              {t('globalSettings.save')}
            </Button>
          </CardContent>
        </Card>

        {/* AI Budget — Monthly Spend */}
        <AiBudgetCard t={t} />

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



function AiBudgetCard({ t }: { t: (key: string) => string }) {
  const queryClient = useQueryClient();
  const [budgetLimit, setBudgetLimit] = useState(0);
  const [alertThreshold, setAlertThreshold] = useState(80);

  const { data: budgetData } = useQuery({
    queryKey: ['ai-budget'],
    queryFn: () => api.get<{
      month: string;
      total_requests: number;
      total_input_tokens: number;
      total_output_tokens: number;
      total_cost_usd: number;
      budget_limit_usd: number;
      alert_threshold_pct: number;
    }>('/system/ai/budget'),
  });

  useEffect(() => {
    if (budgetData) {
      setBudgetLimit(budgetData.budget_limit_usd);
      setAlertThreshold(budgetData.alert_threshold_pct);
    }
  }, [budgetData]);

  const saveBudgetMutation = useMutation({
    mutationFn: (data: { budget_limit_usd?: number; alert_threshold_pct?: number }) =>
      api.put('/system/ai/budget', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-budget'] });
      toast.success(t('globalSettings.aiBudget.saved'));
    },
  });

  const spentPct = budgetData && budgetLimit > 0
    ? Math.min(100, Math.round((budgetData.total_cost_usd / budgetLimit) * 100))
    : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DollarSign className="h-5 w-5" />
          {t('globalSettings.aiBudget.monthlyBudgetTitle')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {budgetData && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{t('globalSettings.aiBudget.currentMonthSpent')}</span>
              <span className="text-2xl font-bold">${budgetData.total_cost_usd.toFixed(4)}</span>
            </div>
            {budgetLimit > 0 && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{spentPct}% {t('globalSettings.aiBudget.ofBudget')}</span>
                  <span>${budgetLimit.toFixed(2)}</span>
                </div>
                <Progress value={spentPct} className={`h-3 ${spentPct >= alertThreshold ? '[&>div]:bg-destructive' : ''}`} />
              </div>
            )}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">{t('globalSettings.aiBudget.totalRequests')}</span>
                <p className="font-semibold">{budgetData.total_requests}</p>
              </div>
              <div>
                <span className="text-muted-foreground">{t('globalSettings.aiBudget.totalTokens')}</span>
                <p className="font-semibold">{(budgetData.total_input_tokens + budgetData.total_output_tokens).toLocaleString()}</p>
              </div>
            </div>
          </div>
        )}
        <Separator />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>{t('globalSettings.aiBudget.monthlyBudgetUsd')}</Label>
            <Input type="number" min={0} step={0.01} value={budgetLimit} onChange={(e) => setBudgetLimit(Number(e.target.value))} placeholder="100.00" />
          </div>
          <div className="space-y-2">
            <Label>{t('globalSettings.aiBudget.alertThresholdPct')}</Label>
            <Input type="number" min={0} max={100} value={alertThreshold} onChange={(e) => setAlertThreshold(Number(e.target.value))} placeholder="80" />
          </div>
        </div>
        <Button type="button" onClick={() => saveBudgetMutation.mutate({ budget_limit_usd: budgetLimit, alert_threshold_pct: alertThreshold })} disabled={saveBudgetMutation.isPending}>
          {t('globalSettings.save')}
        </Button>
      </CardContent>
    </Card>
  );
}
