import { useState, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Download, Trash2, RotateCcw, ShieldAlert, HardDrive,
  Clock, Archive, Loader2, Plus, AlertTriangle, Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { useCurrentProject } from '@/hooks/useProject';
import { usePageTitle } from '@/hooks/usePageTitle';
import { backupsApi, type Backup } from '@/api/backups.api';
import { toast } from 'sonner';

function formatBytes(bytes: number | string | null): string {
  const n = Number(bytes);
  if (!n || isNaN(n)) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let size = n;
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function StatusBadge({ status, t }: { status: string; t: any }) {
  const colors: Record<string, string> = {
    pending: 'bg-muted text-muted-foreground',
    running: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    completed: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    failed: 'bg-red-500/15 text-red-400 border-red-500/30',
  };
  return (
    <Badge variant="outline" className={`text-[10px] ${colors[status] ?? ''}`}>
      {status === 'running' && <Loader2 className="h-2.5 w-2.5 mr-1 animate-spin" />}
      {t(`settings:backups.status.${status}`)}
    </Badge>
  );
}

const INTERVALS = ['12h', '24h', '48h', '7d'] as const;

export function BackupsPage() {
  const { t } = useTranslation(['settings', 'common']);
  usePageTitle(t('settings:backups.title'));
  const { data: project } = useCurrentProject();
  const queryClient = useQueryClient();

  const [deleteTarget, setDeleteTarget] = useState<Backup | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<Backup | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: backupsData } = useQuery({
    queryKey: ['backups', project?.id],
    queryFn: () => backupsApi.list(project!.id),
    enabled: !!project?.id,
    refetchInterval: 10000,
  });
  const { data: stats } = useQuery({
    queryKey: ['backups-stats', project?.id],
    queryFn: () => backupsApi.stats(project!.id),
    enabled: !!project?.id,
    refetchInterval: 10000,
  });
  const { data: scheduleData } = useQuery({
    queryKey: ['backup-schedule', project?.id],
    queryFn: () => backupsApi.getSchedule(project!.id),
    enabled: !!project?.id,
  });

  const backups = backupsData?.backups ?? [];
  const schedule = scheduleData?.schedule ?? null;
  const canCreateManual = (stats?.manualToday ?? 0) < (stats?.manualLimit ?? 2);
  const maxBackups = stats?.maxBackups ?? 10;
  const quotaPercent = stats ? Math.min(100, Math.round((stats.count / maxBackups) * 100)) : 0;
  const manualLeft = (stats?.manualLimit ?? 2) - (stats?.manualToday ?? 0);

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['backups', project?.id] });
    queryClient.invalidateQueries({ queryKey: ['backups-stats', project?.id] });
  }, [queryClient, project?.id]);

  const createMutation = useMutation({
    mutationFn: () => backupsApi.create(project!.id),
    onSuccess: () => { toast.success(t('settings:backups.created')); invalidate(); },
    onError: (err: Error) => toast.error(err.message),
  });
  const deleteMutation = useMutation({
    mutationFn: (backupId: string) => backupsApi.delete(project!.id, backupId),
    onSuccess: () => { toast.success(t('settings:backups.deleted')); setDeleteTarget(null); invalidate(); },
    onError: (err: Error) => toast.error(err.message),
  });
  const restoreMutation = useMutation({
    mutationFn: (backupId: string) => backupsApi.restore(project!.id, backupId),
    onSuccess: () => { toast.success(t('settings:backups.restoreSuccess')); setRestoreTarget(null); },
    onError: (err: Error) => toast.error(err.message),
  });
  const scheduleMutation = useMutation({
    mutationFn: (data: { interval?: string; is_active?: boolean; max_backups?: number }) =>
      backupsApi.updateSchedule(project!.id, data),
    onSuccess: () => {
      toast.success(t('settings:backups.scheduleSaved'));
      queryClient.invalidateQueries({ queryKey: ['backup-schedule', project?.id] });
    },
    onError: (err: Error) => toast.error(err.message),
  });
  const importMutation = useMutation({
    mutationFn: (file: File) => backupsApi.import(project!.id, file),
    onSuccess: () => { toast.success(t('settings:backups.imported')); invalidate(); },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleImportFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 100 * 1024 * 1024) { toast.error('File too large (max 100 MB)'); return; }
    importMutation.mutate(file);
    e.target.value = '';
  }, [importMutation]);

  const handleDownload = useCallback(async (backup: Backup) => {
    try { await backupsApi.download(project!.id, backup.id); } catch (err: any) { toast.error(err.message); }
  }, [project?.id]);

  const currentMax = schedule?.max_backups ?? 5;

  return (
    <PageWrapper>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-bold">{t('settings:backups.title')}</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => fileInputRef.current?.click()} disabled={importMutation.isPending}>
            {importMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            {t('settings:backups.importBackup')}
          </Button>
          <Button size="sm" className="gap-1.5" onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !canCreateManual}>
            {createMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            {t('settings:backups.createBackup')}
          </Button>
          <input ref={fileInputRef} type="file" accept=".json,.json.gz,.gz" className="hidden" onChange={handleImportFile} />
        </div>
      </div>

      {/* Warning */}
      <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg bg-amber-500/8 border border-amber-500/15 mb-5">
        <ShieldAlert className="h-4 w-4 text-amber-400 shrink-0" />
        <p className="text-xs text-amber-300/80">{t('settings:backups.warning')}</p>
      </div>

      {/* Hero stats row */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {/* Backups count */}
        <div className="rounded-xl border bg-card p-4">
          <Archive className="h-4 w-4 text-primary mb-2" />
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-bold font-mono">{stats?.count ?? 0}</span>
            <span className="text-xs text-muted-foreground">/ {maxBackups}</span>
          </div>
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{t('settings:backups.stats.total')}</span>
        </div>

        {/* Size */}
        <div className="rounded-xl border bg-card p-4">
          <HardDrive className="h-4 w-4 text-blue-400 mb-2" />
          <span className="text-2xl font-bold font-mono">{formatBytes(stats?.totalSize ?? 0)}</span>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{t('settings:backups.stats.size')}</div>
        </div>

        {/* Quota bar */}
        <div className="rounded-xl border bg-card p-4 flex flex-col justify-center">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{t('settings:backups.stats.quota')}</span>
            <span className="text-xs font-mono font-bold">{quotaPercent}%</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${quotaPercent >= 90 ? 'bg-red-500' : quotaPercent >= 70 ? 'bg-amber-500' : 'bg-primary'}`}
              style={{ width: `${quotaPercent}%` }}
            />
          </div>
          <span className="text-[10px] text-muted-foreground mt-1.5">{stats?.count ?? 0} / {maxBackups}</span>
        </div>

        {/* Daily limit */}
        <div className="rounded-xl border bg-card p-4">
          <Clock className="h-4 w-4 text-purple-400 mb-2" />
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-bold font-mono">{Math.max(0, manualLeft)}</span>
            <span className="text-xs text-muted-foreground">/ {stats?.manualLimit ?? 2}</span>
          </div>
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{t('settings:backups.rateLimitLabel')}</span>
        </div>
      </div>

      {/* Auto-backups + Backup list side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
        {/* Left: Auto-backups config */}
        <div className="rounded-xl border bg-card p-4 self-start">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold">{t('settings:backups.schedule')}</span>
            </div>
            <Switch
              checked={schedule?.is_active ?? false}
              onCheckedChange={(checked) => scheduleMutation.mutate({ is_active: checked })}
            />
          </div>

          {(schedule?.is_active ?? false) && (
            <div className="space-y-3 pt-3 border-t">
              <div>
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5 block">{t('settings:backups.intervalLabel')}</Label>
                <div className="grid grid-cols-2 gap-1.5">
                  {INTERVALS.map((iv) => {
                    const active = schedule?.cron_expression === iv;
                    return (
                      <button
                        key={iv}
                        type="button"
                        onClick={() => scheduleMutation.mutate({ interval: iv })}
                        className={`px-2 py-1.5 rounded-md text-[11px] font-medium border transition-colors ${
                          active ? 'border-primary bg-primary/10 text-primary' : 'border-border/50 hover:border-border text-muted-foreground'
                        }`}
                      >
                        {t(`settings:backups.intervals.${iv}`)}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5 block">{t('settings:backups.maxBackups')}</Label>
                <div className="flex items-center gap-1.5">
                  <Button variant="outline" size="icon" className="h-7 w-7" disabled={currentMax <= 2}
                    onClick={() => scheduleMutation.mutate({ max_backups: Math.max(2, currentMax - 1) })}>
                    <span className="font-bold">−</span>
                  </Button>
                  <span className="text-sm font-mono font-bold w-8 text-center">{currentMax}</span>
                  <Button variant="outline" size="icon" className="h-7 w-7" disabled={currentMax >= maxBackups}
                    onClick={() => scheduleMutation.mutate({ max_backups: Math.min(maxBackups, currentMax + 1) })}>
                    <span className="font-bold">+</span>
                  </Button>
                  <span className="text-[9px] text-muted-foreground/60 ml-1">max {maxBackups}</span>
                </div>
              </div>

              <p className="text-[9px] text-muted-foreground/60 leading-relaxed">{t('settings:backups.scheduleDesc')}</p>
            </div>
          )}
        </div>

        {/* Right: Backup list */}
        <div>
          {backups.length > 0 ? (
            <div className="rounded-xl border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[10px] uppercase tracking-wider">{t('settings:backups.headers.date')}</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider">{t('settings:backups.headers.type')}</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider">{t('settings:backups.headers.status')}</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider">{t('settings:backups.headers.size')}</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider">{t('settings:backups.headers.tables')}</TableHead>
                    <TableHead className="w-[100px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {backups.map((b) => {
                    let tables: string[] = [];
                    try { tables = JSON.parse(b.metadata ?? '{}').tables ?? []; } catch {}
                    return (
                      <TableRow key={b.id}>
                        <TableCell className="text-xs font-mono">{new Date(b.created_at).toLocaleString()}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">{t(`settings:backups.types.${b.type}`)}</Badge>
                        </TableCell>
                        <TableCell><StatusBadge status={b.status} t={t} /></TableCell>
                        <TableCell className="text-xs font-mono">{formatBytes(b.file_size)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{tables.length || '—'}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-0.5 justify-end">
                            {b.status === 'completed' && (
                              <>
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDownload(b)}>
                                  <Download className="h-3.5 w-3.5" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setRestoreTarget(b)}>
                                  <RotateCcw className="h-3.5 w-3.5" />
                                </Button>
                              </>
                            )}
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => setDeleteTarget(b)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-center rounded-xl border border-dashed">
              <Archive className="h-10 w-10 text-muted-foreground/15 mb-3" />
              <h3 className="text-sm font-medium mb-1">{t('settings:backups.noBackups')}</h3>
              <p className="text-xs text-muted-foreground max-w-[280px]">{t('settings:backups.noBackupsDesc')}</p>
            </div>
          )}
        </div>
      </div>

      {/* Delete dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('settings:backups.deleteConfirm.title')}</DialogTitle>
            <DialogDescription>{t('settings:backups.deleteConfirm.desc')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>{t('common:actions.cancel')}</Button>
            <Button variant="destructive" onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)} disabled={deleteMutation.isPending}>
              {t('common:actions.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Restore dialog */}
      <Dialog open={!!restoreTarget} onOpenChange={(open) => { if (!open) setRestoreTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-400" />
              {t('settings:backups.restoreConfirm.title')}
            </DialogTitle>
            <DialogDescription>{t('settings:backups.restoreConfirm.desc')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestoreTarget(null)}>{t('common:actions.cancel')}</Button>
            <Button onClick={() => restoreTarget && restoreMutation.mutate(restoreTarget.id)} disabled={restoreMutation.isPending}>
              {restoreMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RotateCcw className="h-4 w-4 mr-1" />}
              {t('settings:backups.restoreConfirm.title')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageWrapper>
  );
}
