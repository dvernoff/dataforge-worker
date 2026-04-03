import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Plus, Play, Trash2, Clock, Database, Filter, ArrowRight,
  GitBranch, Settings, ChevronDown, CheckCircle, XCircle, Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { useCurrentProject } from '@/hooks/useProject';
import { usePageTitle } from '@/hooks/usePageTitle';
import { api } from '@/api/client';
import { toast } from 'sonner';
import { showErrorToast } from '@/lib/show-error-toast';

interface Pipeline {
  id: string;
  name: string;
  description: string | null;
  nodes: PipelineNode[];
  edges: PipelineEdge[];
  schedule: string | null;
  is_active: boolean;
  last_run_at: string | null;
  last_run_status: string | null;
  created_at: string;
}

interface PipelineNode {
  id: string;
  type: 'source' | 'transform' | 'destination';
  subtype: string;
  label: string;
  config: Record<string, unknown>;
}

interface PipelineEdge {
  id: string;
  source: string;
  target: string;
}

interface PipelineRun {
  id: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  records_processed: number;
  error: string | null;
}

const SOURCE_TYPES = ['table', 'sql_query', 'api'];
const TRANSFORM_TYPES = ['filter', 'map', 'aggregate', 'join', 'deduplicate', 'sort'];
const DESTINATION_TYPES = ['table', 'webhook', 'file'];

function nodeTypeColor(type: string): string {
  switch (type) {
    case 'source': return 'bg-blue-500/10 border-blue-500/30 text-blue-700 dark:text-blue-300';
    case 'transform': return 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300';
    case 'destination': return 'bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-300';
    default: return '';
  }
}

function nodeTypeIcon(type: string) {
  switch (type) {
    case 'source': return <Database className="h-4 w-4" />;
    case 'transform': return <Filter className="h-4 w-4" />;
    case 'destination': return <ArrowRight className="h-4 w-4" />;
    default: return null;
  }
}

export function DataPipelinePage() {
  const { t } = useTranslation('data');
  usePageTitle(t('pipeline.title'));
  const { data: project } = useCurrentProject();
  const queryClient = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Pipeline | null>(null);
  const [runsId, setRunsId] = useState<string | null>(null);

  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formSchedule, setFormSchedule] = useState('');
  const [formNodes, setFormNodes] = useState<PipelineNode[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ['pipelines', project?.id],
    queryFn: () => api.get<{ pipelines: Pipeline[] }>(`/projects/${project!.id}/pipelines`),
    enabled: !!project?.id,
  });

  const { data: runsData } = useQuery({
    queryKey: ['pipeline-runs', project?.id, runsId],
    queryFn: () => api.get<{ runs: PipelineRun[] }>(`/projects/${project!.id}/pipelines/${runsId}/runs`),
    enabled: !!project?.id && !!runsId,
  });

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post(`/projects/${project!.id}/pipelines`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pipelines', project?.id] });
      toast.success(t('pipeline.created'));
      resetForm();
    },
    onError: (err: Error) => showErrorToast(err),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.put(`/projects/${project!.id}/pipelines/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pipelines', project?.id] });
      toast.success(t('pipeline.updated'));
      resetForm();
    },
    onError: (err: Error) => showErrorToast(err),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/projects/${project!.id}/pipelines/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pipelines', project?.id] });
      toast.success(t('pipeline.deleted'));
      setDeleteTarget(null);
    },
    onError: (err: Error) => showErrorToast(err),
  });

  const runMutation = useMutation({
    mutationFn: (id: string) => api.post(`/projects/${project!.id}/pipelines/${id}/run`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pipelines', project?.id] });
      toast.success(t('pipeline.runStarted'));
    },
    onError: (err: Error) => showErrorToast(err),
  });

  function resetForm() {
    setCreateOpen(false);
    setEditId(null);
    setFormName('');
    setFormDescription('');
    setFormSchedule('');
    setFormNodes([]);
  }

  function openEdit(pipeline: Pipeline) {
    setFormName(pipeline.name);
    setFormDescription(pipeline.description ?? '');
    setFormSchedule(pipeline.schedule ?? '');
    setFormNodes(pipeline.nodes ?? []);
    setEditId(pipeline.id);
    setCreateOpen(true);
  }

  function addNode(type: 'source' | 'transform' | 'destination', subtype: string) {
    setFormNodes((prev) => [
      ...prev,
      {
        id: `node_${Date.now()}`,
        type,
        subtype,
        label: `${subtype.charAt(0).toUpperCase() + subtype.slice(1).replace('_', ' ')}`,
        config: {},
      },
    ]);
  }

  function removeNode(nodeId: string) {
    setFormNodes((prev) => prev.filter((n) => n.id !== nodeId));
  }

  function handleSave() {
    const body = {
      name: formName,
      description: formDescription || undefined,
      schedule: formSchedule || undefined,
      nodes: formNodes,
      edges: formNodes.slice(0, -1).map((n, i) => ({
        id: `edge_${i}`,
        source: n.id,
        target: formNodes[i + 1].id,
      })),
    };
    if (editId) {
      updateMutation.mutate({ id: editId, body });
    } else {
      createMutation.mutate(body);
    }
  }

  const pipelines = data?.pipelines ?? [];

  return (
    <PageWrapper>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <GitBranch className="h-6 w-6" />
          <h1 className="text-2xl font-bold">{t('pipeline.title')}</h1>
        </div>
        <Button onClick={() => { resetForm(); setCreateOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" />
          {t('pipeline.create')}
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : pipelines.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <GitBranch className="h-12 w-12 text-muted-foreground mb-4" />
          <h2 className="text-lg font-medium mb-2">{t('pipeline.empty')}</h2>
          <p className="text-muted-foreground mb-4">{t('pipeline.emptyDesc')}</p>
          <Button onClick={() => { resetForm(); setCreateOpen(true); }}>
            <Plus className="h-4 w-4 mr-2" />{t('pipeline.create')}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {pipelines.map((p) => (
            <Card key={p.id} className="hover:shadow-md transition-shadow">
              <CardContent className="flex items-center justify-between py-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">{p.name}</h3>
                    <Badge variant={p.is_active ? 'default' : 'secondary'}>
                      {p.is_active ? t('pipeline.active') : t('pipeline.inactive')}
                    </Badge>
                    {p.last_run_status && (
                      <Badge variant={p.last_run_status === 'completed' ? 'default' : 'destructive'}>
                        {p.last_run_status}
                      </Badge>
                    )}
                  </div>
                  {p.description && (
                    <p className="text-sm text-muted-foreground mt-1 truncate">{p.description}</p>
                  )}
                  <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                    {p.schedule && (
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {p.schedule}
                      </span>
                    )}
                    <span>{(p.nodes ?? []).length} {t('pipeline.nodes')}</span>
                    {p.last_run_at && (
                      <span>{t('pipeline.lastRun')}: {new Date(p.last_run_at).toLocaleString()}</span>
                    )}
                  </div>
                  {/* Visual pipeline flow */}
                  {(p.nodes ?? []).length > 0 && (
                    <div className="flex items-center gap-1 mt-3 flex-wrap">
                      {(p.nodes ?? []).map((node, i) => (
                        <div key={node.id} className="flex items-center gap-1">
                          <div className={`flex items-center gap-1 px-2 py-1 rounded border text-xs ${nodeTypeColor(node.type)}`}>
                            {nodeTypeIcon(node.type)}
                            {node.label}
                          </div>
                          {i < (p.nodes ?? []).length - 1 && (
                            <ArrowRight className="h-3 w-3 text-muted-foreground" />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-4">
                  <Button variant="outline" size="sm" onClick={() => runMutation.mutate(p.id)} disabled={runMutation.isPending}>
                    <Play className="h-4 w-4 mr-1" />
                    {t('pipeline.run')}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setRunsId(p.id)}>
                    <Clock className="h-4 w-4 mr-1" />
                    {t('pipeline.history')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => openEdit(p)}>
                    <Settings className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setDeleteTarget(p)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={createOpen} onOpenChange={(o) => { if (!o) resetForm(); }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>{editId ? t('pipeline.edit') : t('pipeline.create')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t('pipeline.name')}</Label>
              <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder={t('pipeline.namePlaceholder')} />
            </div>
            <div className="space-y-2">
              <Label>{t('pipeline.description')}</Label>
              <Textarea value={formDescription} onChange={(e) => setFormDescription(e.target.value)} rows={2} />
            </div>
            <div className="space-y-2">
              <Label>{t('pipeline.schedule')}</Label>
              <Input value={formSchedule} onChange={(e) => setFormSchedule(e.target.value)} placeholder="0 */6 * * *" />
              <p className="text-xs text-muted-foreground">{t('pipeline.scheduleCron')}</p>
            </div>

            {/* Node builder */}
            <div className="space-y-3">
              <Label>{t('pipeline.pipelineSteps')}</Label>

              {/* Current nodes as visual list */}
              {formNodes.map((node, i) => (
                <div key={node.id} className="flex items-center gap-2">
                  {i > 0 && <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                  <div className={`flex-1 flex items-center gap-2 px-3 py-2 rounded border ${nodeTypeColor(node.type)}`}>
                    {nodeTypeIcon(node.type)}
                    <span className="text-sm font-medium">{node.label}</span>
                    <Badge variant="outline" className="text-xs">{node.type}</Badge>
                  </div>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeNode(node.id)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}

              {/* Add node buttons */}
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-blue-600 dark:text-blue-400">{t('pipeline.sourceNodes')}</p>
                  {SOURCE_TYPES.map((st) => (
                    <Button key={st} variant="outline" size="sm" className="w-full justify-start text-xs" onClick={() => addNode('source', st)}>
                      <Database className="h-3 w-3 mr-1" />
                      {t(`pipeline.nodeTypes.${st}`)}
                    </Button>
                  ))}
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">{t('pipeline.transformNodes')}</p>
                  {TRANSFORM_TYPES.map((tt) => (
                    <Button key={tt} variant="outline" size="sm" className="w-full justify-start text-xs" onClick={() => addNode('transform', tt)}>
                      <Filter className="h-3 w-3 mr-1" />
                      {t(`pipeline.nodeTypes.${tt}`)}
                    </Button>
                  ))}
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-green-600 dark:text-green-400">{t('pipeline.destinationNodes')}</p>
                  {DESTINATION_TYPES.map((dt) => (
                    <Button key={dt} variant="outline" size="sm" className="w-full justify-start text-xs" onClick={() => addNode('destination', dt)}>
                      <ArrowRight className="h-3 w-3 mr-1" />
                      {t(`pipeline.nodeTypes.${dt}`)}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetForm}>{t('pipeline.cancel')}</Button>
            <Button onClick={handleSave} disabled={!formName || createMutation.isPending || updateMutation.isPending}>
              {editId ? t('pipeline.save') : t('pipeline.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Run History Dialog */}
      <Dialog open={!!runsId} onOpenChange={(o) => { if (!o) setRunsId(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('pipeline.runHistory')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 max-h-[400px] overflow-auto">
            {(runsData?.runs ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">{t('pipeline.noRuns')}</p>
            ) : (
              (runsData?.runs ?? []).map((run) => (
                <div key={run.id} className="flex items-center justify-between border rounded p-3">
                  <div className="flex items-center gap-2">
                    {run.status === 'completed' ? (
                      <CheckCircle className="h-4 w-4 text-green-500" />
                    ) : run.status === 'failed' ? (
                      <XCircle className="h-4 w-4 text-destructive" />
                    ) : (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    )}
                    <div>
                      <p className="text-sm font-medium">{run.status}</p>
                      <p className="text-xs text-muted-foreground">{new Date(run.started_at).toLocaleString()}</p>
                    </div>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <p>{run.records_processed} {t('pipeline.recordsProcessed')}</p>
                    {run.finished_at && (
                      <p>{Math.round((new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) / 1000)}s</p>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}
        title={t('pipeline.deleteTitle')}
        description={t('pipeline.deleteDesc', { name: deleteTarget?.name })}
        confirmText={t('pipeline.deleteConfirm')}
        variant="destructive"
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        loading={deleteMutation.isPending}
      />
    </PageWrapper>
  );
}
