import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Play, Save, Plus, Trash2, ChevronDown, ChevronRight,
  Database, Globe, Webhook, ArrowRightLeft, GitBranch,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Skeleton } from '@/components/ui/skeleton';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { useCurrentProject } from '@/hooks/useProject';
import { flowsApi } from '@/api/flows.api';
import { toast } from 'sonner';
import { usePageTitle } from '@/hooks/usePageTitle';

interface FlowNode {
  id: string;
  type: string;
  config: Record<string, unknown>;
  next?: string | null;
  trueBranch?: string | null;
  falseBranch?: string | null;
}

const NODE_TYPE_ICONS: Record<string, typeof Database> = {
  action_sql: Database,
  action_http: Globe,
  action_webhook: Webhook,
  action_transform: ArrowRightLeft,
  condition: GitBranch,
};

const NODE_TYPES = ['action_sql', 'action_http', 'action_webhook', 'action_transform', 'condition'] as const;
const OPERATORS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'exists', 'empty'] as const;

export function FlowEditorPage() {
  const { t } = useTranslation(['flows', 'common']);
  usePageTitle(t('flows:editFlow'));
  const { id } = useParams<{ id: string }>();
  const { data: project } = useCurrentProject();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [triggerType, setTriggerType] = useState('manual');
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: ['flow', project?.id, id],
    queryFn: () => flowsApi.getById(project!.id, id!),
    enabled: !!project?.id && !!id,
  });

  useEffect(() => {
    if (data?.flow) {
      const flow = data.flow;
      setName(String(flow.name ?? ''));
      setDescription(String(flow.description ?? ''));
      setTriggerType(String(flow.trigger_type ?? 'manual'));
      const parsed = typeof flow.nodes === 'string' ? JSON.parse(flow.nodes as string) : (flow.nodes ?? []);
      setNodes(Array.isArray(parsed) ? parsed : []);
    }
  }, [data]);

  const updateMutation = useMutation({
    mutationFn: () => {
      // Link nodes sequentially
      const linkedNodes = nodes.map((node, i) => {
        if (node.type !== 'condition') {
          return { ...node, next: nodes[i + 1]?.id ?? null };
        }
        return node;
      });
      return flowsApi.update(project!.id, id!, { name, description, trigger_type: triggerType, nodes: linkedNodes });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flow', project?.id, id] });
      queryClient.invalidateQueries({ queryKey: ['flows', project?.id] });
      toast.success(t('flows:flowUpdated'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const runMutation = useMutation({
    mutationFn: () => flowsApi.run(project!.id, id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flow', project?.id, id] });
      toast.success(t('flows:flowTriggered'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const runs = (data?.runs ?? []) as Record<string, unknown>[];
  const slug = project?.slug ?? '';

  if (isLoading) {
    return <PageWrapper><Skeleton className="h-96" /></PageWrapper>;
  }

  function addNode(type: string) {
    const nodeId = `node_${Date.now()}`;
    setNodes([...nodes, { id: nodeId, type, config: {} }]);
    setExpandedNodes((prev) => new Set(prev).add(nodeId));
  }

  function removeNode(nodeId: string) {
    setNodes(nodes.filter((n) => n.id !== nodeId));
  }

  function updateNodeConfig(nodeId: string, key: string, value: unknown) {
    setNodes(nodes.map((n) => n.id === nodeId ? { ...n, config: { ...n.config, [key]: value } } : n));
  }

  function toggleExpanded(nodeId: string) {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }

  function renderNodeConfig(node: FlowNode) {
    switch (node.type) {
      case 'action_sql':
        return (
          <div className="space-y-3">
            <div>
              <Label>{t('flows:nodes.config.query')}</Label>
              <Textarea
                value={String(node.config.query ?? '')}
                onChange={(e) => updateNodeConfig(node.id, 'query', e.target.value)}
                placeholder={t('flows:nodes.config.queryPlaceholder')}
                className="mt-1 font-mono text-sm"
                rows={4}
              />
            </div>
          </div>
        );
      case 'action_http':
        return (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t('flows:nodes.config.url')}</Label>
                <Input value={String(node.config.url ?? '')} onChange={(e) => updateNodeConfig(node.id, 'url', e.target.value)} placeholder={t('flows:nodes.config.urlPlaceholder')} className="mt-1" />
              </div>
              <div>
                <Label>{t('flows:nodes.config.method')}</Label>
                <Select value={String(node.config.method ?? 'GET')} onValueChange={(v) => updateNodeConfig(node.id, 'method', v)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>{t('flows:nodes.config.headers')}</Label>
              <Textarea value={typeof node.config.headers === 'object' ? JSON.stringify(node.config.headers, null, 2) : String(node.config.headers ?? '{}')} onChange={(e) => { try { updateNodeConfig(node.id, 'headers', JSON.parse(e.target.value)); } catch { /* ignore */ } }} className="mt-1 font-mono text-sm" rows={2} />
            </div>
            <div>
              <Label>{t('flows:nodes.config.body')}</Label>
              <Textarea value={typeof node.config.body === 'object' ? JSON.stringify(node.config.body, null, 2) : String(node.config.body ?? '')} onChange={(e) => { try { updateNodeConfig(node.id, 'body', JSON.parse(e.target.value)); } catch { /* ignore */ } }} className="mt-1 font-mono text-sm" rows={3} />
            </div>
          </div>
        );
      case 'action_webhook':
        return (
          <div className="space-y-3">
            <div>
              <Label>{t('flows:nodes.config.webhookUrl')}</Label>
              <Input value={String(node.config.url ?? '')} onChange={(e) => updateNodeConfig(node.id, 'url', e.target.value)} placeholder={t('flows:nodes.config.urlPlaceholder')} className="mt-1" />
            </div>
            <div>
              <Label>{t('flows:nodes.config.payload')}</Label>
              <Textarea value={typeof node.config.payload === 'object' ? JSON.stringify(node.config.payload, null, 2) : String(node.config.payload ?? '{}')} onChange={(e) => { try { updateNodeConfig(node.id, 'payload', JSON.parse(e.target.value)); } catch { /* ignore */ } }} className="mt-1 font-mono text-sm" rows={3} />
            </div>
          </div>
        );
      case 'action_transform':
        return (
          <div className="space-y-3">
            <div>
              <Label>{t('flows:nodes.config.operation')}</Label>
              <Select value={String(node.config.operation ?? 'passthrough')} onValueChange={(v) => updateNodeConfig(node.id, 'operation', v)}>
                <SelectTrigger className="mt-1">{t(`flows:nodes.config.operations.${String(node.config.operation ?? 'passthrough')}`)}</SelectTrigger>
                <SelectContent>
                  <SelectItem value="passthrough">{t('flows:nodes.config.operations.passthrough')}</SelectItem>
                  <SelectItem value="pick_fields">{t('flows:nodes.config.operations.pick_fields')}</SelectItem>
                  <SelectItem value="set_variable">{t('flows:nodes.config.operations.set_variable')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {node.config.operation === 'pick_fields' && (
              <div>
                <Label>{t('flows:nodes.config.fields')}</Label>
                <Input value={Array.isArray(node.config.fields) ? (node.config.fields as string[]).join(', ') : String(node.config.fields ?? '')} onChange={(e) => updateNodeConfig(node.id, 'fields', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} className="mt-1" />
              </div>
            )}
            {node.config.operation === 'set_variable' && (
              <div>
                <Label>{t('flows:nodes.config.variable')}</Label>
                <Input value={String(node.config.variable ?? '')} onChange={(e) => updateNodeConfig(node.id, 'variable', e.target.value)} className="mt-1" />
              </div>
            )}
          </div>
        );
      case 'condition':
        return (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>{t('flows:nodes.config.field')}</Label>
                <Input value={String(node.config.field ?? '')} onChange={(e) => updateNodeConfig(node.id, 'field', e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label>{t('flows:nodes.config.operator')}</Label>
                <Select value={String(node.config.operator ?? 'eq')} onValueChange={(v) => updateNodeConfig(node.id, 'operator', v)}>
                  <SelectTrigger className="mt-1">{t(`flows:nodes.config.operators.${String(node.config.operator ?? 'eq')}`)}</SelectTrigger>
                  <SelectContent>
                    {OPERATORS.map((op) => <SelectItem key={op} value={op}>{t(`flows:nodes.config.operators.${op}`)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t('flows:nodes.config.value')}</Label>
                <Input value={String(node.config.value ?? '')} onChange={(e) => updateNodeConfig(node.id, 'value', e.target.value)} className="mt-1" />
              </div>
            </div>
          </div>
        );
      default:
        return null;
    }
  }

  return (
    <PageWrapper>
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="icon" onClick={() => navigate(`/projects/${slug}/flows`)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-2xl font-bold">{t('flows:editFlow')}</h1>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={() => runMutation.mutate()} disabled={runMutation.isPending}>
            <Play className="h-4 w-4 mr-2" />{t('cron:actions.runNow')}
          </Button>
          <Button onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending}>
            <Save className="h-4 w-4 mr-2" />{t('common:actions.save')}
          </Button>
        </div>
      </div>

      <div className="grid gap-6">
        {/* Flow Settings */}
        <Card>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>{t('flows:form.name')}</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label>{t('flows:form.triggerType')}</Label>
                <Select value={triggerType} onValueChange={setTriggerType}>
                  <SelectTrigger className="mt-1">{t(`flows:form.triggerTypes.${triggerType}`)}</SelectTrigger>
                  <SelectContent>
                    {['manual', 'data_change', 'webhook', 'cron', 'api_call'].map((tt) => (
                      <SelectItem key={tt} value={tt}>{t(`flows:form.triggerTypes.${tt}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>{t('flows:form.description')}</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('flows:form.descriptionPlaceholder')} className="mt-1" rows={2} />
            </div>
          </CardContent>
        </Card>

        {/* Steps */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{t('flows:nodes.title')}</CardTitle>
            <Select onValueChange={(v) => addNode(v)}>
              <SelectTrigger className="w-48">
                <Plus className="h-4 w-4 mr-2" />
                <span>{t('flows:nodes.addStep')}</span>
              </SelectTrigger>
              <SelectContent>
                {NODE_TYPES.map((nt) => (
                  <SelectItem key={nt} value={nt}>{t(`flows:nodes.types.${nt}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent>
            {nodes.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {t('flows:noFlowsDesc')}
              </div>
            ) : (
              <div className="space-y-3">
                {nodes.map((node, index) => {
                  const Icon = NODE_TYPE_ICONS[node.type] ?? Database;
                  const isExpanded = expandedNodes.has(node.id);

                  return (
                    <div key={node.id}>
                      {index > 0 && (
                        <div className="flex justify-center py-1">
                          <div className="h-4 w-px bg-border" />
                        </div>
                      )}
                      <Collapsible open={isExpanded} onOpenChange={() => toggleExpanded(node.id)}>
                        <div className="border rounded-lg">
                          <CollapsibleTrigger asChild>
                            <div className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/50">
                              <div className="flex items-center gap-2 flex-1">
                                {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                <Icon className="h-4 w-4 text-muted-foreground" />
                                <Badge variant="outline" className="text-xs">
                                  {t(`flows:nodes.types.${node.type}`)}
                                </Badge>
                                <span className="text-sm text-muted-foreground">#{index + 1}</span>
                              </div>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive"
                                onClick={(e) => { e.stopPropagation(); removeNode(node.id); }}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <div className="px-3 pb-3 border-t pt-3">
                              {renderNodeConfig(node)}
                            </div>
                          </CollapsibleContent>
                        </div>
                      </Collapsible>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Run History */}
        <Card>
          <CardHeader>
            <CardTitle>{t('flows:runs.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('flows:runs.time')}</TableHead>
                  <TableHead>{t('flows:runs.status')}</TableHead>
                  <TableHead>{t('flows:runs.duration')}</TableHead>
                  <TableHead>{t('flows:runs.error')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => {
                  const started = run.started_at ? new Date(String(run.started_at)) : null;
                  const completed = run.completed_at ? new Date(String(run.completed_at)) : null;
                  const durationMs = started && completed ? completed.getTime() - started.getTime() : null;

                  return (
                    <TableRow key={String(run.id)}>
                      <TableCell className="text-xs">{started?.toLocaleString() ?? '-'}</TableCell>
                      <TableCell>
                        <Badge variant={run.status === 'success' ? 'default' : run.status === 'running' ? 'secondary' : 'destructive'}>
                          {String(run.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{durationMs !== null ? `${durationMs}ms` : '-'}</TableCell>
                      <TableCell className="text-xs text-destructive max-w-xs truncate">{run.error ? String(run.error) : '-'}</TableCell>
                    </TableRow>
                  );
                })}
                {runs.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-8">{t('flows:runs.noRuns')}</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </PageWrapper>
  );
}
