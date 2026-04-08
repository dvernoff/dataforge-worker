import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useFeaturesStore } from '@/stores/features.store';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, Play, AlertCircle, Check, Minus, Info, Copy, Route, Database, Shield, Zap, Globe, Key, Gamepad2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';
import type { ColumnInfo } from '@/api/schema.api';
import { Checkbox } from '@/components/ui/checkbox';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { useCurrentProject } from '@/hooks/useProject';
import { endpointsApi } from '@/api/endpoints.api';
import { schemaApi } from '@/api/schema.api';
import { toast } from 'sonner';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useTranslation } from 'react-i18next';

function formatCacheTTL(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

interface ResponseFieldConfig {
  enabled: boolean;
  alias: string;
}

interface ResponseConfig {
  fields: Record<string, ResponseFieldConfig>;
  fk_populate: boolean;
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

const METHOD_COLORS: Record<string, string> = {
  GET: 'bg-green-500/15 text-green-600 border-green-500/30',
  POST: 'bg-blue-500/15 text-blue-600 border-blue-500/30',
  PUT: 'bg-orange-500/15 text-orange-600 border-orange-500/30',
  PATCH: 'bg-yellow-500/15 text-yellow-600 border-yellow-500/30',
  DELETE: 'bg-red-500/15 text-red-600 border-red-500/30',
};

/** Combined method+operation presets for table source */
const TABLE_ACTIONS = [
  { key: 'find',    method: 'GET',    operation: 'find',    pathSuffix: '' },
  { key: 'findOne', method: 'GET',    operation: 'findOne', pathSuffix: '/:id' },
  { key: 'create',  method: 'POST',   operation: 'create',  pathSuffix: '' },
  { key: 'update',  method: 'PUT',    operation: 'update',  pathSuffix: '/:id' },
  { key: 'delete',  method: 'DELETE', operation: 'delete',  pathSuffix: '/:id' },
] as const;

/** Get path suffix for an action, using search_column for findOne */
function getActionPathSuffix(action: typeof TABLE_ACTIONS[number], searchColumn?: string): string {
  if (action.operation === 'findOne') {
    return `/:${searchColumn || 'id'}`;
  }
  return action.pathSuffix;
}

function getExampleValue(col: ColumnInfo): unknown {
  const t = col.type.toLowerCase();
  if (t.includes('int') || t === 'smallint' || t === 'bigint') return 1;
  if (t.includes('numeric') || t.includes('decimal') || t === 'real' || t.includes('double') || t === 'float') return 1.5;
  if (t === 'boolean' || t === 'bool') return true;
  if (t.includes('json')) return {};
  if (t === 'uuid') return '550e8400-e29b-41d4-a716-446655440000';
  if (t.includes('timestamp') || t === 'date') return '2026-01-15T12:00:00Z';
  if (t.includes('time') && !t.includes('timestamp')) return '12:00:00';
  if (t.includes('text') || t.includes('varchar') || t.includes('char')) return `example ${col.name}`;
  if (t.includes('array')) return [];
  return `value`;
}

export function EndpointEditorPage() {
  const { t } = useTranslation(['api', 'common']);
  const { slug, id: endpointId } = useParams<{ slug: string; id: string }>();
  const navigate = useNavigate();
  const { data: project } = useCurrentProject();
  const queryClient = useQueryClient();
  const isNew = !endpointId || endpointId === 'new';
  usePageTitle(isNew ? t('createEndpoint') : t('editEndpoint'));

  const [form, setForm] = useState({
    method: 'GET' as string,
    path: '/',
    description: '',
    source_type: 'table' as string,
    source_config: { table: '', operation: 'find' } as Record<string, unknown>,
    auth_type: 'api_token' as string,
    cache_enabled: false,
    cache_ttl: 60,
    cache_invalidation: null as { on_insert: boolean; on_update: boolean; on_delete: boolean } | null,
    rate_limit_enabled: false,
    rate_limit_max: 100,
    rate_limit_window: 60000,
    response_config: { fields: {}, fk_populate: false } as ResponseConfig,
    is_active: true,
  });

  const { data: endpointData, isLoading } = useQuery({
    queryKey: ['endpoint', project?.id, endpointId],
    queryFn: () => endpointsApi.getById(project!.id, endpointId!),
    enabled: !isNew && !!project?.id && !!endpointId,
  });

  const { data: tablesData } = useQuery({
    queryKey: ['tables', project?.id],
    queryFn: () => schemaApi.listTables(project!.id),
    enabled: !!project?.id,
  });

  const [testResult, setTestResult] = useState<{ status: number; data?: unknown; error?: string; duration_ms: number } | null>(null);
  const [testParams, setTestParams] = useState<Record<string, string>>({});
  const [testQuery, setTestQuery] = useState<Record<string, string>>({});
  const [testBody, setTestBody] = useState('');
  const [testHeaders, setTestHeaders] = useState<Record<string, string>>({});
  const [isDirty, setIsDirty] = useState(false);

  // Wrap setForm for user-initiated changes — marks form as dirty
  const updateForm = (updater: typeof form | ((prev: typeof form) => typeof form)) => {
    setForm(updater);
    setIsDirty(true);
  };

  useEffect(() => {
    if (endpointData?.endpoint) {
      const ep = endpointData.endpoint;
      const rc = (ep.response_config as ResponseConfig | null) ?? { fields: {}, fk_populate: false };
      setForm({
        method: ep.method,
        path: ep.path,
        description: ep.description ?? '',
        source_type: ep.source_type,
        source_config: ep.source_config as Record<string, unknown>,
        auth_type: ep.auth_type,
        cache_enabled: ep.cache_enabled,
        cache_ttl: ep.cache_ttl,
        cache_invalidation: (ep.cache_invalidation as { on_insert: boolean; on_update: boolean; on_delete: boolean } | null) ?? null,
        rate_limit_enabled: !!(ep.rate_limit as Record<string, unknown> | null),
        rate_limit_max: (ep.rate_limit as Record<string, number> | null)?.max ?? 100,
        rate_limit_window: (ep.rate_limit as Record<string, number> | null)?.window ?? 60000,
        response_config: rc,
        is_active: ep.is_active,
      });
      setIsDirty(false);
    }
  }, [endpointData]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        method: form.method,
        path: form.path,
        description: form.description || undefined,
        source_type: form.source_type,
        source_config: form.source_config,
        auth_type: form.auth_type,
        cache_enabled: form.cache_enabled,
        cache_ttl: form.cache_ttl,
        cache_invalidation: form.cache_invalidation,
        response_config: form.response_config,
        rate_limit: form.rate_limit_enabled ? { max: form.rate_limit_max, window: form.rate_limit_window, per: 'ip' } : undefined,
        is_active: form.is_active,
      };
      if (isNew) return endpointsApi.create(project!.id, payload);
      return endpointsApi.update(project!.id, endpointId!, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['endpoints', project?.id] });
      queryClient.invalidateQueries({ queryKey: ['endpoint', project?.id, endpointId] });
      queryClient.invalidateQueries({ queryKey: ['openapi-spec', project?.id] });
      setIsDirty(false);
      toast.success(isNew ? t('endpointCreated') : t('endpointSaved'));
      if (isNew) navigate(`/projects/${slug}/endpoints`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const testMutation = useMutation({
    mutationFn: () => {
      let parsedBody: Record<string, unknown> | null = null;
      if (testBody.trim()) {
        try { parsedBody = JSON.parse(testBody); } catch { throw new Error('Invalid JSON body'); }
      }
      // Filter out empty header keys
      const filteredHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(testHeaders)) {
        if (k.trim()) filteredHeaders[k.trim()] = v;
      }
      return endpointsApi.test(project!.id, endpointId!, {
        params: testParams,
        query: testQuery,
        body: parsedBody ?? {},
        ...(Object.keys(filteredHeaders).length > 0 ? { headers: filteredHeaders } : {}),
      });
    },
    onSuccess: (data) => setTestResult(data),
    onError: (err: Error) => toast.error(err.message),
  });

  const tables = tablesData?.tables ?? [];
  const selectedTable = form.source_type === 'table' ? String(form.source_config.table ?? '') : '';
  const { data: tableInfoData } = useQuery({
    queryKey: ['table-info', project?.id, selectedTable],
    queryFn: () => schemaApi.getTable(project!.id, selectedTable),
    enabled: !!project?.id && !!selectedTable,
  });
  const columns = tableInfoData?.table?.columns ?? [];
  const currentOp = String(form.source_config.operation ?? 'find');

  useEffect(() => {
    if (columns.length > 0) {
      setForm((prev) => {
        const existingFields = prev.response_config.fields;
        const updatedFields: Record<string, ResponseFieldConfig> = {};
        for (const col of columns) {
          updatedFields[col.name] = existingFields[col.name] ?? { enabled: true, alias: '' };
        }
        return { ...prev, response_config: { ...prev.response_config, fields: updatedFields } };
      });
    }
  }, [columns]);

  const responsePreview = useMemo(() => {
    const rc = form.response_config;
    const shape: Record<string, string> = {};
    for (const [field, cfg] of Object.entries(rc.fields)) {
      if (!cfg.enabled) continue;
      const key = cfg.alias || field;
      const col = columns.find((c) => c.name === field);
      shape[key] = col?.type ?? 'unknown';
    }
    return JSON.stringify(shape, null, 2);
  }, [form.response_config, columns]);

  if (!isNew && isLoading) {
    return <PageWrapper><Skeleton className="h-8 w-64 mb-4" /><Skeleton className="h-96" /></PageWrapper>;
  }

  const fullPath = `/api/v1/${slug}${form.path}`;

  return (
    <PageWrapper>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">{isNew ? t('createEndpoint') : t('editEndpoint')}</h1>
          {!isNew && endpointData?.endpoint && (
            <>
              <Badge variant="outline">v{endpointData.endpoint.version ?? 1}</Badge>
              {endpointData.endpoint.deprecated_at && (
                <Badge variant="destructive">{t('api:versioning.deprecated')}</Badge>
              )}
            </>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate(`/projects/${slug}/endpoints`)}>{t('common:actions.cancel')}</Button>
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            <Save className="h-4 w-4 mr-2" />
            {saveMutation.isPending ? t('api:saving') : t('common:actions.save')}
          </Button>
        </div>
      </div>

      {/* URL Preview Bar */}
      <div className="flex items-center gap-2 mb-6 rounded-lg border bg-muted/30 px-4 py-3">
        <Badge className={`font-mono text-xs border ${METHOD_COLORS[form.method] ?? ''}`} variant="outline">
          {form.method}
        </Badge>
        <code className="text-sm font-mono text-muted-foreground flex-1 truncate">{fullPath}</code>
        <div className="flex items-center gap-1.5">
          {form.auth_type === 'public' && <Globe className="h-3.5 w-3.5 text-green-500" />}
          {form.auth_type === 'api_token' && <Key className="h-3.5 w-3.5 text-blue-500" />}
          <span className="text-xs text-muted-foreground capitalize">{form.auth_type.replace('_', ' ')}</span>
        </div>
      </div>

      <Tabs defaultValue="basic">
        <TabsList>
          <TabsTrigger value="basic">{t('api:tabs.basic')}</TabsTrigger>
          <TabsTrigger value="request">{t('api:tabs.request')}</TabsTrigger>
          <TabsTrigger value="cache">{t('api:tabs.cache')}</TabsTrigger>
          <TabsTrigger value="response">{t('api:tabs.response')}</TabsTrigger>
          {!isNew && <TabsTrigger value="test">{t('api:tabs.test')}</TabsTrigger>}
        </TabsList>

        {/* ═══ Basic Tab ═══ */}
        <TabsContent value="basic" className="mt-4 space-y-4">
          {/* Source */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-base">{t('api:basic.source')}</CardTitle>
              </div>
              <CardDescription>{t('api:basic.sourceDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Source type + fields in one row */}
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">{t('api:form.source')}</Label>
                  <div className="flex rounded-md border overflow-hidden">
                    <button
                      type="button"
                      onClick={() => updateForm({ ...form, source_type: 'table', source_config: { table: '', operation: 'find' } })}
                      className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                        form.source_type === 'table'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-transparent text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      {t('api:form.sourceTable')}
                    </button>
                    <button
                      type="button"
                      onClick={() => updateForm({ ...form, source_type: 'custom_sql', source_config: { query: '' } })}
                      className={`px-3 py-1.5 text-sm font-medium border-l transition-colors ${
                        form.source_type === 'custom_sql'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-transparent text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      {t('api:form.sourceCustomSql')}
                    </button>
                  </div>
                </div>

                {form.source_type === 'table' && (
                  <div className="flex-1 min-w-[160px]">
                    <Label className="text-xs text-muted-foreground mb-1.5 block">{t('api:form.table')}</Label>
                    <Select
                      value={String(form.source_config.table ?? '')}
                      onValueChange={(v) => {
                        const action = TABLE_ACTIONS.find((a) => a.operation === currentOp) ?? TABLE_ACTIONS[0];
                        const sc = String(form.source_config.search_column ?? 'id');
                        const suffix = getActionPathSuffix(action, sc);
                        updateForm({
                          ...form,
                          path: `/${v}${suffix}`,
                          source_config: { ...form.source_config, table: v },
                        });
                      }}
                    >
                      <SelectTrigger><SelectValue placeholder={t('api:form.selectTable')} /></SelectTrigger>
                      <SelectContent>
                        {tables.map((tbl) => <SelectItem key={tbl.name} value={tbl.name}>{tbl.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              {form.source_type === 'custom_sql' && (
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">{t('api:form.sqlQuery')}</Label>
                  <Textarea
                    value={String(form.source_config.query ?? '')}
                    onChange={(e) => updateForm({ ...form, source_config: { query: e.target.value } })}
                    className="font-mono min-h-[120px]"
                    placeholder="SELECT * FROM users WHERE id = {{id}}"
                  />
                  <p className="text-xs text-muted-foreground mt-1.5">{t('api:form.sqlHint', { param: '{{param}}' })}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Route */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Route className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-base">{t('api:basic.route')}</CardTitle>
              </div>
              <CardDescription>{t('api:basic.routeDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {form.source_type === 'table' ? (
                /* Table source: combined action selector + path */
                <div className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">{t('api:form.action')}</Label>
                    {(() => {
                      const activeAction = TABLE_ACTIONS.find((a) => a.operation === currentOp) ?? TABLE_ACTIONS[0];
                      return (
                        <Select
                          value={currentOp}
                          onValueChange={(v) => {
                            const action = TABLE_ACTIONS.find((a) => a.operation === v);
                            if (!action) return;
                            const table = String(form.source_config.table ?? '');
                            const sc = String(form.source_config.search_column ?? 'id');
                            const suffix = getActionPathSuffix(action, sc);
                            const autoPath = table ? `/${table}${suffix}` : form.path;
                            updateForm({
                              ...form,
                              method: action.method,
                              path: autoPath,
                              source_config: { ...form.source_config, operation: action.operation },
                            });
                          }}
                        >
                          <SelectTrigger>
                            <span className="flex items-center gap-2">
                              <Badge className={`font-mono text-[10px] px-1.5 py-0 border ${METHOD_COLORS[activeAction.method]}`} variant="outline">
                                {activeAction.method}
                              </Badge>
                              {t(`api:form.${activeAction.key === 'find' ? 'findAll' : activeAction.key}`)}
                            </span>
                          </SelectTrigger>
                          <SelectContent>
                            {TABLE_ACTIONS.map((a) => (
                              <SelectItem key={a.key} value={a.operation}>
                                <span className="flex items-center gap-2">
                                  <Badge className={`font-mono text-[10px] px-1.5 py-0 border ${METHOD_COLORS[a.method]}`} variant="outline">
                                    {a.method}
                                  </Badge>
                                  {t(`api:form.${a.key === 'find' ? 'findAll' : a.key}`)}
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      );
                    })()}
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">{t('api:form.path')}</Label>
                    <div className="flex items-center gap-0 border rounded-md overflow-hidden">
                      <span className="text-xs text-muted-foreground bg-muted px-3 py-2 border-r whitespace-nowrap">/api/v1/{slug}/</span>
                      <Input
                        value={form.path.startsWith('/') ? form.path.slice(1) : form.path}
                        onChange={(e) => updateForm({ ...form, path: '/' + e.target.value.replace(/^\//, '') })}
                        className="font-mono border-0 focus-visible:ring-0 rounded-l-none"
                        placeholder={t('api:form.pathPlaceholder')}
                      />
                    </div>
                  </div>
                </div>
                {/* Search by column — for findOne */}
                {currentOp === 'findOne' && selectedTable && columns.length > 0 && (
                  <div className="flex items-center gap-3 rounded-lg bg-muted/30 border px-4 py-3">
                    <Info className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-sm text-muted-foreground whitespace-nowrap">{t('api:form.searchBy')}</span>
                    <Select
                      value={String(form.source_config.search_column ?? 'id')}
                      onValueChange={(col) => {
                        const table = String(form.source_config.table ?? '');
                        updateForm({
                          ...form,
                          path: table ? `/${table}/:${col}` : form.path,
                          source_config: { ...form.source_config, search_column: col },
                        });
                      }}
                    >
                      <SelectTrigger className="w-48">
                        <span className="font-mono text-sm">{String(form.source_config.search_column ?? 'id')}</span>
                      </SelectTrigger>
                      <SelectContent>
                        {columns.map((col) => (
                          <SelectItem key={col.name} value={col.name}>
                            <span className="flex items-center gap-2">
                              <span className="font-mono">{col.name}</span>
                              <Badge variant="outline" className="text-[10px] px-1">{col.type}</Badge>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                </div>
              ) : (
                /* Custom SQL: method + path */
                <div className="grid grid-cols-1 md:grid-cols-[140px_1fr] gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">{t('api:form.method')}</Label>
                    <Select value={form.method} onValueChange={(v) => updateForm({ ...form, method: v })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {METHODS.map((m) => (
                          <SelectItem key={m} value={m}>
                            <span className="font-mono font-medium">{m}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">{t('api:form.path')}</Label>
                    <div className="flex items-center gap-0 border rounded-md overflow-hidden">
                      <span className="text-xs text-muted-foreground bg-muted px-3 py-2 border-r whitespace-nowrap">/api/v1/{slug}/</span>
                      <Input
                        value={form.path.startsWith('/') ? form.path.slice(1) : form.path}
                        onChange={(e) => updateForm({ ...form, path: '/' + e.target.value.replace(/^\//, '') })}
                        className="font-mono border-0 focus-visible:ring-0 rounded-l-none"
                        placeholder={t('api:form.pathPlaceholder')}
                      />
                    </div>
                  </div>
                </div>
              )}
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">{t('api:form.description')}</Label>
                <Textarea
                  value={form.description}
                  onChange={(e) => updateForm({ ...form, description: e.target.value })}
                  placeholder={t('api:form.descriptionPlaceholder')}
                  rows={2}
                />
              </div>
            </CardContent>
          </Card>

          {/* Auth */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-base">{t('api:basic.auth')}</CardTitle>
              </div>
              <CardDescription>{t('api:basic.authDesc')}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className={`grid gap-3 ${useFeaturesStore.getState().isFeatureEnabled(slug ?? '', 'sbox-auth') ? 'grid-cols-3' : 'grid-cols-2'}`}>
                {([
                  { value: 'public' as const, icon: Globe, label: t('api:form.authPublic'), desc: t('api:basic.authPublicDesc') },
                  { value: 'api_token' as const, icon: Key, label: t('api:form.authApiToken'), desc: t('api:basic.authTokenDesc') },
                  ...(useFeaturesStore.getState().isFeatureEnabled(slug ?? '', 'sbox-auth')
                    ? [{ value: 'sbox_session' as const, icon: Gamepad2, label: 'S&box Session', desc: 'Requires x-session-key header. {{player_steam_id}} available in SQL.' }]
                    : []),
                ]).map(({ value, icon: Icon, label, desc }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => updateForm({ ...form, auth_type: value })}
                    className={`flex flex-col items-start gap-2 rounded-lg border p-3 text-left transition-colors ${
                      form.auth_type === value
                        ? 'border-primary bg-primary/5 ring-1 ring-primary'
                        : 'hover:bg-muted/50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4" />
                      <span className="text-sm font-medium">{label}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{desc}</span>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══ Request Schema Tab ═══ */}
        <TabsContent value="request" className="mt-4 space-y-4">
          {/* API Key header info */}
          {form.auth_type === 'api_token' && (
            <div className="flex items-start gap-3 rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-3">
              <Key className="h-4 w-4 mt-0.5 text-blue-500 shrink-0" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-blue-600 dark:text-blue-400">
                  API Key Required
                </p>
                <p className="text-sm text-muted-foreground">
                  Include the following header in every request:
                </p>
                <code className="block text-sm font-mono bg-muted/50 rounded px-2 py-1 mt-1">
                  Authorization: Bearer &lt;api_key&gt;
                </code>
                <a
                  href={`/projects/${slug}/settings/api-tokens`}
                  className="text-sm text-blue-600 dark:text-blue-400 underline underline-offset-2 hover:text-blue-700 dark:hover:text-blue-300 inline-block mt-1"
                >
                  Manage API tokens
                </a>
              </div>
            </div>
          )}

          {form.source_type === 'table' && selectedTable && columns.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('api:request.title')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Hint */}
                <div className="flex items-start gap-3 rounded-lg bg-muted/50 p-3">
                  <Info className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                  <p className="text-sm text-muted-foreground">
                    {currentOp === 'create' && t('api:request.createHint')}
                    {currentOp === 'update' && t('api:request.updateHint')}
                    {currentOp === 'delete' && t('api:request.deleteHint')}
                    {currentOp === 'find' && t('api:request.findHint')}
                    {currentOp === 'findOne' && t('api:request.findOneHint')}
                  </p>
                </div>

                {/* Fields table for create/update */}
                {['create', 'update'].includes(currentOp) && (
                  <div className="border rounded-lg overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('api:request.field')}</TableHead>
                          <TableHead>{t('api:request.type')}</TableHead>
                          <TableHead className="text-center">{t('api:request.required')}</TableHead>
                          <TableHead>{t('api:request.default')}</TableHead>
                          <TableHead>{t('api:request.notes')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {columns.map((col: ColumnInfo) => {
                          const isSystem = ['id', 'created_at', 'updated_at', 'deleted_at'].includes(col.name);
                          const isRequired = currentOp === 'create' && !col.nullable && !col.default_value && !isSystem;
                          return (
                            <TableRow key={col.name} className={isSystem ? 'opacity-40' : ''}>
                              <TableCell className="font-mono text-sm">
                                {col.name}
                                {col.is_primary && <Badge variant="outline" className="ml-2 text-[10px] px-1 py-0">PK</Badge>}
                              </TableCell>
                              <TableCell>
                                <Badge variant="secondary" className="font-mono text-xs">{col.type}</Badge>
                              </TableCell>
                              <TableCell className="text-center">
                                {isSystem ? (
                                  <Minus className="h-4 w-4 mx-auto text-muted-foreground" />
                                ) : isRequired ? (
                                  <Tooltip>
                                    <TooltipTrigger>
                                      <AlertCircle className="h-4 w-4 mx-auto text-orange-500" />
                                    </TooltipTrigger>
                                    <TooltipContent>{t('api:request.requiredField')}</TooltipContent>
                                  </Tooltip>
                                ) : (
                                  <Check className="h-4 w-4 mx-auto text-muted-foreground" />
                                )}
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground font-mono">
                                {col.default_value ?? '—'}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {isSystem
                                  ? t('api:request.systemField')
                                  : isRequired
                                    ? t('api:request.mustProvide')
                                    : col.nullable
                                      ? t('api:request.optional')
                                      : col.default_value
                                        ? t('api:request.hasDefault')
                                        : t('api:request.optional')
                                }
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {/* Query params for find */}
                {currentOp === 'find' && (
                  <div className="space-y-4">
                    <div className="border rounded-lg overflow-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t('api:request.param')}</TableHead>
                            <TableHead>{t('api:request.type')}</TableHead>
                            <TableHead>{t('api:request.default')}</TableHead>
                            <TableHead>{t('api:request.description')}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {[
                            { name: 'page', type: 'number', def: '1', desc: t('api:request.pageDesc') },
                            { name: 'limit', type: 'number', def: '50', desc: t('api:request.limitDesc') },
                            { name: 'sort', type: 'string', def: 'created_at', desc: t('api:request.sortDesc') },
                            { name: 'order', type: 'string', def: 'desc', desc: t('api:request.orderDesc') },
                          ].map((p) => (
                            <TableRow key={p.name}>
                              <TableCell className="font-mono text-sm">{p.name}</TableCell>
                              <TableCell><Badge variant="secondary" className="font-mono text-xs">{p.type}</Badge></TableCell>
                              <TableCell className="font-mono text-sm text-muted-foreground">{p.def}</TableCell>
                              <TableCell className="text-sm text-muted-foreground">{p.desc}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>

                    {/* Filters section */}
                    <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
                      <h4 className="text-sm font-medium">{t('api:request.filtersTitle')}</h4>
                      <p className="text-xs text-muted-foreground">{t('api:request.filtersDesc')}</p>
                      <div className="space-y-1.5">
                        {[
                          { example: 'filter[role]=admin', desc: t('api:request.filterExEq') },
                          { example: 'filter[age][gte]=18', desc: t('api:request.filterExGte') },
                          { example: 'filter[status][in]=active,pending', desc: t('api:request.filterExIn') },
                          { example: 'filter[name][ilike]=%john%', desc: t('api:request.filterExIlike') },
                          { example: 'filter[deleted_at][is_null]=true', desc: t('api:request.filterExNull') },
                        ].map((f) => (
                          <div key={f.example} className="flex items-start gap-3">
                            <code className="text-xs font-mono bg-muted px-2 py-0.5 rounded shrink-0">{f.example}</code>
                            <span className="text-xs text-muted-foreground">{f.desc}</span>
                          </div>
                        ))}
                      </div>
                      <Separator className="my-2" />
                      <p className="text-xs text-muted-foreground font-medium">{t('api:request.filtersMultiTitle')}</p>
                      <div className="flex items-start gap-3">
                        <code className="text-xs font-mono bg-muted px-2 py-0.5 rounded shrink-0">filter[role]=admin&filter[age][gte]=18</code>
                        <span className="text-xs text-muted-foreground">{t('api:request.filtersMultiDesc')}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-2">
                        {t('api:request.filtersOps')}
                      </p>
                    </div>
                  </div>
                )}

                {/* Path param for findOne/update/delete */}
                {['findOne', 'update', 'delete'].includes(currentOp) && (() => {
                  const paramName = currentOp === 'findOne' ? String(form.source_config.search_column ?? 'id') : 'id';
                  const paramCol = columns.find((c) => c.name === paramName);
                  return (
                    <div className="border rounded-lg overflow-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t('api:request.param')}</TableHead>
                            <TableHead>{t('api:request.type')}</TableHead>
                            <TableHead className="text-center">{t('api:request.required')}</TableHead>
                            <TableHead>{t('api:request.description')}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          <TableRow>
                            <TableCell className="font-mono text-sm">{paramName}</TableCell>
                            <TableCell><Badge variant="secondary" className="font-mono text-xs">{paramCol?.type ?? 'uuid / number'}</Badge></TableCell>
                            <TableCell className="text-center"><AlertCircle className="h-4 w-4 mx-auto text-orange-500" /></TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {currentOp === 'findOne'
                                ? t('api:request.searchParamDesc', { column: paramName })
                                : t('api:request.idDesc')
                              }
                            </TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                  );
                })()}

                {/* Example request body */}
                {['create', 'update'].includes(currentOp) && columns.length > 0 && (
                  <>
                    <Separator />
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <Label className="text-sm font-medium">{t('api:request.exampleBody')}</Label>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => {
                            const example: Record<string, unknown> = {};
                            for (const col of columns) {
                              if (['id', 'created_at', 'updated_at', 'deleted_at'].includes(col.name)) continue;
                              example[col.name] = getExampleValue(col);
                            }
                            navigator.clipboard.writeText(JSON.stringify(example, null, 2));
                            toast.success(t('api:request.copied'));
                          }}
                        >
                          <Copy className="h-3 w-3 mr-1" />
                          {t('api:request.copyExample')}
                        </Button>
                      </div>
                      <pre className="bg-muted/50 rounded-lg p-4 text-sm font-mono overflow-auto max-h-[300px]">
                        {JSON.stringify(
                          (() => {
                            const example: Record<string, unknown> = {};
                            for (const col of columns) {
                              if (['id', 'created_at', 'updated_at', 'deleted_at'].includes(col.name)) continue;
                              example[col.name] = getExampleValue(col);
                            }
                            return example;
                          })(),
                          null,
                          2
                        )}
                      </pre>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          ) : form.source_type === 'custom_sql' ? (
            <>
              {/* Detected parameters */}
              {(() => {
                const query = String(form.source_config.query ?? '');
                const paramMatches = query.match(/\{\{(\w+)\}\}/g) ?? [];
                const paramNames = [...new Set(paramMatches.map((m) => m.replace(/\{|\}/g, '')))];
                const pathParams = (form.path.match(/:(\w+)/g) ?? []).map((p) => p.slice(1));

                return (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">{t('api:request.sqlParamsTitle')}</CardTitle>
                      <CardDescription>{t('api:request.sqlParamsDesc')}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {paramNames.length > 0 ? (
                        <>
                          <div className="border rounded-lg overflow-auto">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>{t('api:request.param')}</TableHead>
                                  <TableHead>{t('api:request.sqlSource')}</TableHead>
                                  <TableHead>{t('api:request.notes')}</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {paramNames.map((p) => {
                                  const fromPath = pathParams.includes(p);
                                  return (
                                    <TableRow key={p}>
                                      <TableCell className="font-mono text-sm font-medium">{`{{${p}}}`}</TableCell>
                                      <TableCell>
                                        <Badge variant={fromPath ? 'default' : 'secondary'}>
                                          {fromPath ? t('api:request.sqlSourcePath') : t('api:request.sqlSourceQueryOrBody')}
                                        </Badge>
                                      </TableCell>
                                      <TableCell className="text-sm text-muted-foreground">
                                        {fromPath ? `:${p} → ${t('api:request.requiredField')}` : `?${p}=value`}
                                      </TableCell>
                                    </TableRow>
                                  );
                                })}
                              </TableBody>
                            </Table>
                          </div>

                          {/* Example request */}
                          <div>
                            <Label className="text-sm font-medium mb-2 block">{t('api:request.sqlExampleTitle')}</Label>
                            <pre className="bg-muted/50 rounded-lg p-4 text-sm font-mono overflow-auto">
                              {(() => {
                                const method = form.method;
                                const pathExample = form.path.replace(/:(\w+)/g, (_, name) => `example_${name}`);
                                const queryOnlyParams = paramNames.filter((p) => !pathParams.includes(p));

                                let lines = `${method} /api/v1/slay-ball${pathExample}`;
                                if (queryOnlyParams.length > 0 && (method === 'GET' || method === 'DELETE')) {
                                  lines += '?' + queryOnlyParams.map((p) => `${p}=value`).join('&');
                                }
                                if (queryOnlyParams.length > 0 && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
                                  const body: Record<string, string> = {};
                                  queryOnlyParams.forEach((p) => { body[p] = 'value'; });
                                  lines += '\n\n' + JSON.stringify(body, null, 2);
                                }
                                return lines;
                              })()}
                            </pre>
                          </div>
                        </>
                      ) : (
                        <div className="flex items-start gap-3 rounded-lg bg-muted/50 p-3">
                          <Info className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                          <p className="text-sm text-muted-foreground">{t('api:request.sqlNoParams')}</p>
                        </div>
                      )}

                      {/* How params work */}
                      <div className="rounded-lg border p-4 space-y-2">
                        <p className="text-sm font-medium">{t('api:request.sqlHowParams')}</p>
                        <ul className="text-sm text-muted-foreground space-y-1 list-disc pl-4">
                          <li>{t('api:request.sqlHowParamsDesc1')}</li>
                          <li>{t('api:request.sqlHowParamsDesc2')}</li>
                          <li>{t('api:request.sqlHowParamsDesc3')}</li>
                          <li>{t('api:request.sqlHowParamsDesc4')}</li>
                        </ul>
                      </div>
                    </CardContent>
                  </Card>
                );
              })()}
            </>
          ) : (
            <Card>
              <CardContent>
                <p className="text-sm text-muted-foreground">{t('api:request.selectTableFirst')}</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ═══ Cache & Limits Tab ═══ */}
        <TabsContent value="cache" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-muted-foreground" />
                  <CardTitle className="text-base">{t('api:cache.title')}</CardTitle>
                </div>
                <Switch checked={form.cache_enabled} onCheckedChange={(v) => updateForm({ ...form, cache_enabled: v })} />
              </div>
              <CardDescription>{t('api:cache.desc')}</CardDescription>
            </CardHeader>
            {form.cache_enabled && (
              <CardContent className="space-y-5">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-sm">{t('api:cache.ttlLabel')}</Label>
                    <Badge variant="outline" className="font-mono text-xs">
                      {form.cache_ttl}s = {formatCacheTTL(form.cache_ttl)}
                    </Badge>
                  </div>
                  <Slider
                    value={[form.cache_ttl]}
                    onValueChange={(v: number) => updateForm({ ...form, cache_ttl: v })}
                    min={1}
                    max={3600}
                    step={1}
                  />
                  <div className="flex justify-between mt-1.5 text-xs text-muted-foreground">
                    <span>1s</span>
                    <span>5m</span>
                    <span>30m</span>
                    <span>1h</span>
                  </div>
                </div>

                <Separator />

                {/* Smart Invalidation */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-sm font-medium">{t('api:cache.smartInvalidation')}</Label>
                      <p className="text-xs text-muted-foreground mt-0.5">{t('api:cache.smartInvalidationDesc')}</p>
                    </div>
                    <Switch
                      checked={!!form.cache_invalidation}
                      onCheckedChange={(checked) => {
                        updateForm({
                          ...form,
                          cache_invalidation: checked
                            ? { on_insert: true, on_update: true, on_delete: true }
                            : null,
                        });
                      }}
                    />
                  </div>

                  {form.cache_invalidation && (
                    <div className="flex flex-wrap gap-3 rounded-lg border p-3 bg-muted/20">
                      {(['on_insert', 'on_update', 'on_delete'] as const).map((event) => (
                        <label key={event} className="flex items-center gap-2 cursor-pointer">
                          <Checkbox
                            checked={form.cache_invalidation?.[event] ?? false}
                            onCheckedChange={(checked) => {
                              updateForm({
                                ...form,
                                cache_invalidation: {
                                  ...form.cache_invalidation!,
                                  [event]: !!checked,
                                },
                              });
                            }}
                          />
                          <span className="text-sm">{t(`api:cache.event_${event}`)}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            )}
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-muted-foreground" />
                  <CardTitle className="text-base">{t('api:rateLimit.title')}</CardTitle>
                </div>
                <Switch checked={form.rate_limit_enabled} onCheckedChange={(v) => updateForm({ ...form, rate_limit_enabled: v })} />
              </div>
              <CardDescription>{t('api:rateLimit.desc')}</CardDescription>
            </CardHeader>
            {form.rate_limit_enabled && (
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">{t('api:rateLimit.maxRequests')}</Label>
                    <Input
                      type="number"
                      value={form.rate_limit_max}
                      onChange={(e) => updateForm({ ...form, rate_limit_max: Number(e.target.value) })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">{t('api:rateLimit.window')}</Label>
                    <Select
                      value={String(form.rate_limit_window)}
                      onValueChange={(v) => updateForm({ ...form, rate_limit_window: Number(v) })}
                    >
                      <SelectTrigger>
                        {{ '1000': t('api:rateLimit.1sec'), '10000': t('api:rateLimit.10sec'), '60000': t('api:rateLimit.1min'), '300000': t('api:rateLimit.5min'), '3600000': t('api:rateLimit.1hour') }[String(form.rate_limit_window)] ?? String(form.rate_limit_window)}
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1000">{t('api:rateLimit.1sec')}</SelectItem>
                        <SelectItem value="10000">{t('api:rateLimit.10sec')}</SelectItem>
                        <SelectItem value="60000">{t('api:rateLimit.1min')}</SelectItem>
                        <SelectItem value="300000">{t('api:rateLimit.5min')}</SelectItem>
                        <SelectItem value="3600000">{t('api:rateLimit.1hour')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            )}
          </Card>
        </TabsContent>

        {/* ═══ Response Tab ═══ */}
        <TabsContent value="response" className="mt-4 space-y-4">
          {selectedTable && columns.length > 0 ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t('api:response.fieldSelection')}</CardTitle>
                  <CardDescription>{t('api:response.fieldSelectionDesc')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="border rounded-lg overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10" />
                          <TableHead>{t('api:request.field')}</TableHead>
                          <TableHead>{t('api:request.type')}</TableHead>
                          <TableHead>{t('api:response.alias')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                    {columns.map((col) => {
                      const fieldCfg = form.response_config.fields[col.name] ?? { enabled: true, alias: '' };
                      return (
                        <TableRow key={col.name} className={!fieldCfg.enabled ? 'opacity-40' : ''}>
                          <TableCell>
                          <Checkbox
                            checked={fieldCfg.enabled}
                            onCheckedChange={(checked) => {
                              updateForm((prev) => ({
                                ...prev,
                                response_config: {
                                  ...prev.response_config,
                                  fields: {
                                    ...prev.response_config.fields,
                                    [col.name]: { ...fieldCfg, enabled: !!checked },
                                  },
                                },
                              }));
                            }}
                          />
                          </TableCell>
                          <TableCell className="font-mono text-sm">{col.name}</TableCell>
                          <TableCell><Badge variant="secondary" className="font-mono text-xs">{col.type}</Badge></TableCell>
                          <TableCell>
                          <Input
                            value={fieldCfg.alias}
                            onChange={(e) => {
                              updateForm((prev) => ({
                                ...prev,
                                response_config: {
                                  ...prev.response_config,
                                  fields: {
                                    ...prev.response_config.fields,
                                    [col.name]: { ...fieldCfg, alias: e.target.value },
                                  },
                                },
                              }));
                            }}
                            placeholder={col.name}
                            className="h-8 text-sm font-mono max-w-[200px]"
                          />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-base font-medium">{t('api:response.fkPopulate')}</Label>
                      <p className="text-sm text-muted-foreground mt-1">{t('api:response.fkPopulateDesc')}</p>
                    </div>
                    <Switch
                      checked={form.response_config.fk_populate}
                      onCheckedChange={(v) =>
                        updateForm((prev) => ({
                          ...prev,
                          response_config: { ...prev.response_config, fk_populate: v },
                        }))
                      }
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t('api:response.jsonPreview')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <pre className="bg-muted/50 rounded-lg p-4 text-sm font-mono overflow-auto max-h-[300px]">
                    {responsePreview}
                  </pre>
                </CardContent>
              </Card>

              {/* Response Example by operation */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t('api:response.exampleTitle')}</CardTitle>
                  <CardDescription>
                    {currentOp === 'find' && t('api:response.exampleFind')}
                    {currentOp === 'findOne' && t('api:response.exampleFindOne')}
                    {currentOp === 'create' && t('api:response.exampleCreate')}
                    {currentOp === 'update' && t('api:response.exampleUpdate')}
                    {currentOp === 'delete' && t('api:response.exampleDelete')}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(() => {
                    const rc = form.response_config;
                    const sampleRow: Record<string, unknown> = {};
                    for (const [field, cfg] of Object.entries(rc.fields)) {
                      if (!cfg.enabled) continue;
                      const key = cfg.alias || field;
                      const col = columns.find((c) => c.name === field);
                      const t = col?.type ?? 'text';
                      if (field === 'id') sampleRow[key] = 'uuid-1234-5678';
                      else if (t.includes('int') || t === 'numeric' || t === 'decimal' || t === 'float' || t === 'real' || t === 'double') sampleRow[key] = 42;
                      else if (t === 'boolean' || t === 'bool') sampleRow[key] = true;
                      else if (t.includes('timestamp') || t === 'date') sampleRow[key] = '2025-01-15T12:00:00Z';
                      else if (t === 'json' || t === 'jsonb') sampleRow[key] = {};
                      else sampleRow[key] = `example_${field}`;
                    }

                    let example: unknown;
                    let statusCode = 200;

                    if (currentOp === 'find') {
                      example = {
                        data: [sampleRow],
                        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
                      };
                    } else if (currentOp === 'findOne') {
                      example = sampleRow;
                    } else if (currentOp === 'create') {
                      statusCode = 201;
                      example = sampleRow;
                    } else if (currentOp === 'update') {
                      example = sampleRow;
                    } else if (currentOp === 'delete') {
                      statusCode = 204;
                      example = null;
                    } else {
                      example = sampleRow;
                    }

                    return (
                      <>
                        <div className="flex items-center gap-2">
                          <Badge variant={statusCode < 300 ? 'default' : 'secondary'}>{statusCode}</Badge>
                          <span className="text-xs text-muted-foreground">
                            {statusCode === 201 ? 'Created' : statusCode === 204 ? 'No Content' : 'OK'}
                          </span>
                        </div>
                        <pre className="bg-muted/50 rounded-lg p-4 text-sm font-mono overflow-auto max-h-[300px]">
                          {example === null ? '// No response body' : JSON.stringify(example, null, 2)}
                        </pre>
                      </>
                    );
                  })()}
                </CardContent>
              </Card>

              {/* Error Responses */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t('api:response.errorsTitle')}</CardTitle>
                  <CardDescription>{t('api:response.errorsDesc')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {(() => {
                      const errors: { code: number; error: string; when: string }[] = [];

                      if (form.auth_type === 'api_token') {
                        errors.push({ code: 401, error: 'API key required', when: 'X-API-Key header missing' });
                        errors.push({ code: 401, error: 'Invalid API key', when: 'Token not found or wrong project' });
                        errors.push({ code: 401, error: 'API key expired', when: 'Token past expiry date' });
                      }

                      if (currentOp === 'findOne') {
                        errors.push({ code: 400, error: `${String(form.source_config.search_column ?? 'id')} required`, when: 'Path parameter missing' });
                        errors.push({ code: 404, error: 'Record not found', when: 'No matching record' });
                      }
                      if (currentOp === 'update' || currentOp === 'delete') {
                        errors.push({ code: 400, error: 'id required', when: 'Record ID not provided' });
                        errors.push({ code: 404, error: 'Record not found', when: 'No record with this ID' });
                      }
                      if (currentOp === 'create') {
                        errors.push({ code: 400, error: 'Validation error', when: 'Required fields missing or invalid types' });
                        errors.push({ code: 409, error: 'Duplicate key', when: 'Unique constraint violated' });
                      }

                      errors.push({ code: 422, error: 'invalid input syntax for type uuid: "1"', when: 'Wrong data type (e.g. number instead of UUID)' });
                      errors.push({ code: 429, error: 'Too many requests', when: 'Rate limit exceeded' });
                      errors.push({ code: 500, error: 'Internal server error', when: 'Unexpected server error' });

                      return errors.map((err, i) => (
                        <div key={i} className="flex items-center gap-3 rounded-lg border px-4 py-2.5">
                          <Badge variant="destructive" className="shrink-0">{err.code}</Badge>
                          <code className="text-sm font-mono flex-1">{`{ "error": "${err.error}" }`}</code>
                          <span className="text-xs text-muted-foreground shrink-0">{err.when}</span>
                        </div>
                      ));
                    })()}
                  </div>
                </CardContent>
              </Card>

              {/* Response Headers */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t('api:response.headersTitle')}</CardTitle>
                  <CardDescription>{t('api:response.headersDesc')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="border rounded-lg overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Header</TableHead>
                          <TableHead>{t('api:request.description')}</TableHead>
                          <TableHead>{t('api:request.notes')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        <TableRow>
                          <TableCell className="font-mono text-sm">Content-Type</TableCell>
                          <TableCell className="text-sm text-muted-foreground">application/json</TableCell>
                          <TableCell><Badge variant="secondary">{t('api:response.headerAlways')}</Badge></TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-mono text-sm">X-Cache</TableCell>
                          <TableCell className="text-sm text-muted-foreground">HIT | MISS</TableCell>
                          <TableCell><Badge variant="secondary">{t('api:response.headerWhenCacheOn')}</Badge></TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-mono text-sm">X-EP-RateLimit-Limit</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{t('api:rateLimit.maxRequests')}</TableCell>
                          <TableCell><Badge variant="secondary">{t('api:response.headerWhenRateLimit')}</Badge></TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-mono text-sm">X-EP-RateLimit-Remaining</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{t('api:rateLimit.window')}</TableCell>
                          <TableCell><Badge variant="secondary">{t('api:response.headerWhenRateLimit')}</Badge></TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-mono text-sm">X-EP-RateLimit-Reset</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{t('api:rateLimit.window')} (sec)</TableCell>
                          <TableCell><Badge variant="secondary">{t('api:response.headerWhenRateLimit')}</Badge></TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-mono text-sm">X-Deprecated</TableCell>
                          <TableCell className="text-sm text-muted-foreground">true</TableCell>
                          <TableCell><Badge variant="secondary">{t('api:response.headerWhenDeprecated')}</Badge></TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-mono text-sm">X-Deprecated-At</TableCell>
                          <TableCell className="text-sm text-muted-foreground">ISO 8601 date</TableCell>
                          <TableCell><Badge variant="secondary">{t('api:response.headerWhenDeprecated')}</Badge></TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-mono text-sm">x-ratelimit-limit</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{t('api:rateLimit.title')} ({t('api:rateLimit.maxRequests')})</TableCell>
                          <TableCell><Badge variant="secondary">{t('api:response.headerAlways')}</Badge></TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-mono text-sm">x-ratelimit-remaining</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{t('api:rateLimit.title')} ({t('api:rateLimit.window')})</TableCell>
                          <TableCell><Badge variant="secondary">{t('api:response.headerAlways')}</Badge></TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-mono text-sm">x-ratelimit-reset</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{t('api:rateLimit.title')} (sec)</TableCell>
                          <TableCell><Badge variant="secondary">{t('api:response.headerAlways')}</Badge></TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </>
          ) : form.source_type === 'custom_sql' ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t('api:response.sqlResponseTitle')}</CardTitle>
                  <CardDescription>{t('api:response.sqlResponseDesc')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Response examples based on SQL type */}
                  {(() => {
                    const query = String(form.source_config.query ?? '').trim().toUpperCase();
                    const isSelect = query.startsWith('SELECT') || !query;
                    const isInsert = query.startsWith('INSERT');
                    const isUpdate = query.startsWith('UPDATE');
                    const isDelete = query.startsWith('DELETE');
                    const hasReturning = query.includes('RETURNING');

                    let example: unknown;
                    let statusCode = 200;
                    let hint = t('api:response.sqlResponseSelectHint');

                    if (isSelect || !query) {
                      example = [
                        { column1: 'value1', column2: 42 },
                        { column1: 'value2', column2: 99 },
                      ];
                    } else if (isInsert || isUpdate) {
                      hint = t('api:response.sqlResponseInsertHint');
                      if (isInsert) statusCode = 201;
                      example = hasReturning
                        ? [{ id: 'uuid-1234', column1: 'value' }]
                        : { rowCount: 1 };
                    } else if (isDelete) {
                      hint = t('api:response.sqlResponseInsertHint');
                      example = hasReturning
                        ? [{ id: 'uuid-1234' }]
                        : { rowCount: 1 };
                    } else {
                      example = [{ result: '...' }];
                    }

                    return (
                      <>
                        <div className="flex items-start gap-3 rounded-lg bg-muted/50 p-3">
                          <Info className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                          <p className="text-sm text-muted-foreground">{hint}</p>
                        </div>

                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <Badge variant={statusCode < 300 ? 'default' : 'secondary'}>{statusCode}</Badge>
                            <span className="text-xs text-muted-foreground">
                              {statusCode === 201 ? 'Created' : 'OK'}
                            </span>
                          </div>
                          <pre className="bg-muted/50 rounded-lg p-4 text-sm font-mono overflow-auto max-h-[300px]">
                            {JSON.stringify(example, null, 2)}
                          </pre>
                        </div>

                        {(isInsert || isUpdate) && !hasReturning && (
                          <div className="flex items-start gap-3 rounded-lg border border-blue-500/30 bg-blue-500/10 p-3">
                            <Info className="h-4 w-4 mt-0.5 text-blue-500 shrink-0" />
                            <p className="text-sm text-blue-600 dark:text-blue-400">{t('api:response.sqlResponseTip')}</p>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </CardContent>
              </Card>

              {/* Error responses for custom SQL */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t('api:response.errorsTitle')}</CardTitle>
                  <CardDescription>{t('api:response.errorsDesc')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {(() => {
                      const errors: { code: number; error: string; when: string }[] = [];
                      if (form.auth_type === 'api_token') {
                        errors.push({ code: 401, error: 'API key required', when: 'X-API-Key header missing' });
                        errors.push({ code: 401, error: 'Invalid API key', when: 'Token not found or wrong project' });
                      }
                      errors.push({ code: 400, error: 'Missing parameter: name', when: 'Required {{param}} not provided' });
                      errors.push({ code: 422, error: 'invalid input syntax for type...', when: 'Wrong data type in parameter' });
                      errors.push({ code: 429, error: 'Too many requests', when: 'Rate limit exceeded' });
                      errors.push({ code: 500, error: 'Internal server error', when: 'SQL syntax error or server issue' });
                      return errors.map((err, i) => (
                        <div key={i} className="flex items-center gap-3 rounded-lg border px-4 py-2.5">
                          <Badge variant="destructive" className="shrink-0">{err.code}</Badge>
                          <code className="text-sm font-mono flex-1">{`{ "error": "${err.error}" }`}</code>
                          <span className="text-xs text-muted-foreground shrink-0">{err.when}</span>
                        </div>
                      ));
                    })()}
                  </div>
                </CardContent>
              </Card>

              {/* Response Headers (same as table-based) */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t('api:response.headersTitle')}</CardTitle>
                  <CardDescription>{t('api:response.headersDesc')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="border rounded-lg overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Header</TableHead>
                          <TableHead>{t('api:request.description')}</TableHead>
                          <TableHead>{t('api:request.notes')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        <TableRow>
                          <TableCell className="font-mono text-sm">Content-Type</TableCell>
                          <TableCell className="text-sm text-muted-foreground">application/json</TableCell>
                          <TableCell><Badge variant="secondary">{t('api:response.headerAlways')}</Badge></TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-mono text-sm">X-Cache</TableCell>
                          <TableCell className="text-sm text-muted-foreground">HIT | MISS</TableCell>
                          <TableCell><Badge variant="secondary">{t('api:response.headerWhenCacheOn')}</Badge></TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-mono text-sm">X-EP-RateLimit-Limit</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{t('api:rateLimit.maxRequests')}</TableCell>
                          <TableCell><Badge variant="secondary">{t('api:response.headerWhenRateLimit')}</Badge></TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-mono text-sm">X-EP-RateLimit-Remaining</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{t('api:rateLimit.window')}</TableCell>
                          <TableCell><Badge variant="secondary">{t('api:response.headerWhenRateLimit')}</Badge></TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-mono text-sm">X-EP-RateLimit-Reset</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{t('api:rateLimit.window')} (sec)</TableCell>
                          <TableCell><Badge variant="secondary">{t('api:response.headerWhenRateLimit')}</Badge></TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-mono text-sm">X-Deprecated</TableCell>
                          <TableCell className="text-sm text-muted-foreground">true</TableCell>
                          <TableCell><Badge variant="secondary">{t('api:response.headerWhenDeprecated')}</Badge></TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-mono text-sm">X-Deprecated-At</TableCell>
                          <TableCell className="text-sm text-muted-foreground">ISO 8601 date</TableCell>
                          <TableCell><Badge variant="secondary">{t('api:response.headerWhenDeprecated')}</Badge></TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-mono text-sm">x-ratelimit-limit</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{t('api:rateLimit.title')} ({t('api:rateLimit.maxRequests')})</TableCell>
                          <TableCell><Badge variant="secondary">{t('api:response.headerAlways')}</Badge></TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-mono text-sm">x-ratelimit-remaining</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{t('api:rateLimit.title')} ({t('api:rateLimit.window')})</TableCell>
                          <TableCell><Badge variant="secondary">{t('api:response.headerAlways')}</Badge></TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-mono text-sm">x-ratelimit-reset</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{t('api:rateLimit.title')} (sec)</TableCell>
                          <TableCell><Badge variant="secondary">{t('api:response.headerAlways')}</Badge></TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </>
          ) : (
            <Card>
              <CardContent>
                <p className="text-sm text-muted-foreground">{t('api:response.selectTableFirst')}</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ═══ Test Tab ═══ */}
        {!isNew && (
          <TabsContent value="test" className="mt-4 space-y-4">
            {/* Unsaved warning */}
            {isDirty && (
              <div className="flex items-center gap-3 rounded-lg border border-orange-500/30 bg-orange-500/10 px-4 py-3">
                <AlertCircle className="h-4 w-4 text-orange-500 shrink-0" />
                <p className="text-sm text-orange-600 dark:text-orange-400 flex-1">{t('api:tester.unsavedWarning')}</p>
                <Button size="sm" variant="outline" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                  <Save className="h-3 w-3 mr-1" />
                  {t('common:actions.save')}
                </Button>
              </div>
            )}

            {/* Request builder + Send */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Play className="h-4 w-4 text-muted-foreground" />
                    <CardTitle className="text-base">{t('api:tester.title')}</CardTitle>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => testMutation.mutate()}
                    disabled={testMutation.isPending || isDirty}
                  >
                    <Play className="h-3.5 w-3.5 mr-1.5" />
                    {testMutation.isPending ? t('api:tester.sending') : t('api:tester.send')}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                {/* Request URL preview */}
                <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
                  <Badge className={`font-mono text-xs border shrink-0 ${METHOD_COLORS[form.method] ?? ''}`} variant="outline">
                    {form.method}
                  </Badge>
                  <code className="text-sm font-mono text-muted-foreground truncate">{fullPath}</code>
                </div>

                {/* URL Params */}
                {form.path.includes(':') && (
                  <div>
                    <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2 block">{t('api:tester.urlParams')}</Label>
                    <div className="space-y-2">
                      {(form.path.match(/:(\w+)/g) ?? []).map((param) => {
                        const name = param.slice(1);
                        return (
                          <div key={name} className="grid grid-cols-[100px_1fr] gap-2 items-center">
                            <Label className="text-sm font-mono text-muted-foreground text-right">:{name}</Label>
                            <Input
                              value={testParams[name] ?? ''}
                              onChange={(e) => setTestParams((prev) => ({ ...prev, [name]: e.target.value }))}
                              placeholder={`Enter ${name}...`}
                              className="h-9 text-sm font-mono"
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Query Params */}
                {['GET', 'DELETE'].includes(form.method) && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('api:tester.queryParams')}</Label>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => setTestQuery((prev) => ({ ...prev, [''] : '' }))}
                      >
                        + {t('api:tester.addParam')}
                      </Button>
                    </div>
                    {Object.keys(testQuery).length > 0 ? (
                      <div className="space-y-2">
                        {Object.entries(testQuery).map(([key, val], idx) => (
                          <div key={idx} className="grid grid-cols-[1fr_auto_1fr_auto] gap-2 items-center">
                            <Input
                              value={key}
                              onChange={(e) => {
                                setTestQuery((prev) => {
                                  const entries = Object.entries(prev);
                                  entries[idx] = [e.target.value, val];
                                  return Object.fromEntries(entries);
                                });
                              }}
                              placeholder="key"
                              className="h-9 text-sm font-mono"
                            />
                            <span className="text-muted-foreground text-sm">=</span>
                            <Input
                              value={val}
                              onChange={(e) => setTestQuery((prev) => ({ ...prev, [key]: e.target.value }))}
                              placeholder="value"
                              className="h-9 text-sm font-mono"
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
                              onClick={() => setTestQuery((prev) => {
                                const entries = Object.entries(prev);
                                entries.splice(idx, 1);
                                return Object.fromEntries(entries);
                              })}
                            >
                              <Minus className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed py-4 text-center">
                        <p className="text-xs text-muted-foreground">{t('api:tester.noParams')}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Request Body */}
                {['POST', 'PUT', 'PATCH'].includes(form.method) && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('api:tester.requestBody')}</Label>
                      {selectedTable && columns.length > 0 && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => {
                            const example: Record<string, unknown> = {};
                            for (const col of columns) {
                              if (['id', 'created_at', 'updated_at', 'deleted_at'].includes(col.name)) continue;
                              example[col.name] = getExampleValue(col);
                            }
                            setTestBody(JSON.stringify(example, null, 2));
                          }}
                        >
                          {t('api:tester.fillExample')}
                        </Button>
                      )}
                    </div>
                    <Textarea
                      value={testBody}
                      onChange={(e) => setTestBody(e.target.value)}
                      className="font-mono text-sm min-h-[140px] bg-muted/30"
                      placeholder={'{\n  "field": "value"\n}'}
                    />
                  </div>
                )}

                {/* Custom Headers */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Headers</Label>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setTestHeaders((prev) => ({ ...prev, ['']: '' }))}
                    >
                      + Add Header
                    </Button>
                  </div>
                  {Object.keys(testHeaders).length > 0 ? (
                    <div className="space-y-2">
                      {Object.entries(testHeaders).map(([key, val], idx) => (
                        <div key={idx} className="grid grid-cols-[1fr_auto_1fr_auto] gap-2 items-center">
                          <Input
                            value={key}
                            onChange={(e) => {
                              setTestHeaders((prev) => {
                                const entries = Object.entries(prev);
                                entries[idx] = [e.target.value, val];
                                return Object.fromEntries(entries);
                              });
                            }}
                            placeholder="Header name"
                            className="h-9 text-sm font-mono"
                          />
                          <span className="text-muted-foreground text-sm">:</span>
                          <Input
                            value={val}
                            onChange={(e) => setTestHeaders((prev) => ({ ...prev, [key]: e.target.value }))}
                            placeholder="value"
                            className="h-9 text-sm font-mono"
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
                            onClick={() => setTestHeaders((prev) => {
                              const entries = Object.entries(prev);
                              entries.splice(idx, 1);
                              return Object.fromEntries(entries);
                            })}
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed py-4 text-center">
                      <p className="text-xs text-muted-foreground">No custom headers</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Response */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base">{t('api:tester.response')}</CardTitle>
                  </div>
                  {testResult && (
                    <div className="flex items-center gap-2">
                      <Badge variant={testResult.status >= 200 && testResult.status < 300 ? 'default' : 'destructive'} className="font-mono">
                        {testResult.status}
                      </Badge>
                      <Badge variant="outline" className="font-mono text-xs">
                        {testResult.duration_ms}ms
                      </Badge>
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {testResult ? (
                  <pre className="bg-muted/30 rounded-lg p-4 text-sm font-mono overflow-auto max-h-[400px] border">
                    {testResult.error
                      ? testResult.error
                      : JSON.stringify(testResult.data, null, 2)}
                  </pre>
                ) : (
                  <div className="rounded-lg border border-dashed py-10 text-center">
                    <Play className="h-8 w-8 mx-auto text-muted-foreground/30 mb-2" />
                    <p className="text-sm text-muted-foreground">{t('api:tester.noResult')}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </PageWrapper>
  );
}
