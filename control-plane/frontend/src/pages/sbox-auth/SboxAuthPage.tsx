import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Users, Wifi, UserPlus, ShieldCheck, Trash2,
  LogOut, Globe, ArrowRight, Settings, Plug,
  BookOpen, Code, CheckCircle2, Copy,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { useCurrentProject } from '@/hooks/useProject';
import { useFeaturesStore } from '@/stores/features.store';
import { usePageTitle } from '@/hooks/usePageTitle';
import { sboxAuthApi } from '@/api/sbox-auth.api';
import { pluginsApi } from '@/api/plugins.api';
import { endpointsApi } from '@/api/endpoints.api';
import { schemaApi } from '@/api/schema.api';
import { toast } from 'sonner';

const PLUGIN_ID = 'sbox-auth';

const METHOD_COLORS: Record<string, string> = {
  GET: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  POST: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  PUT: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  PATCH: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
  DELETE: 'bg-red-500/10 text-red-600 border-red-500/20',
};

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diff = now - date;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (seconds < 60) return `${seconds}s ago`;
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

export function SboxAuthPage() {
  const { t } = useTranslation(['sbox-auth', 'common']);
  usePageTitle(t('sbox-auth:pageTitle'));
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: project } = useCurrentProject();
  const { isFeatureEnabled: _isFeatureEnabled } = useFeaturesStore();

  const isPluginEnabled = _isFeatureEnabled(slug, PLUGIN_ID);
  const projectId = project?.id;

  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);
  const [settingsForm, setSettingsForm] = useState<Record<string, string | number>>({
    service_name: '',
    session_table: '',
    steam_id_column: '',
    session_key_column: '',
    session_ttl_minutes: 1440,
  });
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [copiedSnippet, setCopiedSnippet] = useState<string | null>(null);

  const statsQuery = useQuery({
    queryKey: ['sbox-auth', 'stats', projectId],
    queryFn: () => sboxAuthApi.getStats(projectId!),
    enabled: !!projectId && isPluginEnabled,
  });

  const sessionsQuery = useQuery({
    queryKey: ['sbox-auth', 'sessions', projectId],
    queryFn: () => sboxAuthApi.getSessions(projectId!),
    enabled: !!projectId && isPluginEnabled,
  });

  const playerProfileQuery = useQuery({
    queryKey: ['sbox-auth', 'player', projectId, selectedPlayer],
    queryFn: () => sboxAuthApi.getPlayerProfile(projectId!, selectedPlayer!),
    enabled: !!projectId && !!selectedPlayer,
  });

  const settingsQuery = useQuery({
    queryKey: ['sbox-auth', 'settings', projectId],
    queryFn: () => pluginsApi.getSettings(projectId!, PLUGIN_ID),
    enabled: !!projectId && isPluginEnabled,
  });

  const tablesQuery = useQuery({
    queryKey: ['tables', projectId],
    queryFn: () => schemaApi.listTables(projectId!),
    enabled: !!projectId && isPluginEnabled,
  });

  const selectedTableName = String(settingsForm.session_table || '');
  const columnsQuery = useQuery({
    queryKey: ['table-columns', projectId, selectedTableName],
    queryFn: () => schemaApi.getTable(projectId!, selectedTableName),
    enabled: !!projectId && !!selectedTableName && isPluginEnabled,
  });

  if (settingsQuery.data && !settingsLoaded) {
    const saved = settingsQuery.data.settings ?? {};
    setSettingsForm({
      service_name: (saved.service_name as string) ?? 'my-game-server',
      session_table: (saved.session_table as string) ?? 'players',
      steam_id_column: (saved.steam_id_column as string) ?? 'steam_id',
      session_key_column: (saved.session_key_column as string) ?? 'session_key',
      session_ttl_minutes: (saved.session_ttl_minutes as number) ?? 1440,
    });
    setSettingsLoaded(true);
  }

  const endpointsQuery = useQuery({
    queryKey: ['sbox-auth', 'endpoints', projectId],
    queryFn: () => endpointsApi.list(projectId!),
    enabled: !!projectId && isPluginEnabled,
    select: (data) => data.endpoints.filter((ep) => ep.auth_type === 'sbox_session'),
  });

  const kickMutation = useMutation({
    mutationFn: (steamId: string) => sboxAuthApi.revokeSession(projectId!, steamId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sbox-auth', 'sessions', projectId] });
      queryClient.invalidateQueries({ queryKey: ['sbox-auth', 'stats', projectId] });
      toast.success(t('sbox-auth:players.kicked'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const kickAllMutation = useMutation({
    mutationFn: () => sboxAuthApi.revokeAll(projectId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sbox-auth', 'sessions', projectId] });
      queryClient.invalidateQueries({ queryKey: ['sbox-auth', 'stats', projectId] });
      toast.success(t('sbox-auth:players.kickedAll'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const cleanupMutation = useMutation({
    mutationFn: () => sboxAuthApi.cleanup(projectId!),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['sbox-auth', 'sessions', projectId] });
      queryClient.invalidateQueries({ queryKey: ['sbox-auth', 'stats', projectId] });
      toast.success(t('sbox-auth:players.cleanupDone', { count: data.cleaned }));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const saveSettingsMutation = useMutation({
    mutationFn: (settings: Record<string, unknown>) =>
      pluginsApi.updateSettings(projectId!, PLUGIN_ID, settings),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sbox-auth', 'settings', projectId] });
      toast.success(t('sbox-auth:settings.saved'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (!isPluginEnabled) {
    return (
      <PageWrapper>
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <ShieldCheck className="h-16 w-16 text-muted-foreground/50 mb-6" />
          <h2 className="text-xl font-semibold mb-2">{t('sbox-auth:pluginDisabled')}</h2>
          <p className="text-muted-foreground mb-6 max-w-md">{t('sbox-auth:pluginDisabledDesc')}</p>
          <Button asChild>
            <Link to={`/projects/${slug}/settings/plugins`}>
              <Plug className="h-4 w-4 mr-2" />
              {t('sbox-auth:goToPlugins')}
            </Link>
          </Button>
        </div>
      </PageWrapper>
    );
  }

  const sessions = sessionsQuery.data?.sessions ?? [];
  const stats = statsQuery.data;
  const sboxEndpoints = endpointsQuery.data ?? [];
  const playerProfile = playerProfileQuery.data?.player;
  const tables = tablesQuery.data?.tables ?? [];
  const columns = columnsQuery.data?.table?.columns ?? [];

  function copySnippet(id: string, text: string) {
    navigator.clipboard.writeText(text);
    setCopiedSnippet(id);
    setTimeout(() => setCopiedSnippet(null), 2000);
  }

  const loginUrl = `POST /api/v1/${slug}/sbox_login`;
  const sessionUrl = `POST /api/v1/${slug}/sbox_session`;
  const logoutUrl = `POST /api/v1/${slug}/sbox_logout`;

  return (
    <PageWrapper>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('sbox-auth:pageTitle')}</h1>
      </div>

      <Tabs defaultValue="dashboard" className="w-full">
        <TabsList className="mb-6">
          <TabsTrigger value="dashboard">{t('sbox-auth:tabs.dashboard')}</TabsTrigger>
          <TabsTrigger value="players">{t('sbox-auth:tabs.players')}</TabsTrigger>
          <TabsTrigger value="settings">{t('sbox-auth:tabs.settings')}</TabsTrigger>
          <TabsTrigger value="endpoints">{t('sbox-auth:tabs.endpoints')}</TabsTrigger>
          <TabsTrigger value="docs">
            <BookOpen className="h-3.5 w-3.5 mr-1.5" />
            {t('sbox-auth:tabs.docs')}
          </TabsTrigger>
        </TabsList>

        {/* ===== Dashboard ===== */}
        <TabsContent value="dashboard">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {statsQuery.isLoading ? (
              <>{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28" />)}</>
            ) : (
              <>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">{t('sbox-auth:stats.totalPlayers')}</CardTitle>
                    <Users className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent><div className="text-2xl font-bold">{stats?.total ?? 0}</div></CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">{t('sbox-auth:stats.onlineNow')}</CardTitle>
                    <Wifi className="h-4 w-4 text-emerald-500" />
                  </CardHeader>
                  <CardContent><div className="text-2xl font-bold">{stats?.online ?? 0}</div></CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">{t('sbox-auth:stats.newToday')}</CardTitle>
                    <UserPlus className="h-4 w-4 text-blue-500" />
                  </CardHeader>
                  <CardContent><div className="text-2xl font-bold">{stats?.newToday ?? 0}</div></CardContent>
                </Card>
              </>
            )}
          </div>
        </TabsContent>

        {/* ===== Players ===== */}
        <TabsContent value="players">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-muted-foreground">{t('sbox-auth:tabs.players')}</p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => cleanupMutation.mutate()} disabled={cleanupMutation.isPending}>
                <Trash2 className="h-4 w-4 mr-1" />{t('sbox-auth:players.cleanup')}
              </Button>
              <Button variant="destructive" size="sm" onClick={() => { if (window.confirm(t('sbox-auth:players.kickAllConfirm'))) kickAllMutation.mutate(); }} disabled={kickAllMutation.isPending || sessions.length === 0}>
                <LogOut className="h-4 w-4 mr-1" />{t('sbox-auth:players.kickAll')}
              </Button>
            </div>
          </div>

          {sessionsQuery.isLoading ? (
            <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : sessions.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>{t('sbox-auth:players.noPlayers')}</p>
              <p className="text-sm mt-1">{t('sbox-auth:players.noPlayersDesc')}</p>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('sbox-auth:players.steamId')}</TableHead>
                    <TableHead>{t('sbox-auth:players.lastActive')}</TableHead>
                    <TableHead>{t('sbox-auth:players.createdAt')}</TableHead>
                    <TableHead>{t('sbox-auth:players.status')}</TableHead>
                    <TableHead className="text-right">{t('sbox-auth:players.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sessions.map((session) => {
                    const steamId = String(session.steam_id ?? session.steamId ?? '');
                    const hasSession = session.session_key != null;
                    return (
                      <TableRow key={steamId} className="cursor-pointer" onClick={() => setSelectedPlayer(steamId)}>
                        <TableCell className="font-mono text-sm">{steamId}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {session.last_active_at ? formatRelativeTime(String(session.last_active_at)) : '-'}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {session.created_at ? new Date(String(session.created_at)).toLocaleDateString() : '-'}
                        </TableCell>
                        <TableCell>
                          <Badge variant={hasSession ? 'default' : 'secondary'} className={hasSession ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' : ''}>
                            {hasSession ? t('sbox-auth:players.online') : t('sbox-auth:players.offline')}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); kickMutation.mutate(steamId); }} disabled={kickMutation.isPending}>
                            <LogOut className="h-4 w-4 mr-1" />{t('sbox-auth:players.kick')}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* ===== Settings ===== */}
        <TabsContent value="settings">
          {settingsQuery.isLoading ? (
            <div className="space-y-4 max-w-xl">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
          ) : (
            <div className="max-w-xl space-y-6">
              <div className="space-y-2">
                <Label>{t('sbox-auth:settings.serviceName')}</Label>
                <Input
                  value={String(settingsForm.service_name)}
                  onChange={(e) => setSettingsForm({ ...settingsForm, service_name: e.target.value })}
                  placeholder="my-sbox-game"
                />
                <p className="text-xs text-muted-foreground">{t('sbox-auth:settings.serviceNameDesc')}</p>
              </div>

              <div className="space-y-2">
                <Label>{t('sbox-auth:settings.sessionTable')}</Label>
                <Select
                  value={String(settingsForm.session_table)}
                  onValueChange={(v) => {
                    setSettingsForm({ ...settingsForm, session_table: v, steam_id_column: '', session_key_column: '' });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('sbox-auth:settings.selectTable')} />
                  </SelectTrigger>
                  <SelectContent>
                    {tables.map((tbl) => (
                      <SelectItem key={tbl.name} value={tbl.name}>{tbl.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{t('sbox-auth:settings.sessionTableDesc')}</p>
              </div>

              {selectedTableName && columns.length > 0 && (
                <>
                  <div className="space-y-2">
                    <Label>{t('sbox-auth:settings.steamIdColumn')}</Label>
                    <Select
                      value={String(settingsForm.steam_id_column)}
                      onValueChange={(v) => setSettingsForm({ ...settingsForm, steam_id_column: v })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t('sbox-auth:settings.selectColumn')} />
                      </SelectTrigger>
                      <SelectContent>
                        {columns.map((col) => (
                          <SelectItem key={col.name} value={col.name}>
                            <span className="font-mono text-xs">{col.name}</span>
                            <span className="text-muted-foreground text-xs ml-2">({col.type})</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>{t('sbox-auth:settings.sessionKeyColumn')}</Label>
                    <Select
                      value={String(settingsForm.session_key_column)}
                      onValueChange={(v) => setSettingsForm({ ...settingsForm, session_key_column: v })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t('sbox-auth:settings.selectColumn')} />
                      </SelectTrigger>
                      <SelectContent>
                        {columns.map((col) => (
                          <SelectItem key={col.name} value={col.name}>
                            <span className="font-mono text-xs">{col.name}</span>
                            <span className="text-muted-foreground text-xs ml-2">({col.type})</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}

              {selectedTableName && columns.length === 0 && !columnsQuery.isLoading && (
                <p className="text-sm text-amber-600">{t('sbox-auth:settings.tableNotFound')}</p>
              )}

              <div className="space-y-2">
                <Label>{t('sbox-auth:settings.sessionTtl')}</Label>
                <Input
                  type="number"
                  min={0}
                  value={Number(settingsForm.session_ttl_minutes)}
                  onChange={(e) => setSettingsForm({ ...settingsForm, session_ttl_minutes: Number(e.target.value) })}
                  placeholder="1440"
                />
                <p className="text-xs text-muted-foreground">{t('sbox-auth:settings.sessionTtlDesc')}</p>
              </div>

              <Button onClick={() => saveSettingsMutation.mutate(settingsForm)} disabled={saveSettingsMutation.isPending}>
                <Settings className="h-4 w-4 mr-2" />
                {saveSettingsMutation.isPending ? '...' : t('common:actions.save', 'Save')}
              </Button>
            </div>
          )}
        </TabsContent>

        {/* ===== Endpoints ===== */}
        <TabsContent value="endpoints">
          <div className="mb-4">
            <h3 className="text-sm font-medium mb-1">{t('sbox-auth:endpoints.title')}</h3>
            <p className="text-sm text-muted-foreground">{t('sbox-auth:endpoints.desc')}</p>
          </div>

          {endpointsQuery.isLoading ? (
            <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : sboxEndpoints.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Globe className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>{t('sbox-auth:endpoints.noEndpoints')}</p>
              <p className="text-sm mt-1">{t('sbox-auth:endpoints.noEndpointsDesc')}</p>
              <Button variant="outline" size="sm" className="mt-4" onClick={() => navigate(`/projects/${slug}/endpoints/new`)}>
                <ArrowRight className="h-4 w-4 mr-2" />
                {t('sbox-auth:endpoints.goToBuilder')}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('sbox-auth:endpoints.method')}</TableHead>
                      <TableHead>{t('sbox-auth:endpoints.path')}</TableHead>
                      <TableHead>{t('sbox-auth:endpoints.description')}</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sboxEndpoints.map((ep) => (
                      <TableRow key={ep.id} className="cursor-pointer" onClick={() => navigate(`/projects/${slug}/endpoints/${ep.id}`)}>
                        <TableCell>
                          <Badge variant="outline" className={METHOD_COLORS[ep.method.toUpperCase()] ?? ''}>{ep.method.toUpperCase()}</Badge>
                        </TableCell>
                        <TableCell className="font-mono text-sm">{ep.path}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{ep.description ?? '-'}</TableCell>
                        <TableCell><ArrowRight className="h-4 w-4 text-muted-foreground" /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <Button variant="outline" size="sm" onClick={() => navigate(`/projects/${slug}/endpoints/new`)}>
                {t('sbox-auth:endpoints.createNew')}
              </Button>
            </div>
          )}
        </TabsContent>

        {/* ===== Docs ===== */}
        <TabsContent value="docs">
          <div className="max-w-2xl space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('sbox-auth:docs.howItWorks')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex gap-3 items-start">
                  <Badge variant="outline" className="shrink-0 mt-0.5">1</Badge>
                  <p>{t('sbox-auth:docs.step1')}</p>
                </div>
                <div className="flex gap-3 items-start">
                  <Badge variant="outline" className="shrink-0 mt-0.5">2</Badge>
                  <p>{t('sbox-auth:docs.step2')}</p>
                </div>
                <div className="flex gap-3 items-start">
                  <Badge variant="outline" className="shrink-0 mt-0.5">3</Badge>
                  <p>{t('sbox-auth:docs.step3')}</p>
                </div>
                <div className="flex gap-3 items-start">
                  <Badge variant="outline" className="shrink-0 mt-0.5">4</Badge>
                  <p>{t('sbox-auth:docs.step4')}</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('sbox-auth:docs.apiEndpoints')}</CardTitle>
                <CardDescription>{t('sbox-auth:docs.apiEndpointsDesc')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {[
                  { label: 'Login', url: loginUrl, body: '{ "token": "<facepunch_token>" }', response: '{ "session_key": "...", "steam_id": "...", "is_new_player": true }' },
                  { label: 'Session Check', url: sessionUrl, body: '{ "session_key": "<session_key>" }', response: '{ "valid": true, "player": { ... } }' },
                  { label: 'Logout', url: logoutUrl, body: '{ "session_key": "<session_key>" }', response: '{ "success": true }' },
                ].map((ep) => (
                  <div key={ep.label} className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/20 text-xs">POST</Badge>
                        <code className="text-xs font-mono">{ep.url}</code>
                      </div>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copySnippet(ep.label, ep.url)}>
                        {copiedSnippet === ep.label ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <p className="text-[10px] uppercase text-muted-foreground mb-1">Body</p>
                        <pre className="text-xs bg-muted p-2 rounded font-mono overflow-x-auto">{ep.body}</pre>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase text-muted-foreground mb-1">Response</p>
                        <pre className="text-xs bg-muted p-2 rounded font-mono overflow-x-auto">{ep.response}</pre>
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('sbox-auth:docs.sboxClient')}</CardTitle>
                <CardDescription>{t('sbox-auth:docs.sboxClientDesc')}</CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="text-xs bg-muted p-4 rounded-lg font-mono overflow-x-auto whitespace-pre">{`// S&box client-side (C#)
var token = await Sandbox.Services.Auth.GetToken("${settingsForm.service_name || 'my-game-server'}");

// Send to your DataForge backend
var response = await Http.PostJsonAsync(
  "https://your-domain/api/v1/${slug}/sbox_login",
  new { token }
);

// Store session_key for future requests
var sessionKey = response.session_key;`}</pre>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('sbox-auth:docs.protectEndpoint')}</CardTitle>
                <CardDescription>{t('sbox-auth:docs.protectEndpointDesc')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex gap-3 items-start">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                  <p>{t('sbox-auth:docs.protectStep1')}</p>
                </div>
                <div className="flex gap-3 items-start">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                  <p>{t('sbox-auth:docs.protectStep2')}</p>
                </div>
                <div className="flex gap-3 items-start">
                  <Code className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                  <div>
                    <p>{t('sbox-auth:docs.protectStep3')}</p>
                    <pre className="text-xs bg-muted p-2 rounded font-mono mt-1">{'SELECT * FROM scores WHERE steam_id = {{player_steam_id}}'}</pre>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Player Profile Dialog */}
      <Dialog open={!!selectedPlayer} onOpenChange={(open) => !open && setSelectedPlayer(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('sbox-auth:players.profile')}</DialogTitle>
            <DialogDescription className="font-mono">{selectedPlayer}</DialogDescription>
          </DialogHeader>
          {playerProfileQuery.isLoading ? (
            <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
          ) : playerProfile ? (
            <div className="space-y-3 max-h-[60vh] overflow-y-auto">
              {Object.entries(playerProfile).map(([key, value]) => (
                <div key={key} className="flex items-start justify-between gap-4 py-1 border-b last:border-0">
                  <span className="text-sm font-medium text-muted-foreground whitespace-nowrap">{key}</span>
                  <span className="text-sm text-right break-all">{String(value ?? '-')}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('sbox-auth:players.noPlayers')}</p>
          )}
          <div className="flex justify-between mt-2">
            <Button variant="outline" size="sm" onClick={() => setSelectedPlayer(null)}>{t('sbox-auth:players.backToList')}</Button>
            {selectedPlayer && (
              <Button variant="destructive" size="sm" onClick={() => { kickMutation.mutate(selectedPlayer); setSelectedPlayer(null); }} disabled={kickMutation.isPending}>
                <LogOut className="h-4 w-4 mr-1" />{t('sbox-auth:players.kick')}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </PageWrapper>
  );
}
