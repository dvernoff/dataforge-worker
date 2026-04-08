import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Play, Plus, Save, Trash2, FolderOpen, Clock, ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  ResizableHandle, ResizablePanel, ResizablePanelGroup,
} from '@/components/ui/resizable';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { useCurrentProject } from '@/hooks/useProject';
import { usePageTitle } from '@/hooks/usePageTitle';
import { api } from '@/api/client';
import { toast } from 'sonner';

interface SavedRequest {
  id: string;
  name: string;
  collection: string;
  method: string;
  url: string;
  headers: { key: string; value: string }[];
  body: string;
  auth: string;
}

interface HistoryEntry {
  id: string;
  method: string;
  url: string;
  status: number;
  duration: number;
  timestamp: Date;
}

interface ResponseData {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  duration: number;
}

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

const METHOD_COLORS: Record<string, string> = {
  GET: 'text-green-500',
  POST: 'text-blue-500',
  PUT: 'text-amber-500',
  PATCH: 'text-purple-500',
  DELETE: 'text-red-500',
};

export function APIPlaygroundPage() {
  const { t } = useTranslation(['common']);
  usePageTitle(t('common:nav.apiPlayground'));
  const { data: project } = useCurrentProject();

  const [method, setMethod] = useState('GET');
  const [url, setUrl] = useState('');
  const [headers, setHeaders] = useState<{ key: string; value: string }[]>([
    { key: 'Content-Type', value: 'application/json' },
  ]);
  const [body, setBody] = useState('');
  const [auth, setAuth] = useState('none');
  const [authToken, setAuthToken] = useState('');
  const [sending, setSending] = useState(false);
  const [response, setResponse] = useState<ResponseData | null>(null);
  const [activeTab, setActiveTab] = useState('collections');
  const [requestTab, setRequestTab] = useState('headers');

  const storageKey = project?.id ? `df-playground-${project.id}` : null;
  const [storageLoaded, setStorageLoaded] = useState(false);

  const [collections, setCollections] = useState<SavedRequest[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    if (!storageKey) return;
    try {
      const rawC = localStorage.getItem(`${storageKey}-collections`);
      if (rawC) setCollections(JSON.parse(rawC));
      const rawH = localStorage.getItem(`${storageKey}-history`);
      if (rawH) setHistory(JSON.parse(rawH));
    } catch {}
    setStorageLoaded(true);
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey || !storageLoaded) return;
    try { localStorage.setItem(`${storageKey}-collections`, JSON.stringify(collections)); } catch {}
  }, [collections, storageKey, storageLoaded]);

  useEffect(() => {
    if (!storageKey || !storageLoaded) return;
    try { localStorage.setItem(`${storageKey}-history`, JSON.stringify(history)); } catch {}
  }, [history, storageKey, storageLoaded]);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveCollection, setSaveCollection] = useState('Default');

  const sendRequest = useCallback(async () => {
    if (!url || !project?.id) return;
    setSending(true);
    setResponse(null);

    try {
      const reqHeaders: Record<string, string> = {};
      headers.forEach((h) => {
        if (h.key && h.value) reqHeaders[h.key] = h.value;
      });

      if (auth === 'bearer' && authToken) {
        reqHeaders['Authorization'] = `Bearer ${authToken}`;
      }

      const res = await api.post<ResponseData>(`/projects/${project.id}/api-playground/proxy`, {
        url,
        method,
        headers: reqHeaders,
        body: body && method !== 'GET' && method !== 'HEAD' ? body : undefined,
      });

      setResponse(res);

      setHistory((prev) => [{
        id: crypto.randomUUID(),
        method,
        url,
        status: res.status,
        duration: res.duration,
        timestamp: new Date(),
      }, ...prev].slice(0, 50));
    } catch (err: any) {
      setResponse({
        status: 0,
        statusText: 'Network Error',
        headers: {},
        body: err.message ?? 'Failed to connect',
        duration: 0,
      });
    } finally {
      setSending(false);
    }
  }, [url, method, headers, body, auth, authToken, project?.id]);

  const saveRequest = useCallback(() => {
    if (!saveName) return;
    const newReq: SavedRequest = {
      id: crypto.randomUUID(),
      name: saveName,
      collection: saveCollection,
      method,
      url,
      headers,
      body,
      auth,
    };
    setCollections((prev) => [...prev, newReq]);
    setSaveDialogOpen(false);
    setSaveName('');
    toast.success(t('common:playground.saved'));
  }, [saveName, saveCollection, method, url, headers, body, auth, t]);

  const loadRequest = useCallback((req: SavedRequest) => {
    setMethod(req.method);
    setUrl(req.url);
    setHeaders(req.headers);
    setBody(req.body);
    setAuth(req.auth);
  }, []);

  const loadHistoryEntry = useCallback((entry: HistoryEntry) => {
    setMethod(entry.method);
    setUrl(entry.url);
  }, []);

  const addHeader = () => setHeaders((prev) => [...prev, { key: '', value: '' }]);
  const removeHeader = (i: number) => setHeaders((prev) => prev.filter((_, idx) => idx !== i));
  const updateHeader = (i: number, field: 'key' | 'value', value: string) => {
    setHeaders((prev) => prev.map((h, idx) => idx === i ? { ...h, [field]: value } : h));
  };

  const statusColor = (status: number) => {
    if (status >= 200 && status < 300) return 'bg-green-500/10 text-green-500 border-green-500/30';
    if (status >= 400 && status < 500) return 'bg-amber-500/10 text-amber-500 border-amber-500/30';
    if (status >= 500) return 'bg-red-500/10 text-red-500 border-red-500/30';
    return 'bg-muted text-muted-foreground';
  };

  // Group collections
  const collectionGroups = collections.reduce<Record<string, SavedRequest[]>>((acc, req) => {
    const group = req.collection || 'Default';
    if (!acc[group]) acc[group] = [];
    acc[group].push(req);
    return acc;
  }, {});

  return (
    <PageWrapper>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('common:nav.apiPlayground')}</h1>
      </div>

      <ResizablePanelGroup direction="horizontal" className="min-h-[600px] rounded-lg border">
        {/* Left: Collections & History */}
        <ResizablePanel defaultSize={20} minSize={15}>
          <div className="h-full flex flex-col">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
              <TabsList className="w-full rounded-none border-b">
                <TabsTrigger value="collections" className="flex-1">
                  <FolderOpen className="h-3 w-3 mr-1" />
                  {t('common:playground.collections')}
                </TabsTrigger>
                <TabsTrigger value="history" className="flex-1">
                  <Clock className="h-3 w-3 mr-1" />
                  {t('common:playground.history')}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="collections" className="flex-1 m-0">
                <ScrollArea className="h-[550px]">
                  <div className="p-2 space-y-3">
                    {Object.keys(collectionGroups).length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-8">
                        {t('common:playground.noCollections')}
                      </p>
                    ) : (
                      Object.entries(collectionGroups).map(([group, reqs]) => (
                        <div key={group}>
                          <p className="text-xs font-medium text-muted-foreground px-2 mb-1">{group}</p>
                          {reqs.map((req) => (
                            <button
                              key={req.id}
                              className="w-full text-left px-2 py-1.5 rounded-md hover:bg-accent text-xs flex items-center gap-2"
                              onClick={() => loadRequest(req)}
                            >
                              <span className={`font-mono font-bold text-[10px] ${METHOD_COLORS[req.method] ?? ''}`}>
                                {req.method}
                              </span>
                              <span className="truncate">{req.name}</span>
                            </button>
                          ))}
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="history" className="flex-1 m-0">
                <ScrollArea className="h-[550px]">
                  <div className="p-2 space-y-0.5">
                    {history.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-8">
                        {t('common:playground.noHistory')}
                      </p>
                    ) : (
                      history.map((entry) => (
                        <button
                          key={entry.id}
                          className="w-full text-left px-2 py-1.5 rounded-md hover:bg-accent text-xs flex items-center gap-2"
                          onClick={() => loadHistoryEntry(entry)}
                        >
                          <span className={`font-mono font-bold text-[10px] ${METHOD_COLORS[entry.method] ?? ''}`}>
                            {entry.method}
                          </span>
                          <span className="truncate flex-1">{entry.url}</span>
                          <Badge variant="outline" className={`text-[10px] ${statusColor(entry.status)}`}>
                            {entry.status}
                          </Badge>
                        </button>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </div>
        </ResizablePanel>

        <ResizableHandle />

        {/* Center: Request Editor */}
        <ResizablePanel defaultSize={45} minSize={30}>
          <div className="h-full flex flex-col p-4 space-y-4">
            {/* URL bar */}
            <div className="flex gap-2">
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger className="w-[110px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HTTP_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      <span className={`font-mono font-bold ${METHOD_COLORS[m] ?? ''}`}>{m}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={t('common:playground.urlPlaceholder')}
                className="flex-1 font-mono text-sm"
                onKeyDown={(e) => e.key === 'Enter' && sendRequest()}
              />
              <Button onClick={sendRequest} disabled={sending || !url}>
                <Play className="h-4 w-4 mr-2" />
                {sending ? t('common:playground.sending') : t('common:playground.send')}
              </Button>
              <Button variant="outline" size="icon" onClick={() => setSaveDialogOpen(true)}>
                <Save className="h-4 w-4" />
              </Button>
            </div>

            {/* Request tabs */}
            <Tabs value={requestTab} onValueChange={setRequestTab} className="flex-1 flex flex-col">
              <TabsList>
                <TabsTrigger value="headers">{t('common:playground.headers')}</TabsTrigger>
                <TabsTrigger value="body">{t('common:playground.body')}</TabsTrigger>
                <TabsTrigger value="auth">{t('common:playground.auth')}</TabsTrigger>
              </TabsList>

              <TabsContent value="headers" className="flex-1">
                <div className="space-y-2">
                  {headers.map((h, i) => (
                    <div key={i} className="flex gap-2">
                      <Input
                        value={h.key}
                        onChange={(e) => updateHeader(i, 'key', e.target.value)}
                        placeholder="Header name"
                        className="flex-1 text-sm"
                      />
                      <Input
                        value={h.value}
                        onChange={(e) => updateHeader(i, 'value', e.target.value)}
                        placeholder="Value"
                        className="flex-1 text-sm"
                      />
                      <Button variant="ghost" size="icon" onClick={() => removeHeader(i)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={addHeader}>
                    <Plus className="h-3 w-3 mr-1" />
                    {t('common:playground.addHeader')}
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="body" className="flex-1">
                <Textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder={t('common:playground.bodyPlaceholder')}
                  className="min-h-[300px] font-mono text-sm resize-none"
                />
              </TabsContent>

              <TabsContent value="auth" className="flex-1">
                <div className="space-y-4">
                  <div>
                    <Label>{t('common:playground.authType')}</Label>
                    <Select value={auth} onValueChange={setAuth}>
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{t('common:playground.noAuth')}</SelectItem>
                        <SelectItem value="bearer">Bearer Token</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {auth === 'bearer' && (
                    <div>
                      <Label>Token</Label>
                      <Input
                        value={authToken}
                        onChange={(e) => setAuthToken(e.target.value)}
                        placeholder="Enter token..."
                        className="mt-1 font-mono text-sm"
                      />
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </ResizablePanel>

        <ResizableHandle />

        {/* Right: Response */}
        <ResizablePanel defaultSize={35} minSize={20}>
          <div className="h-full flex flex-col p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium text-sm">{t('common:playground.response')}</h3>
              {response && (
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={statusColor(response.status)}>
                    {response.status} {response.statusText}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{response.duration}ms</span>
                </div>
              )}
            </div>

            {response ? (
              <ScrollArea className="flex-1">
                <pre className="text-xs font-mono whitespace-pre-wrap break-words p-3 bg-muted rounded-md">
                  {response.body}
                </pre>
              </ScrollArea>
            ) : (
              <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
                {t('common:playground.noResponse')}
              </div>
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* Save Request Dialog */}
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('common:playground.saveRequest')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>{t('common:table.name')}</Label>
              <Input
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder={t('common:playground.requestNamePlaceholder')}
                className="mt-1"
              />
            </div>
            <div>
              <Label>{t('common:playground.collection')}</Label>
              <Input
                value={saveCollection}
                onChange={(e) => setSaveCollection(e.target.value)}
                placeholder="Default"
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveDialogOpen(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button onClick={saveRequest} disabled={!saveName}>
              <Save className="h-4 w-4 mr-2" />
              {t('common:actions.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageWrapper>
  );
}
