import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Shield, CheckCircle2, XCircle, Globe, Network, Lock, Plus, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useCurrentUser } from '@/hooks/useAuth';
import { useCurrentProject } from '@/hooks/useProject';
import { authApi } from '@/api/auth.api';
import { securityApi } from '@/api/security.api';
import { dataApi, type RLSRule } from '@/api/data.api';
import { schemaApi } from '@/api/schema.api';
import { toast } from 'sonner';

const RLS_OPERATORS = ['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'in', 'contains'] as const;
const RLS_SOURCES = ['static', 'current_user_id', 'current_user_role', 'header', 'context'] as const;

export function SecurityPage() {
  const { t } = useTranslation('settings');
  usePageTitle(t('security.title'));
  const queryClient = useQueryClient();
  const { data: user } = useCurrentUser();
  const { data: project } = useCurrentProject();

  const [setupStep, setSetupStep] = useState<'idle' | 'qr' | 'done'>('idle');
  const [setupData, setSetupData] = useState<{ secret: string; uri: string; backup_codes: string[] } | null>(null);
  const [verifyCode, setVerifyCode] = useState('');
  const [disablePassword, setDisablePassword] = useState('');
  const [showDisable, setShowDisable] = useState(false);
  const is2FAEnabled = user?.totp_enabled ?? false;

  const [ipMode, setIpMode] = useState('disabled');
  const [ipList, setIpList] = useState('');
  const [applyToUi, setApplyToUi] = useState(false);
  const [applyToApi, setApplyToApi] = useState(true);
  const [geoMode, setGeoMode] = useState('disabled');
  const [geoCountries, setGeoCountries] = useState('');

  const [rlsTableFilter, setRlsTableFilter] = useState('');
  const [addRuleOpen, setAddRuleOpen] = useState(false);
  const [newRule, setNewRule] = useState({
    table_name: '',
    column_name: '',
    operator: 'eq' as string,
    value_source: 'static' as string,
    value_static: '',
  });

  const projectId = project?.id;

  const { data: securityData } = useQuery({
    queryKey: ['project-security', projectId],
    queryFn: async () => {
      if (!projectId) throw new Error('No project');
      const res = await securityApi.get(projectId);
      return res.security;
    },
    enabled: !!projectId,
  });

  useEffect(() => {
    if (securityData) {
      const data = securityData;
      setIpMode((data.ip_mode as string) ?? 'disabled');
      const whitelist = (data.ip_whitelist as string[]) ?? [];
      const blacklist = (data.ip_blacklist as string[]) ?? [];
      setIpList((data.ip_mode === 'whitelist' ? whitelist : blacklist).join('\n'));
      setApplyToUi((data.apply_to_ui as boolean) ?? false);
      setApplyToApi((data.apply_to_api as boolean) ?? true);
      setGeoMode((data.geo_mode as string) ?? 'disabled');
      setGeoCountries(((data.geo_countries as string[]) ?? []).join('\n'));
    }
  }, [securityData]);

  const { data: tablesData } = useQuery({
    queryKey: ['tables-list', projectId],
    queryFn: async () => {
      if (!projectId) throw new Error('No project');
      const res = await schemaApi.listTables(projectId);
      return res.tables;
    },
    enabled: !!projectId,
  });

  const { data: rlsRules } = useQuery({
    queryKey: ['rls-rules', projectId],
    queryFn: async () => {
      if (!projectId) throw new Error('No project');
      const res = await dataApi.listRLSRules(projectId);
      return res.rules;
    },
    enabled: !!projectId,
  });

  const { data: tableColumns } = useQuery({
    queryKey: ['table-columns', projectId, newRule.table_name],
    queryFn: async () => {
      if (!projectId || !newRule.table_name) throw new Error('No table');
      const res = await schemaApi.getTable(projectId, newRule.table_name);
      return res.table.columns;
    },
    enabled: !!projectId && !!newRule.table_name,
  });

  const setupMutation = useMutation({
    mutationFn: () => authApi.twoFASetup(),
    onSuccess: (data) => {
      setSetupData(data);
      setSetupStep('qr');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const verifySetupMutation = useMutation({
    mutationFn: () => authApi.twoFAVerifySetup(verifyCode),
    onSuccess: () => {
      setSetupStep('done');
      setVerifyCode('');
      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
      toast.success(t('security.twofa.enabled'));
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
      toast.success(t('security.twofa.disabled'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const securityMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => {
      if (!projectId) throw new Error('No project');
      return securityApi.update(projectId, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-security', projectId] });
      toast.success(t('security.saved'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const createRuleMutation = useMutation({
    mutationFn: (data: { table_name: string; column_name: string; operator: string; value_source: string; value_static: string | null }) => {
      if (!projectId) throw new Error('No project');
      return dataApi.createRLSRule(projectId, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rls-rules', projectId] });
      setAddRuleOpen(false);
      setNewRule({ table_name: '', column_name: '', operator: 'eq', value_source: 'static', value_static: '' });
      toast.success(t('security.rls.created'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteRuleMutation = useMutation({
    mutationFn: (ruleId: string) => {
      if (!projectId) throw new Error('No project');
      return dataApi.deleteRLSRule(projectId, ruleId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rls-rules', projectId] });
      toast.success(t('security.rls.deleted'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleSaveSecurity = () => {
    const ipArray = ipList.split('\n').map((s) => s.trim()).filter(Boolean);
    securityMutation.mutate({
      ip_mode: ipMode,
      ip_whitelist: ipMode === 'whitelist' ? ipArray : [],
      ip_blacklist: ipMode === 'blacklist' ? ipArray : [],
      apply_to_ui: applyToUi,
      apply_to_api: applyToApi,
      geo_mode: geoMode,
      geo_countries: geoCountries.split('\n').map((s) => s.trim()).filter(Boolean),
    });
  };

  const handleAddRule = () => {
    createRuleMutation.mutate({
      table_name: newRule.table_name,
      column_name: newRule.column_name,
      operator: newRule.operator,
      value_source: newRule.value_source,
      value_static: newRule.value_source === 'static' || newRule.value_source === 'header' ? newRule.value_static : null,
    });
  };

  const filteredRules = rlsRules?.filter((r: RLSRule) => !rlsTableFilter || r.table_name === rlsTableFilter) ?? [];

  return (
    <PageWrapper>
      <h1 className="text-2xl font-bold mb-6">{t('security.title')}</h1>

      {/* ─── 2FA Card ─────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            {t('security.twofa.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Status */}
          <div className="flex items-center gap-2">
            {is2FAEnabled ? (
              <>
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                <span className="font-medium">{t('security.twofa.enabled')}</span>
                <Badge variant="outline" className="border-green-500/50 text-green-500">
                  {t('security.twofa.enabled')}
                </Badge>
              </>
            ) : (
              <>
                <XCircle className="h-5 w-5 text-muted-foreground" />
                <span className="text-muted-foreground">{t('security.twofa.disabled')}</span>
              </>
            )}
          </div>

          {/* Enable flow */}
          {!is2FAEnabled && setupStep === 'idle' && (
            <Button onClick={() => setupMutation.mutate()} disabled={setupMutation.isPending}>
              {setupMutation.isPending ? '...' : t('security.twofa.enable')}
            </Button>
          )}

          {!is2FAEnabled && setupStep === 'qr' && setupData && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">{t('security.twofa.scanQr')}</p>

              {/* QR URI display */}
              <div className="p-4 bg-muted rounded-lg break-all">
                <p className="text-xs text-muted-foreground mb-1">otpauth:// URI</p>
                <code className="text-xs">{setupData.uri}</code>
              </div>

              <div className="p-3 bg-muted rounded-lg">
                <p className="text-xs text-muted-foreground mb-1">Secret key (manual entry)</p>
                <code className="text-sm font-mono">{setupData.secret}</code>
              </div>

              {/* Backup codes */}
              <div className="space-y-2">
                <p className="text-sm font-medium">{t('security.twofa.backupCodes')}</p>
                <p className="text-xs text-muted-foreground">{t('security.twofa.backupDesc')}</p>
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
                <Label htmlFor="verify-code">{t('security.twofa.enterCode')}</Label>
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
                {verifySetupMutation.isPending ? '...' : t('security.twofa.enable')}
              </Button>
            </div>
          )}

          {setupStep === 'done' && !is2FAEnabled && (
            <p className="text-sm text-green-500">{t('security.twofa.enabled')}</p>
          )}

          {/* Disable flow */}
          {is2FAEnabled && !showDisable && (
            <Button variant="destructive" onClick={() => setShowDisable(true)}>
              {t('security.twofa.disable')}
            </Button>
          )}

          {is2FAEnabled && showDisable && (
            <div className="space-y-3 p-4 border border-destructive/50 rounded-lg">
              <Label htmlFor="disable-password">{t('security.twofa.confirmPassword', 'Confirm your password')}</Label>
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
                  {disableMutation.isPending ? '...' : t('security.twofa.disable')}
                </Button>
                <Button variant="outline" onClick={() => { setShowDisable(false); setDisablePassword(''); }}>
                  {t('security.cancel', 'Cancel')}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── IP Access Control Card ───────────────────────── */}
      {projectId && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Network className="h-5 w-5" />
              {t('security.ip.title')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>{t('security.ip.mode')}</Label>
              <RadioGroup
                value={ipMode}
                onValueChange={setIpMode}
                className="flex gap-4 mt-2"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="disabled" id="ip-disabled" />
                  <Label htmlFor="ip-disabled">{t('security.ip.disabled')}</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="whitelist" id="ip-whitelist" />
                  <Label htmlFor="ip-whitelist">{t('security.ip.whitelist')}</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="blacklist" id="ip-blacklist" />
                  <Label htmlFor="ip-blacklist">{t('security.ip.blacklist')}</Label>
                </div>
              </RadioGroup>
            </div>

            {ipMode !== 'disabled' && (
              <div>
                <Label>{t('security.ip.ipList')}</Label>
                <p className="text-xs text-muted-foreground mb-1">{t('security.ip.ipListHint')}</p>
                <Textarea
                  value={ipList}
                  onChange={(e) => setIpList(e.target.value)}
                  rows={4}
                  placeholder="192.168.1.1&#10;10.0.0.0/24"
                />
              </div>
            )}

            <div>
              <Label className="mb-2 block">{t('security.ip.applyTo')}</Label>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Checkbox checked={applyToUi} onCheckedChange={(v) => setApplyToUi(!!v)} id="apply-ui" />
                  <Label htmlFor="apply-ui">{t('security.ip.ui')}</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox checked={applyToApi} onCheckedChange={(v) => setApplyToApi(!!v)} id="apply-api" />
                  <Label htmlFor="apply-api">{t('security.ip.api')}</Label>
                </div>
              </div>
            </div>

            <Button onClick={handleSaveSecurity} disabled={securityMutation.isPending}>
              {securityMutation.isPending ? '...' : t('projectSettings.save')}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ─── Geo Blocking Card ────────────────────────────── */}
      {projectId && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5" />
              {t('security.geo.title')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>{t('security.geo.mode')}</Label>
              <RadioGroup
                value={geoMode}
                onValueChange={setGeoMode}
                className="flex gap-4 mt-2"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="disabled" id="geo-disabled" />
                  <Label htmlFor="geo-disabled">{t('security.geo.disabled')}</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="allow" id="geo-allow" />
                  <Label htmlFor="geo-allow">{t('security.geo.allow')}</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="block" id="geo-block" />
                  <Label htmlFor="geo-block">{t('security.geo.block')}</Label>
                </div>
              </RadioGroup>
            </div>

            {geoMode !== 'disabled' && (
              <div>
                <Label>{t('security.geo.countries')}</Label>
                <p className="text-xs text-muted-foreground mb-1">{t('security.geo.countriesHint')}</p>
                <Textarea
                  value={geoCountries}
                  onChange={(e) => setGeoCountries(e.target.value)}
                  rows={4}
                  placeholder="US&#10;DE&#10;RU"
                />
              </div>
            )}

            <Button onClick={handleSaveSecurity} disabled={securityMutation.isPending}>
              {securityMutation.isPending ? '...' : t('projectSettings.save')}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ─── Row-Level Security Card ─────────────────────── */}
      {projectId && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 justify-between">
              <div className="flex items-center gap-2">
                <Lock className="h-5 w-5" />
                {t('security.rls.title')}
              </div>
              <Dialog open={addRuleOpen} onOpenChange={setAddRuleOpen}>
                <DialogTrigger asChild>
                  <Button size="sm">
                    <Plus className="h-4 w-4 mr-1" />
                    {t('security.rls.addRule')}
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{t('security.rls.addRule')}</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div>
                      <Label>{t('security.rls.table')}</Label>
                      <Select
                        value={newRule.table_name}
                        onValueChange={(v) => setNewRule({ ...newRule, table_name: v, column_name: '' })}
                      >
                        <SelectTrigger className="w-full mt-1">
                          <SelectValue placeholder={t('security.rls.selectTable')} />
                        </SelectTrigger>
                        <SelectContent>
                          {tablesData?.map((tbl) => (
                            <SelectItem key={tbl.name} value={tbl.name}>
                              {tbl.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label>{t('security.rls.column')}</Label>
                      <Select
                        value={newRule.column_name}
                        onValueChange={(v) => setNewRule({ ...newRule, column_name: v })}
                        disabled={!newRule.table_name}
                      >
                        <SelectTrigger className="w-full mt-1">
                          <SelectValue placeholder={t('security.rls.selectColumn')} />
                        </SelectTrigger>
                        <SelectContent>
                          {tableColumns?.map((col) => (
                            <SelectItem key={col.name} value={col.name}>
                              {col.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label>{t('security.rls.operator')}</Label>
                      <Select
                        value={newRule.operator}
                        onValueChange={(v) => setNewRule({ ...newRule, operator: v })}
                      >
                        <SelectTrigger className="w-full mt-1">
                          {t(`security.rls.operators.${newRule.operator}`)}
                        </SelectTrigger>
                        <SelectContent>
                          {RLS_OPERATORS.map((op) => (
                            <SelectItem key={op} value={op}>
                              {t(`security.rls.operators.${op}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label>{t('security.rls.valueSource')}</Label>
                      <Select
                        value={newRule.value_source}
                        onValueChange={(v) => setNewRule({ ...newRule, value_source: v })}
                      >
                        <SelectTrigger className="w-full mt-1">
                          {t(`security.rls.sources.${newRule.value_source}`)}
                        </SelectTrigger>
                        <SelectContent>
                          {RLS_SOURCES.map((src) => (
                            <SelectItem key={src} value={src}>
                              {t(`security.rls.sources.${src}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {(newRule.value_source === 'static' || newRule.value_source === 'header') && (
                      <div>
                        <Label>{t('security.rls.valueStatic')}</Label>
                        <Input
                          value={newRule.value_static}
                          onChange={(e) => setNewRule({ ...newRule, value_static: e.target.value })}
                          className="mt-1"
                        />
                      </div>
                    )}

                    <Button
                      onClick={handleAddRule}
                      disabled={createRuleMutation.isPending || !newRule.table_name || !newRule.column_name}
                      className="w-full"
                    >
                      {createRuleMutation.isPending ? '...' : t('security.rls.addRule')}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* Table filter */}
            {tablesData && tablesData.length > 0 && (
              <div className="mb-4">
                <Select
                  value={rlsTableFilter || '__all__'}
                  onValueChange={(v) => setRlsTableFilter(v === '__all__' ? '' : v)}
                >
                  <SelectTrigger className="w-64">
                    <SelectValue placeholder={t('security.rls.selectTable')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">{t('security.rls.selectTable')}</SelectItem>
                    {tablesData.map((tbl) => (
                      <SelectItem key={tbl.name} value={tbl.name}>
                        {tbl.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {filteredRules.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Lock className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="font-medium">{t('security.rls.noRules')}</p>
                <p className="text-sm">{t('security.rls.noRulesDesc')}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredRules.map((rule: RLSRule) => (
                  <div
                    key={rule.id}
                    className="flex items-center justify-between p-3 border rounded-lg"
                  >
                    <div className="flex items-center gap-3 text-sm">
                      <Badge variant="outline">{rule.table_name}</Badge>
                      <span className="font-mono">{rule.column_name}</span>
                      <Badge>{t(`security.rls.operators.${rule.operator}`)}</Badge>
                      <span className="text-muted-foreground">
                        {t(`security.rls.sources.${rule.value_source}`)}
                      </span>
                      {rule.value_static && (
                        <code className="text-xs bg-muted px-1 py-0.5 rounded">{rule.value_static}</code>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteRuleMutation.mutate(rule.id)}
                      disabled={deleteRuleMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </PageWrapper>
  );
}
