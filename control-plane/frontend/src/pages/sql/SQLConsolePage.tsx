import { useState, useCallback } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Play, Zap, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Textarea } from '@/components/ui/textarea';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { useCurrentProject } from '@/hooks/useProject';
import { api } from '@/api/client';
import { usePageTitle } from '@/hooks/usePageTitle';

interface SQLResult {
  rows: Record<string, unknown>[];
  fields: string[];
  rowCount: number;
  duration_ms: number;
}

interface ExplainResult {
  plan: string[];
  duration_ms: number;
}

export function SQLConsolePage() {
  const { t } = useTranslation('sql');
  usePageTitle(t('pageTitle'));
  const { data: project } = useCurrentProject();
  const [query, setQuery] = useState('SELECT 1;');
  const [result, setResult] = useState<SQLResult | null>(null);
  const [explainResult, setExplainResult] = useState<ExplainResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('results');

  const { data: explorerData } = useQuery({
    queryKey: ['sql-explorer', project?.id],
    queryFn: () => api.get<{ tables: { table_name: string; columns: { name: string; type: string; nullable: boolean }[] }[] }>(
      `/projects/${project!.id}/sql/explorer`
    ),
    enabled: !!project?.id,
  });

  const executeMutation = useMutation({
    mutationFn: () => api.post<SQLResult>(`/projects/${project!.id}/sql/execute`, { query }),
    onSuccess: (data) => {
      setResult(data);
      setError(null);
      setActiveTab('results');
    },
    onError: (err: Error) => {
      setError(err.message);
      setResult(null);
      setActiveTab('messages');
    },
  });

  const explainMutation = useMutation({
    mutationFn: () => api.post<ExplainResult>(`/projects/${project!.id}/sql/explain`, { query }),
    onSuccess: (data) => {
      setExplainResult(data);
      setError(null);
      setActiveTab('explain');
    },
    onError: (err: Error) => {
      setError(err.message);
      setActiveTab('messages');
    },
  });

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      executeMutation.mutate();
    }
  }, [executeMutation]);

  const tables = explorerData?.tables ?? [];

  return (
    <PageWrapper className="p-0 h-[calc(100vh-3.5rem)]">
      <div className="flex h-full relative">
        <div className="w-56 border-r hidden lg:block">
          <div className="p-3 border-b">
            <h3 className="text-sm font-medium text-muted-foreground">{t('explorer.tables')}</h3>
          </div>
          <ScrollArea className="h-[calc(100%-2.5rem)]">
            <div className="p-2">
              {tables.map((tbl) => (
                <Collapsible key={tbl.table_name}>
                  <CollapsibleTrigger className="flex items-center gap-1 w-full p-1.5 text-sm hover:bg-muted/50 rounded text-left">
                    <ChevronRight className="h-3 w-3 shrink-0" />
                    <span className="font-mono text-xs truncate">{tbl.table_name}</span>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="ml-5 space-y-0.5">
                      {tbl.columns.map((col) => (
                        <div
                          key={col.name}
                          className="text-[11px] font-mono text-muted-foreground py-0.5 px-1 hover:bg-muted/30 rounded cursor-pointer"
                          onClick={() => setQuery((prev) => prev + col.name)}
                        >
                          {col.name} <span className="text-muted-foreground/50">{col.type}</span>
                        </div>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              ))}
            </div>
          </ScrollArea>
        </div>

        <div className="flex-1 flex flex-col">
          <ResizablePanelGroup direction="vertical">
            <ResizablePanel defaultSize={55} minSize={20}>
              <div className="h-full flex flex-col">
                <div className="flex items-center gap-2 p-2 border-b">
                  <Button
                    size="sm"
                    onClick={() => executeMutation.mutate()}
                    disabled={executeMutation.isPending}
                  >
                    <Play className="h-3 w-3 mr-1" />
                    {executeMutation.isPending ? t('toolbar.running') : t('toolbar.run')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => explainMutation.mutate()}
                    disabled={explainMutation.isPending}
                  >
                    <Zap className="h-3 w-3 mr-1" />
                    {t('toolbar.explain')}
                  </Button>
                  <span className="text-xs text-muted-foreground ml-auto">{t('toolbar.ctrlEnterHint')}</span>
                </div>

                <div className="flex-1 p-0">
                  <Textarea
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="h-full min-h-full rounded-none border-0 resize-none font-mono text-sm focus-visible:ring-0"
                    placeholder={t('toolbar.placeholder')}
                    spellCheck={false}
                  />
                </div>
              </div>
            </ResizablePanel>

            <ResizableHandle withHandle />

            <ResizablePanel defaultSize={45} minSize={15}>
              <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
                <TabsList className="w-full justify-start rounded-none border-b px-2">
                  <TabsTrigger value="results" className="text-xs">
                    {t('tabs.results')}
                    {result && <Badge variant="secondary" className="ml-1 text-[10px]">{result.rowCount}</Badge>}
                  </TabsTrigger>
                  <TabsTrigger value="messages" className="text-xs">{t('tabs.messages')}</TabsTrigger>
                  <TabsTrigger value="explain" className="text-xs">{t('tabs.explain')}</TabsTrigger>
                </TabsList>

                <TabsContent value="results" className="flex-1 m-0 overflow-auto">
                  {result ? (
                    <div>
                      <div className="px-3 py-1.5 bg-muted/30 text-xs text-muted-foreground border-b flex gap-4">
                        <span>{t('results.rows', { count: result.rowCount })}</span>
                        <span>{result.duration_ms}ms</span>
                      </div>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {result.fields.map((f) => (
                              <TableHead key={f} className="font-mono text-xs whitespace-nowrap">{f}</TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {result.rows.map((row, i) => (
                            <TableRow key={i}>
                              {result.fields.map((f) => (
                                <TableCell key={f} className="font-mono text-xs max-w-[200px] truncate">
                                  {row[f] === null ? <span className="text-muted-foreground italic">NULL</span> : String(row[f])}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                      {t('results.empty')}
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="messages" className="flex-1 m-0 p-4">
                  {error ? (
                    <pre className="text-sm font-mono text-destructive whitespace-pre-wrap">{error}</pre>
                  ) : (
                    <p className="text-sm text-muted-foreground">{t('messages.empty')}</p>
                  )}
                </TabsContent>

                <TabsContent value="explain" className="flex-1 m-0 p-4">
                  {explainResult ? (
                    <div>
                      <p className="text-xs text-muted-foreground mb-2">{explainResult.duration_ms}ms</p>
                      <pre className="text-sm font-mono whitespace-pre-wrap">
                        {explainResult.plan.join('\n')}
                      </pre>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">{t('explain.empty')}</p>
                  )}
                </TabsContent>
              </Tabs>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      </div>
    </PageWrapper>
  );
}
