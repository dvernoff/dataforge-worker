import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Plus, Server, Trash2, Copy, Check, Loader2, CheckCircle,
  Terminal, Globe, Clock, AlertCircle, Download, RefreshCw, Pencil,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { usePageTitle } from '@/hooks/usePageTitle';
import { api } from '@/api/client';
import { toast } from 'sonner';

interface PersonalNode {
  id: string;
  name: string;
  url: string;
  region: string;
  status: 'online' | 'offline' | 'maintenance';
  cpu_usage: number;
  ram_usage: number;
  disk_usage: number;
  disk_total_gb?: number;
  disk_free_gb?: number;
  current_version?: string;
  update_mode?: string;
  update_status?: 'idle' | 'updating' | 'failed';
  projects_count?: number;
  last_heartbeat: string | null;
  created_at: string;
}

function statusVariant(status: string): 'default' | 'destructive' | 'outline' {
  switch (status) {
    case 'online': return 'default';
    case 'offline': return 'destructive';
    default: return 'outline';
  }
}

function formatHeartbeat(ts: string | null): string {
  if (!ts) return '-';
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return 'Offline';
}

export function MyNodesPage() {
  const { t } = useTranslation('settings');
  usePageTitle(t('myNodes.title'));
  const queryClient = useQueryClient();

  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [formName, setFormName] = useState('');
  const [formRegion, setFormRegion] = useState('');
  const [formUpdateMode, setFormUpdateMode] = useState('auto');
  const [setupToken, setSetupToken] = useState('');
  const [copied, setCopied] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PersonalNode | null>(null);
  const [waitingNodeId, setWaitingNodeId] = useState<string | null>(null);
  const [setupOs, setSetupOs] = useState<'linux' | 'windows'>('linux');

  // Setup command dialog for existing offline nodes
  const [setupDialogNode, setSetupDialogNode] = useState<PersonalNode | null>(null);
  const [setupDialogToken, setSetupDialogToken] = useState('');
  const [setupDialogCopied, setSetupDialogCopied] = useState(false);
  const [setupDialogOs, setSetupDialogOs] = useState<'linux' | 'windows'>('linux');

  function getSetupCommand(token: string, os: 'linux' | 'windows') {
    const cpUrl = import.meta.env.VITE_CP_URL || window.location.origin;
    const isDev = import.meta.env.DEV;
    if (os === 'windows') {
      if (isDev) {
        return `.\\scripts\\install-worker.ps1 -Token "${token}" -CpUrl "${cpUrl}" -Dev`;
      }
      return `irm ${cpUrl}/scripts/install-worker.ps1 -OutFile install-worker.ps1; .\\install-worker.ps1 -Token "${token}" -CpUrl "${cpUrl}"`;
    }
    if (isDev) {
      return `bash scripts/install-worker.sh --token=${token} --cp=${cpUrl} --dev`;
    }
    return `curl -fsSL ${cpUrl}/scripts/install-worker.sh | bash -s -- --token=${token} --cp=${cpUrl}`;
  }

  const { data, isLoading } = useQuery({
    queryKey: ['personal-nodes'],
    queryFn: () => api.get<{ nodes: PersonalNode[] }>('/nodes/personal'),
  });

  // Poll for node connection when waiting
  const { data: pollData } = useQuery({
    queryKey: ['personal-nodes-poll', waitingNodeId],
    queryFn: () => api.get<{ nodes: PersonalNode[] }>('/nodes/personal'),
    enabled: !!waitingNodeId,
    refetchInterval: 3000,
  });

  useEffect(() => {
    if (waitingNodeId && pollData?.nodes) {
      const node = pollData.nodes.find((n) => n.id === waitingNodeId);
      if (node && node.status === 'online' && node.url && node.last_heartbeat) {
        setWizardStep(3);
        setWaitingNodeId(null);
        queryClient.invalidateQueries({ queryKey: ['personal-nodes'] });
      }
    }
  }, [pollData, waitingNodeId, queryClient]);

  const createMutation = useMutation({
    mutationFn: (body: { name: string; region?: string; update_mode?: string }) =>
      api.post<{ node: PersonalNode; setup_token: string; token_expires: string }>('/nodes/personal', body),
    onSuccess: (res) => {
      setSetupToken(res.setup_token);
      setSetupOs('linux');
      setWaitingNodeId(res.node.id);
      setWizardStep(2);
      queryClient.invalidateQueries({ queryKey: ['personal-nodes'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/nodes/personal/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['personal-nodes'] });
      toast.success(t('myNodes.deleted'));
      setDeleteTarget(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const regenerateMutation = useMutation({
    mutationFn: (id: string) =>
      api.post<{ setup_token: string; token_expires: string }>(`/nodes/personal/${id}/regenerate-token`),
    onSuccess: (res, nodeId) => {
      const node = nodes.find((n) => n.id === nodeId);
      setSetupDialogNode(node ?? null);
      setSetupDialogToken(res.setup_token);
      setSetupDialogCopied(false);
      setSetupDialogOs('linux');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: (id: string) =>
      api.post<{ status: string }>(`/nodes/personal/${id}/update`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['personal-nodes'] });
      toast.success(t('myNodes.updateTriggered'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const [editUrlNode, setEditUrlNode] = useState<PersonalNode | null>(null);
  const [editUrl, setEditUrl] = useState('');

  const editUrlMutation = useMutation({
    mutationFn: () =>
      api.put(`/nodes/personal/${editUrlNode!.id}`, { url: editUrl }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['personal-nodes'] });
      toast.success(t('myNodes.urlUpdated'));
      setEditUrlNode(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function resetWizard() {
    setWizardOpen(false);
    setWizardStep(1);
    setFormName('');
    setFormRegion('');
    setFormUpdateMode('auto');
    setSetupToken('');
    setWaitingNodeId(null);
    setCopied(false);
    setSetupOs('linux');
  }

  function handleCopy(text: string, setter: (v: boolean) => void) {
    navigator.clipboard.writeText(text);
    setter(true);
    setTimeout(() => setter(false), 2000);
  }

  const nodes = data?.nodes ?? [];
  const isNodePending = (node: PersonalNode) => node.status === 'offline' && !node.url;

  return (
    <PageWrapper>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">{t('myNodes.title')}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t('myNodes.description')}</p>
        </div>
        <Button onClick={() => { resetWizard(); setWizardOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" />
          {t('myNodes.addNode')}
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      ) : nodes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Server className="h-12 w-12 text-muted-foreground mb-4" />
          <h2 className="text-lg font-medium mb-2">{t('myNodes.empty')}</h2>
          <p className="text-muted-foreground mb-4">{t('myNodes.emptyDesc')}</p>
          <Button onClick={() => { resetWizard(); setWizardOpen(true); }}>
            <Plus className="h-4 w-4 mr-2" />{t('myNodes.addNode')}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {nodes.map((node) => (
            <Card key={node.id} className="hover:shadow-md transition-shadow">
              <CardContent className="py-4">
                {isNodePending(node) ? (
                  /* ── Pending setup card ── */
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-amber-500/10 border border-amber-500/20">
                        <AlertCircle className="h-5 w-5 text-amber-500" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold">{node.name}</h3>
                          <Badge variant="outline" className="text-amber-600 border-amber-500/30">
                            {t('myNodes.pendingSetup')}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground mt-0.5">
                          {t('myNodes.pendingSetupDesc')}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => regenerateMutation.mutate(node.id)}
                        disabled={regenerateMutation.isPending}
                      >
                        {regenerateMutation.isPending ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Terminal className="h-4 w-4 mr-2" />
                        )}
                        {t('myNodes.regenerateToken')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        onClick={() => setDeleteTarget(node)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  /* ── Connected / offline node card ── */
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className={`flex items-center justify-center h-10 w-10 rounded-lg border ${
                          node.status === 'online'
                            ? 'bg-green-500/10 border-green-500/20'
                            : 'bg-red-500/10 border-red-500/20'
                        }`}>
                          <Server className={`h-5 w-5 ${
                            node.status === 'online' ? 'text-green-500' : 'text-red-500'
                          }`} />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold">{node.name}</h3>
                            <Badge variant={statusVariant(node.status)}>
                              {node.status}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-1">
                            <p className="text-sm text-muted-foreground font-mono">{node.url}</p>
                            {node.url && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-5 w-5"
                                onClick={() => { setEditUrlNode(node); setEditUrl(node.url); }}
                              >
                                <Pencil className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {node.status === 'online' && node.update_status === 'updating' && (
                          <Badge variant="outline" className="text-blue-600 border-blue-500/30 gap-1">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            {t('myNodes.updating')}
                          </Badge>
                        )}
                        {node.status === 'online' && node.update_status === 'failed' && (
                          <Badge variant="destructive" className="gap-1">
                            {t('myNodes.updateFailed')}
                          </Badge>
                        )}
                        {node.status === 'online' && (!node.update_status || node.update_status === 'idle' || node.update_status === 'failed') && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => updateMutation.mutate(node.id)}
                            disabled={updateMutation.isPending}
                          >
                            {updateMutation.isPending ? (
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                              <Download className="h-4 w-4 mr-2" />
                            )}
                            {t('myNodes.update')}
                          </Button>
                        )}
                        {node.status === 'offline' && node.url && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => regenerateMutation.mutate(node.id)}
                            disabled={regenerateMutation.isPending}
                          >
                            <Terminal className="h-4 w-4 mr-2" />
                            {t('myNodes.regenerateToken')}
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive"
                          onClick={() => setDeleteTarget(node)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                      <div className="flex items-center gap-2">
                        <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-muted-foreground">{t('myNodes.region')}:</span>
                        <span className="font-medium">{node.region}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Server className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-muted-foreground">{t('myNodes.projects')}:</span>
                        <span className="font-medium">{node.projects_count ?? 0}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-muted-foreground">{t('myNodes.version')}:</span>
                        <span className="font-medium font-mono">{node.current_version || '-'}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-muted-foreground">Heartbeat:</span>
                        <span className="font-medium">{formatHeartbeat(node.last_heartbeat)}</span>
                      </div>
                    </div>

                    {node.status === 'online' && (
                      <div className="grid grid-cols-3 gap-4">
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-muted-foreground w-8">CPU</span>
                          <Progress value={node.cpu_usage} className="h-2 flex-1" />
                          <span className="text-xs text-muted-foreground w-10 text-right">{node.cpu_usage}%</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-muted-foreground w-8">RAM</span>
                          <Progress value={node.ram_usage} className="h-2 flex-1" />
                          <span className="text-xs text-muted-foreground w-10 text-right">{node.ram_usage}%</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-muted-foreground w-8">{t('myNodes.disk')}</span>
                          <Progress value={node.disk_usage} className="h-2 flex-1" />
                          <span className="text-xs text-muted-foreground w-16 text-right">
                            {(node.disk_total_gb ?? 0) > 0
                              ? `${node.disk_free_gb} GB`
                              : `${node.disk_usage}%`}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add Node Wizard */}
      <Dialog open={wizardOpen} onOpenChange={(o) => { if (!o) resetWizard(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {t('myNodes.wizard.title')} — {t(`myNodes.wizard.step${wizardStep}`)}
            </DialogTitle>
          </DialogHeader>

          {wizardStep === 1 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>{t('myNodes.wizard.name')}</Label>
                <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder={t('myNodes.wizard.namePlaceholder')} />
              </div>
              <div className="space-y-2">
                <Label>{t('myNodes.wizard.region')}</Label>
                <Input value={formRegion} onChange={(e) => setFormRegion(e.target.value)} placeholder="us-east-1" />
              </div>
              <div className="space-y-2">
                <Label>{t('myNodes.wizard.updateMode')}</Label>
                <Select value={formUpdateMode} onValueChange={setFormUpdateMode}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">{t('myNodes.wizard.updateAuto')}</SelectItem>
                    <SelectItem value="manual">{t('myNodes.wizard.updateManual')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={resetWizard}>{t('myNodes.wizard.cancel')}</Button>
                <Button
                  onClick={() => createMutation.mutate({ name: formName, region: formRegion || undefined, update_mode: formUpdateMode })}
                  disabled={!formName || createMutation.isPending}
                >
                  {createMutation.isPending ? t('myNodes.wizard.creating') : t('myNodes.wizard.next')}
                </Button>
              </DialogFooter>
            </div>
          )}

          {wizardStep === 2 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">{t('myNodes.wizard.installDesc')}</p>
              <div className="flex gap-2">
                <Button
                  variant={setupOs === 'linux' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => { setSetupOs('linux'); setCopied(false); }}
                >
                  Linux / macOS
                </Button>
                <Button
                  variant={setupOs === 'windows' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => { setSetupOs('windows'); setCopied(false); }}
                >
                  Windows
                </Button>
              </div>
              <div className="relative">
                <div className="rounded-md border bg-muted p-3 font-mono text-xs break-all pr-10">
                  {getSetupCommand(setupToken, setupOs)}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-2 top-2 h-7 w-7"
                  onClick={() => handleCopy(getSetupCommand(setupToken, setupOs), setCopied)}
                >
                  {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <div className="flex items-center gap-3 py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">{t('myNodes.wizard.waiting')}</span>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={resetWizard}>{t('myNodes.wizard.cancel')}</Button>
              </DialogFooter>
            </div>
          )}

          {wizardStep === 3 && (
            <div className="space-y-4 text-center py-4">
              <CheckCircle className="h-12 w-12 text-green-500 mx-auto" />
              <h3 className="text-lg font-semibold">{t('myNodes.wizard.connected')}</h3>
              <p className="text-sm text-muted-foreground">{t('myNodes.wizard.connectedDesc')}</p>
              <DialogFooter>
                <Button onClick={resetWizard}>{t('myNodes.wizard.done')}</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Setup Command Dialog (for existing offline nodes) */}
      <Dialog open={!!setupDialogNode} onOpenChange={(o) => { if (!o) { setSetupDialogNode(null); setSetupDialogToken(''); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('myNodes.setupCommand')} — {setupDialogNode?.name}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t('myNodes.tokenReady')}</p>
          <div className="flex gap-2 mb-2">
            <Button
              variant={setupDialogOs === 'linux' ? 'default' : 'outline'}
              size="sm"
              onClick={() => { setSetupDialogOs('linux'); setSetupDialogCopied(false); }}
            >
              Linux / macOS
            </Button>
            <Button
              variant={setupDialogOs === 'windows' ? 'default' : 'outline'}
              size="sm"
              onClick={() => { setSetupDialogOs('windows'); setSetupDialogCopied(false); }}
            >
              Windows
            </Button>
          </div>
          <div className="relative">
            <div className="rounded-md border bg-muted p-3 font-mono text-xs break-all pr-10">
              {getSetupCommand(setupDialogToken, setupDialogOs)}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-2 h-7 w-7"
              onClick={() => handleCopy(getSetupCommand(setupDialogToken, setupDialogOs), setSetupDialogCopied)}
            >
              {setupDialogCopied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => { setSetupDialogNode(null); setSetupDialogToken(''); }}>
              {t('myNodes.wizard.done')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit URL Dialog */}
      <Dialog open={!!editUrlNode} onOpenChange={(o) => { if (!o) setEditUrlNode(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('myNodes.editUrl')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>URL</Label>
            <Input
              value={editUrl}
              onChange={(e) => setEditUrl(e.target.value)}
              placeholder="https://fl.dataforge.me"
            />
            <p className="text-xs text-muted-foreground">{t('myNodes.editUrlHint')}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditUrlNode(null)}>{t('myNodes.wizard.cancel')}</Button>
            <Button
              onClick={() => editUrlMutation.mutate()}
              disabled={!editUrl || editUrlMutation.isPending}
            >
              {editUrlMutation.isPending ? t('myNodes.saving') : t('myNodes.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}
        title={t('myNodes.deleteTitle')}
        description={t('myNodes.deleteDesc', { name: deleteTarget?.name })}
        confirmText={t('myNodes.deleteConfirm')}
        variant="destructive"
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        loading={deleteMutation.isPending}
      />
    </PageWrapper>
  );
}
