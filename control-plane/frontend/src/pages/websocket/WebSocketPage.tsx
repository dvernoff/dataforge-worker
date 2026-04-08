import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Copy, Radio, Users, ArrowUpDown, Save, Key } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { useCurrentProject } from '@/hooks/useProject';
import { usePageTitle } from '@/hooks/usePageTitle';
import { toast } from 'sonner';
import { schemaApi } from '@/api/schema.api';
import { api } from '@/api/client';

interface TableSubscription {
  table: string;
  insert: boolean;
  update: boolean;
  delete: boolean;
}

export function WebSocketPage() {
  const { t } = useTranslation(['api', 'common']);
  usePageTitle(t('api:websocket.title'));
  const { data: project } = useCurrentProject();
  const navigate = useNavigate();

  const { data: tablesData } = useQuery({
    queryKey: ['tables', project?.id],
    queryFn: () => schemaApi.listTables(project!.id),
    enabled: !!project?.id,
  });

  const { data: wsStats } = useQuery({
    queryKey: ['ws-stats', project?.id],
    queryFn: () => api.get<{ connectedClients: number; messagesSent: number; messagesReceived: number }>(`/projects/${project!.id}/ws-stats`),
    enabled: !!project?.id,
    refetchInterval: 10_000,
  });

  const tables = tablesData?.tables ?? [];

  const storageKey = project?.id ? `df-ws-subs:${project.id}` : '';
  const [subscriptions, setSubscriptions] = useState<TableSubscription[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!storageKey || !tables.length) return;
    if (loaded) return;
    let saved: TableSubscription[] = [];
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) saved = JSON.parse(raw);
    } catch {}
    const savedMap = new Map(saved.map((s) => [s.table, s]));
    const merged = tables.map((t) => savedMap.get(t.name) ?? { table: t.name, insert: false, update: false, delete: false });
    setSubscriptions(merged);
    setLoaded(true);
  }, [storageKey, tables, loaded]);

  const toggleEvent = (tableName: string, event: 'insert' | 'update' | 'delete') => {
    setSubscriptions((prev) =>
      prev.map((s) =>
        s.table === tableName ? { ...s, [event]: !s[event] } : s
      )
    );
  };

  const nodeBaseUrl = project?.node_url?.replace(/\/$/, '') ?? window.location.origin;
  const wsProtocol = nodeBaseUrl.startsWith('https') ? 'wss' : 'ws';
  const wsHost = nodeBaseUrl.replace(/^https?:\/\//, '');
  const wsUrl = project?.slug
    ? `${wsProtocol}://${wsHost}/ws/v1/${project.slug}?token=YOUR_API_KEY`
    : '';

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(wsUrl);
    toast.success(t('api:websocket.urlCopied'));
  };

  const handleSave = () => {
    if (storageKey) {
      localStorage.setItem(storageKey, JSON.stringify(subscriptions));
    }
    toast.success(t('api:websocket.subscriptionsSaved'));
  };

  const exampleMessage = JSON.stringify(
    {
      event: 'INSERT',
      table: 'users',
      data: { id: '...', name: '...', email: '...' },
      timestamp: '2024-01-01T00:00:00Z',
    },
    null,
    2
  );

  const jsExample = `const ws = new WebSocket('${wsUrl || 'ws://host/ws/v1/project-slug?token=YOUR_API_KEY'}');

ws.onopen = () => {
  console.log('Connected to WebSocket');
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log(data.event, data.table, data.data);
};

ws.onclose = () => {
  console.log('Disconnected');
};`;

  const basePath = project?.slug ? `/projects/${project.slug}` : '';

  return (
    <PageWrapper>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Radio className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">{t('api:websocket.title')}</h1>
        </div>
      </div>

      {/* Auth info banner */}
      <Alert className="mb-4">
        <Key className="h-4 w-4" />
        <AlertDescription className="flex items-center justify-between">
          <span>
            {t('api:websocket.authInfo')}{' '}
            <button
              onClick={() => navigate(`${basePath}/settings/tokens`)}
              className="text-primary hover:underline font-medium"
            >
              {t('api:websocket.manageTokens')}
            </button>
          </span>
        </AlertDescription>
      </Alert>

      {/* Connection URL */}
      {wsUrl && (
        <div className="mb-6 flex items-center gap-2">
          <code className="text-xs bg-muted px-3 py-1.5 rounded font-mono flex-1 truncate">
            {wsUrl}
          </code>
          <Button variant="ghost" size="sm" onClick={handleCopyUrl}>
            <Copy className="h-3 w-3" />
          </Button>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardContent>
            <div className="flex items-center gap-3">
              <Users className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">{t('api:websocket.connectedClients')}</p>
                <p className="text-2xl font-bold">{wsStats?.connectedClients ?? 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <div className="flex items-center gap-3">
              <ArrowUpDown className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">{t('api:websocket.messagesSent')}</p>
                <p className="text-2xl font-bold">{wsStats?.messagesSent ?? 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <div className="flex items-center gap-3">
              <ArrowUpDown className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">{t('api:websocket.messagesReceived')}</p>
                <p className="text-2xl font-bold">{wsStats?.messagesReceived ?? 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Table Subscriptions */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">{t('api:websocket.subscriptions')}</CardTitle>
            <Button size="sm" onClick={handleSave}>
              <Save className="h-3 w-3 mr-1" />
              {t('common:actions.save')}
            </Button>
          </CardHeader>
          <CardContent>
            {subscriptions.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('api:websocket.noTables')}</p>
            ) : (
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50 border-b">
                      <th className="text-left px-3 py-2 font-medium">{t('api:websocket.table')}</th>
                      <th className="text-center px-3 py-2 font-medium">INSERT</th>
                      <th className="text-center px-3 py-2 font-medium">UPDATE</th>
                      <th className="text-center px-3 py-2 font-medium">DELETE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subscriptions.map((sub) => (
                      <tr key={sub.table} className="border-b last:border-0">
                        <td className="px-3 py-2 font-mono text-xs">{sub.table}</td>
                        <td className="px-3 py-2 text-center">
                          <Switch
                            checked={sub.insert}
                            onCheckedChange={() => toggleEvent(sub.table, 'insert')}
                          />
                        </td>
                        <td className="px-3 py-2 text-center">
                          <Switch
                            checked={sub.update}
                            onCheckedChange={() => toggleEvent(sub.table, 'update')}
                          />
                        </td>
                        <td className="px-3 py-2 text-center">
                          <Switch
                            checked={sub.delete}
                            onCheckedChange={() => toggleEvent(sub.table, 'delete')}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Example Message */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('api:websocket.exampleMessage')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-3">
              {t('api:websocket.exampleDesc')}
            </p>
            <pre className="bg-muted/50 rounded-lg p-4 text-sm font-mono overflow-auto">
              {exampleMessage}
            </pre>
          </CardContent>
        </Card>
      </div>

      {/* Connection Guide */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">{t('api:websocket.connectionGuide')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="outline">JavaScript</Badge>
            </div>
            <pre className="bg-muted/50 rounded-lg p-4 text-xs font-mono overflow-auto">
              {jsExample}
            </pre>
          </div>
        </CardContent>
      </Card>
    </PageWrapper>
  );
}
