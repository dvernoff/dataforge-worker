import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Network, Lock, Plus, Trash2 } from 'lucide-react';
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
import { useCurrentProject } from '@/hooks/useProject';
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
  const { data: project } = useCurrentProject();

  const [ipMode, setIpMode] = useState('disabled');
  const [ipList, setIpList] = useState('');
  const [applyToUi, setApplyToUi] = useState(false);
  const [applyToApi, setApplyToApi] = useState(true);

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

            <p className="text-xs text-muted-foreground">{t('security.ip.appliesTo')}</p>

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

            <div className="space-y-3 mb-4">
              <div className="rounded-lg border bg-muted/30 p-4">
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {t('security.rls.explanation')}
                </p>
                <p className="text-sm text-muted-foreground leading-relaxed mt-2">
                  {t('security.rls.whenToUse')}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="text-xs gap-1">
                  <span className="text-green-400">{'→'}</span> {t('security.rls.exampleUser')}
                </Badge>
                <Badge variant="outline" className="text-xs gap-1">
                  <span className="text-blue-400">{'→'}</span> {t('security.rls.exampleRole')}
                </Badge>
                <Badge variant="outline" className="text-xs gap-1">
                  <span className="text-amber-400">{'→'}</span> {t('security.rls.exampleStatic')}
                </Badge>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground/70">
                <Lock className="h-3 w-3" />
                {t('security.rls.panelNote')}
              </div>
            </div>

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
                    <div className="flex items-center gap-2 text-sm flex-wrap">
                      <span className="text-muted-foreground">{t('security.rls.rulePrefix')}</span>
                      <Badge variant="outline">{rule.table_name}</Badge>
                      <span className="text-muted-foreground">{t('security.rls.ruleWhere')}</span>
                      <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{rule.column_name}</code>
                      <Badge variant="secondary">{t(`security.rls.operators.${rule.operator}`)}</Badge>
                      <Badge variant="default" className="text-xs">
                        {rule.value_source === 'static' || rule.value_source === 'header'
                          ? rule.value_static
                          : t(`security.rls.sources.${rule.value_source}`)}
                      </Badge>
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
