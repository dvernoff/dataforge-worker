import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Server, Trash2, Pencil, Terminal, Copy, Check, Download, Loader2, CheckCircle2, XCircle, ArrowUpCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { nodesApi } from '@/api/nodes.api';
import { usePageTitle } from '@/hooks/usePageTitle';
import { toast } from 'sonner';
import type { WorkerNode } from '@shared/types/node.types';

const TRANSLIT_MAP: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

function transliterate(text: string): string {
  return text
    .toLowerCase()
    .split('')
    .map((ch) => TRANSLIT_MAP[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function formatHeartbeat(ts: string | null, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (!ts) return t('heartbeat.offline');
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60_000) return t('heartbeat.justNow');
  if (diff < 3_600_000) return t('heartbeat.minutesAgo', { count: Math.floor(diff / 60_000) });
  return t('heartbeat.offline');
}

function statusVariant(status: WorkerNode['status']): 'default' | 'destructive' | 'outline' {
  switch (status) {
    case 'online': return 'default';
    case 'offline': return 'destructive';
    case 'maintenance': return 'outline';
  }
}

const emptyForm = { name: '', slug: '', region: '', url: '', maxProjects: 50 };

export function NodesPage() {
  const { t } = useTranslation('nodes');
  usePageTitle(t('title'));
  const queryClient = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [slugTouched, setSlugTouched] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  // Setup command dialog
  const [setupToken, setSetupToken] = useState('');
  const [setupNodeName, setSetupNodeName] = useState('');
  const [setupCopied, setSetupCopied] = useState(false);
  const [setupOs, setSetupOs] = useState<'linux' | 'windows'>('linux');

  const [isUpdating, setIsUpdating] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['nodes'],
    queryFn: () => nodesApi.list(),
    refetchInterval: isUpdating ? 5_000 : 30_000,
  });

  const latestWorkerVersion = data?.latestWorkerVersion;

  const createMutation = useMutation({
    mutationFn: () =>
      nodesApi.create({
        name: form.name,
        slug: form.slug,
        region: form.region,
        max_projects: form.maxProjects,
      } as any),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['nodes'] });
      toast.success(t('created'));
      closeDialog();
      showSetupCommand(res.setup_token, form.name);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      nodesApi.update(editId!, {
        name: form.name,
        url: form.url || undefined,
        region: form.region,
        max_projects: form.maxProjects,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nodes'] });
      toast.success(t('updated'));
      closeDialog();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const regenerateTokenMutation = useMutation({
    mutationFn: (id: string) => nodesApi.regenerateToken(id),
    onSuccess: (res, _id) => {
      const node = allNodes.find((n) => n.id === _id);
      showSetupCommand(res.setup_token, node?.name ?? '');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => nodesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nodes'] });
      toast.success(t('deleted'));
      setDeleteTarget(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const [updateNode, setUpdateNode] = useState<WorkerNode | null>(null);
  const [updateStep, setUpdateStep] = useState<'confirm' | 'progress' | 'done' | 'error'>('confirm');
  const [updateProgress, setUpdateProgress] = useState(0);
  const [updateError, setUpdateError] = useState('');
  const progressTimer = useRef<NodeJS.Timeout | null>(null);

  const triggerUpdateMutation = useMutation({
    mutationFn: (id: string) => nodesApi.triggerUpdate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nodes'] });
      setUpdateStep('progress');
      setUpdateProgress(15);
      setIsUpdating(true);
    },
    onError: (err: Error) => {
      setUpdateError(err.message);
      setUpdateStep('error');
    },
  });

  useEffect(() => {
    if (updateStep !== 'progress') return;
    progressTimer.current = setInterval(() => {
      setUpdateProgress((p) => {
        if (p >= 90) return 90;
        return p + Math.random() * 8 + 2;
      });
    }, 1500);
    return () => { if (progressTimer.current) clearInterval(progressTimer.current); };
  }, [updateStep]);

  const allNodes: WorkerNode[] = data?.nodes ?? [];
  const systemNodes = allNodes.filter((n) => !n.owner_id);
  const userNodes = allNodes.filter((n) => !!n.owner_id);

  useEffect(() => {
    if (updateStep !== 'progress' || !updateNode) return;
    const node = allNodes.find((n) => n.id === updateNode.id);
    if (!node) return;
    if (node.current_version && latestWorkerVersion && node.current_version === latestWorkerVersion) {
      if (progressTimer.current) clearInterval(progressTimer.current);
      setUpdateProgress(100);
      setUpdateStep('done');
    }
    if (node.update_status === 'failed') {
      if (progressTimer.current) clearInterval(progressTimer.current);
      setUpdateError(t('updateDialog.failedDesc'));
      setUpdateStep('error');
    }
  }, [allNodes, updateStep, updateNode, latestWorkerVersion]);

  function openUpdateDialog(node: WorkerNode) {
    setUpdateNode(node);
    setUpdateStep('confirm');
    setUpdateProgress(0);
    setUpdateError('');
  }

  function closeUpdateDialog() {
    setUpdateNode(null);
    setIsUpdating(false);
    if (progressTimer.current) clearInterval(progressTimer.current);
  }

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

  function showSetupCommand(token: string, nodeName: string) {
    setSetupToken(token);
    setSetupNodeName(nodeName);
    setSetupCopied(false);
    setSetupOs('linux');
  }

  function openEdit(node: WorkerNode) {
    setEditId(node.id);
    setForm({
      name: node.name,
      slug: node.slug,
      region: node.region,
      url: node.url || '',
      maxProjects: node.max_projects ?? 50,
    });
    setSlugTouched(true);
    setCreateOpen(true);
  }

  function closeDialog() {
    setCreateOpen(false);
    setEditId(null);
    setSlugTouched(false);
    setForm(emptyForm);
  }

  function handleCopy() {
    navigator.clipboard.writeText(getSetupCommand(setupToken, setupOs));
    setSetupCopied(true);
    setTimeout(() => setSetupCopied(false), 2000);
  }

  function renderNodeRow(node: WorkerNode) {
    const isNotConnected = node.status === 'offline' && !node.url;
    const hasUpdate = !!(latestWorkerVersion && node.current_version && node.current_version !== latestWorkerVersion);
    return (
      <TableRow key={node.id}>
        <TableCell className="font-medium">{node.name}</TableCell>
        <TableCell className="font-mono text-sm text-muted-foreground">
          {node.url || <span className="italic">{t('notConnected')}</span>}
        </TableCell>
        <TableCell className="text-sm">{node.region}</TableCell>
        <TableCell>
          <Badge variant={statusVariant(node.status)}>{t(`status.${node.status}`)}</Badge>
        </TableCell>
        <TableCell>{node.projects_count ?? 0}</TableCell>
        <TableCell>
          <div className="flex items-center gap-2 min-w-[100px]">
            <Progress value={node.cpu_usage} className="h-2 flex-1" />
            <span className="text-xs text-muted-foreground w-10 text-right">{node.cpu_usage}%</span>
          </div>
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-2 min-w-[100px]">
            <Progress value={node.ram_usage} className="h-2 flex-1" />
            <span className="text-xs text-muted-foreground w-10 text-right">{node.ram_usage}%</span>
          </div>
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-2 min-w-[100px]">
            <Progress value={node.disk_usage} className="h-2 flex-1" />
            <span className="text-xs text-muted-foreground w-10 text-right">{node.disk_usage}%</span>
          </div>
        </TableCell>
        <TableCell className="text-sm font-mono">
          <div className="flex items-center gap-1.5">
            <span>{node.current_version || '-'}</span>
            {latestWorkerVersion && node.current_version && node.current_version !== latestWorkerVersion && (
              <Badge variant="outline" className="text-xs text-orange-500 border-orange-500/30">
                {latestWorkerVersion}
              </Badge>
            )}
          </div>
        </TableCell>
        <TableCell className="text-sm text-muted-foreground">
          {formatHeartbeat(node.last_heartbeat, t)}
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-1">
            {node.status === 'online' && node.update_status === 'updating' && (
              <Badge variant="outline" className="text-blue-600 border-blue-500/30 gap-1 mr-1">
                <Loader2 className="h-3 w-3 animate-spin" />
              </Badge>
            )}
            {node.status === 'online' && (!node.update_status || node.update_status === 'idle' || node.update_status === 'failed') && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                title={hasUpdate ? t('triggerUpdate') : t('updateDialog.upToDate')}
                onClick={() => openUpdateDialog(node)}
                disabled={!hasUpdate}
              >
                <Download className={`h-4 w-4 ${hasUpdate ? 'text-orange-500' : ''}`} />
              </Button>
            )}
            {(isNotConnected || node.status === 'offline') && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                title={t('setupCommand')}
                onClick={() => regenerateTokenMutation.mutate(node.id)}
                disabled={regenerateTokenMutation.isPending}
              >
                <Terminal className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => openEdit(node)}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive"
              onClick={() => setDeleteTarget({ id: node.id, name: node.name })}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <PageWrapper>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <Button onClick={() => { closeDialog(); setCreateOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" />{t('addNode')}
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : allNodes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Server className="h-12 w-12 text-muted-foreground mb-4" />
          <h2 className="text-lg font-medium mb-2">{t('empty')}</h2>
          <p className="text-muted-foreground mb-4">{t('emptyDesc')}</p>
          <Button onClick={() => { closeDialog(); setCreateOpen(true); }}>
            <Plus className="h-4 w-4 mr-2" />{t('addNode')}
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* System Nodes */}
          <div>
            <h2 className="text-lg font-semibold mb-3">{t('systemNodes')}</h2>
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('headers.name')}</TableHead>
                    <TableHead>{t('headers.url')}</TableHead>
                    <TableHead>{t('headers.region')}</TableHead>
                    <TableHead>{t('headers.status')}</TableHead>
                    <TableHead>{t('headers.projects')}</TableHead>
                    <TableHead>{t('headers.cpu')}</TableHead>
                    <TableHead>{t('headers.ram')}</TableHead>
                    <TableHead>{t('headers.disk')}</TableHead>
                    <TableHead>{t('headers.version')}</TableHead>
                    <TableHead>{t('headers.lastHeartbeat')}</TableHead>
                    <TableHead className="w-36" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {systemNodes.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">{t('noSystemNodes')}</TableCell>
                    </TableRow>
                  ) : systemNodes.map(renderNodeRow)}
                </TableBody>
              </Table>
            </Card>
          </div>

          {/* User Nodes */}
          {userNodes.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold mb-3">{t('userNodes')}</h2>
              <Card>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('headers.name')}</TableHead>
                      <TableHead>{t('headers.url')}</TableHead>
                      <TableHead>{t('headers.region')}</TableHead>
                      <TableHead>{t('headers.status')}</TableHead>
                      <TableHead>{t('headers.projects')}</TableHead>
                      <TableHead>{t('headers.cpu')}</TableHead>
                      <TableHead>{t('headers.ram')}</TableHead>
                      <TableHead>{t('headers.lastHeartbeat')}</TableHead>
                      <TableHead className="w-28" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {userNodes.map(renderNodeRow)}
                  </TableBody>
                </Table>
              </Card>
            </div>
          )}
        </div>
      )}

      {/* Create / Edit Node Dialog */}
      <Dialog open={createOpen} onOpenChange={(o) => { if (!o) closeDialog(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editId ? t('editDialog.title') : t('createDialog.title')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t('createDialog.name')}</Label>
              <Input
                value={form.name}
                onChange={(e) => {
                  const name = e.target.value;
                  setForm((prev) => ({
                    ...prev,
                    name,
                    ...(slugTouched ? {} : { slug: transliterate(name.trim()) }),
                  }));
                }}
                className="mt-1"
                placeholder={t('createDialog.namePlaceholder')}
              />
            </div>
            {!editId && (
              <div>
                <Label>{t('createDialog.slug')}</Label>
                <Input
                  value={form.slug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setForm((prev) => ({ ...prev, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }));
                  }}
                  className="mt-1"
                  placeholder={t('createDialog.slugPlaceholder')}
                />
                {form.slug.length > 0 && form.slug.length < 2 && (
                  <p className="text-xs text-destructive mt-1">{t('createDialog.slugMin')}</p>
                )}
              </div>
            )}
            {editId && (
              <div>
                <Label>URL</Label>
                <Input
                  value={form.url}
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                  className="mt-1"
                  placeholder="https://fl.dataforge.me"
                />
                <p className="text-xs text-muted-foreground mt-1">{t('editDialog.urlHint')}</p>
              </div>
            )}
            <div>
              <Label>{t('createDialog.region')}</Label>
              <Input value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} className="mt-1" placeholder={t('createDialog.regionPlaceholder')} />
            </div>
            <div>
              <Label>{t('createDialog.maxProjects')}</Label>
              <Input type="number" min={1} value={form.maxProjects} onChange={(e) => setForm({ ...form, maxProjects: Number(e.target.value) })} className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>{t('createDialog.cancel')}</Button>
            {editId ? (
              <Button
                onClick={() => updateMutation.mutate()}
                disabled={!form.name || updateMutation.isPending}
              >
                {updateMutation.isPending ? t('editDialog.saving') : t('editDialog.save')}
              </Button>
            ) : (
              <Button
                onClick={() => createMutation.mutate()}
                disabled={!form.name || form.slug.length < 2 || !/^[a-z0-9-]+$/.test(form.slug) || createMutation.isPending}
              >
                {createMutation.isPending ? t('createDialog.creating') : t('createDialog.create')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Setup Command Dialog */}
      <Dialog open={!!setupToken} onOpenChange={(o) => { if (!o) { setSetupToken(''); setSetupNodeName(''); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('setupCommand')} — {setupNodeName}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t('setupCommandDesc')}</p>
          <div className="flex gap-2 mb-2">
            <Button
              variant={setupOs === 'linux' ? 'default' : 'outline'}
              size="sm"
              onClick={() => { setSetupOs('linux'); setSetupCopied(false); }}
            >
              Linux / macOS
            </Button>
            <Button
              variant={setupOs === 'windows' ? 'default' : 'outline'}
              size="sm"
              onClick={() => { setSetupOs('windows'); setSetupCopied(false); }}
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
              onClick={handleCopy}
            >
              {setupCopied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => { setSetupToken(''); setSetupNodeName(''); }}>{t('apiKeyDialog.done')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={t('deleteConfirm.title')}
        description={t('deleteConfirm.desc', { name: deleteTarget?.name })}
        confirmText={t('deleteConfirm.confirm')}
        variant="destructive"
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        loading={deleteMutation.isPending}
      />

      {/* Update Dialog */}
      <Dialog open={!!updateNode} onOpenChange={(o) => { if (!o) closeUpdateDialog(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowUpCircle className="h-5 w-5" />
              {t('updateDialog.title')}
            </DialogTitle>
          </DialogHeader>

          {updateStep === 'confirm' && updateNode && (
            <div className="space-y-4">
              <div className="rounded-lg border p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t('updateDialog.node')}</span>
                  <span className="font-medium">{updateNode.name}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t('updateDialog.currentVersion')}</span>
                  <span className="font-mono">{updateNode.current_version || '-'}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t('updateDialog.newVersion')}</span>
                  <Badge variant="outline" className="text-orange-500 border-orange-500/30 font-mono">
                    {latestWorkerVersion}
                  </Badge>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">{t('updateDialog.confirmDesc')}</p>
              <DialogFooter>
                <Button variant="outline" onClick={closeUpdateDialog}>{t('createDialog.cancel')}</Button>
                <Button
                  onClick={() => triggerUpdateMutation.mutate(updateNode.id)}
                  disabled={triggerUpdateMutation.isPending}
                >
                  {triggerUpdateMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4 mr-2" />
                  )}
                  {t('updateDialog.update')}
                </Button>
              </DialogFooter>
            </div>
          )}

          {updateStep === 'progress' && (
            <div className="space-y-6 py-4">
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
                  <span className="text-sm font-medium">{t('updateDialog.updating')}</span>
                </div>
                <Progress value={updateProgress} className="h-2" />
                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground flex items-center gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                    {t('updateDialog.step1')}
                  </p>
                  <p className="text-xs text-muted-foreground flex items-center gap-2">
                    {updateProgress > 30 ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                    ) : (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
                    )}
                    {t('updateDialog.step2')}
                  </p>
                  <p className="text-xs text-muted-foreground flex items-center gap-2">
                    {updateProgress > 60 ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
                    ) : (
                      <span className="h-3.5 w-3.5 rounded-full border border-muted-foreground/30" />
                    )}
                    {t('updateDialog.step3')}
                  </p>
                </div>
              </div>
              <p className="text-xs text-center text-muted-foreground">{t('updateDialog.wait')}</p>
            </div>
          )}

          {updateStep === 'done' && (
            <div className="space-y-4 text-center py-6">
              <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto" />
              <div>
                <h3 className="text-lg font-semibold">{t('updateDialog.success')}</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {t('updateDialog.successDesc', { version: latestWorkerVersion })}
                </p>
              </div>
              <DialogFooter className="sm:justify-center">
                <Button onClick={closeUpdateDialog}>{t('updateDialog.close')}</Button>
              </DialogFooter>
            </div>
          )}

          {updateStep === 'error' && (
            <div className="space-y-4 text-center py-6">
              <XCircle className="h-12 w-12 text-destructive mx-auto" />
              <div>
                <h3 className="text-lg font-semibold">{t('updateDialog.failed')}</h3>
                <p className="text-sm text-muted-foreground mt-1">{updateError}</p>
              </div>
              <DialogFooter className="sm:justify-center">
                <Button variant="outline" onClick={closeUpdateDialog}>{t('updateDialog.close')}</Button>
                <Button onClick={() => { setUpdateStep('confirm'); setUpdateProgress(0); }}>
                  {t('updateDialog.retry')}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </PageWrapper>
  );
}
