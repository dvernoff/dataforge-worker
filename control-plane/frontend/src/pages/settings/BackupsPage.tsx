import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { useCurrentProject } from '@/hooks/useProject';
import { usePageTitle } from '@/hooks/usePageTitle';
import { Progress } from '@/components/ui/progress';
import { backupsApi, type Backup } from '@/api/backups.api';
import { schemaApi } from '@/api/schema.api';
import { quotasApi } from '@/api/quotas.api';
import { toast } from 'sonner';
import { Download, Trash2, Plus, Loader2, AlertTriangle, Database, RotateCcw } from 'lucide-react';

function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === 0) return '-';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
  return `${size.toFixed(1)} ${units[i]}`;
}

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'completed': return 'default';
    case 'running': return 'secondary';
    case 'pending': return 'outline';
    case 'failed': return 'destructive';
    default: return 'outline';
  }
}

function parseMetadataTables(backup: Backup): string[] {
  if (!backup.metadata) return [];
  try {
    const meta = typeof backup.metadata === 'string' ? JSON.parse(backup.metadata) : backup.metadata;
    return meta.tables ?? [];
  } catch {
    return [];
  }
}

export function BackupsPage() {
  const { t } = useTranslation(['settings', 'common']);
  usePageTitle(t('settings:backups.title'));
  const { data: project } = useCurrentProject();
  const queryClient = useQueryClient();

  const [deleteBackupId, setDeleteBackupId] = useState<string | null>(null);
  const [restoreBackupId, setRestoreBackupId] = useState<string | null>(null);
  const [cronExpression, setCronExpression] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [maxBackups, setMaxBackups] = useState(5);

  // Create backup dialog state
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [selectedTables, setSelectedTables] = useState<string[]>([]);

  // Fetch backups
  const { data: backupsData } = useQuery({
    queryKey: ['backups', project?.id],
    queryFn: () => backupsApi.list(project!.id),
    enabled: !!project?.id,
  });

  // Fetch schedule
  const { data: scheduleData } = useQuery({
    queryKey: ['backups-schedule', project?.id],
    queryFn: () => backupsApi.getSchedule(project!.id),
    enabled: !!project?.id,
  });

  // Fetch tables for selection
  const { data: tablesData } = useQuery({
    queryKey: ['tables', project?.id],
    queryFn: () => schemaApi.listTables(project!.id),
    enabled: !!project?.id,
  });

  useEffect(() => {
    if (scheduleData?.schedule) {
      setCronExpression(scheduleData.schedule.cron_expression ?? '');
      setIsActive(scheduleData.schedule.is_active);
      setMaxBackups(scheduleData.schedule.max_backups);
    }
  }, [scheduleData]);

  // Fetch user quota for backup limits
  const { data: quotaData } = useQuery({
    queryKey: ['quotas', 'me'],
    queryFn: () => quotasApi.getMyQuota(),
  });

  const backups = backupsData?.backups ?? [];
  const tablesList = tablesData?.tables ?? [];
  const maxBackupsQuota = quotaData?.quota?.max_backups ?? 10;
  const currentBackupCount = backups.filter((b) => b.status === 'completed').length;
  const quotaReached = currentBackupCount >= maxBackupsQuota;
  const usagePercent = maxBackupsQuota > 0 ? Math.min((currentBackupCount / maxBackupsQuota) * 100, 100) : 0;

  const allTablesSelected = selectedTables.length === tablesList.length && tablesList.length > 0;

  function handleToggleTable(tableName: string) {
    setSelectedTables((prev) =>
      prev.includes(tableName)
        ? prev.filter((t) => t !== tableName)
        : [...prev, tableName]
    );
  }

  function handleToggleAll() {
    if (allTablesSelected) {
      setSelectedTables([]);
    } else {
      setSelectedTables(tablesList.map((t) => t.name));
    }
  }

  function openCreateDialog() {
    if (quotaReached) {
      toast.warning(t('settings:backups.quotaReached'));
      return;
    }
    setSelectedTables([]);
    setCreateDialogOpen(true);
  }

  // Create backup
  const createMutation = useMutation({
    mutationFn: (tables?: string[]) => backupsApi.create(project!.id, tables),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backups', project?.id] });
      setCreateDialogOpen(false);
      toast.success(t('settings:backups.creating'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Delete backup
  const deleteMutation = useMutation({
    mutationFn: (backupId: string) => backupsApi.delete(project!.id, backupId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backups', project?.id] });
      setDeleteBackupId(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Restore backup
  const restoreMutation = useMutation({
    mutationFn: (backupId: string) => backupsApi.restore(project!.id, backupId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backups', project?.id] });
      setRestoreBackupId(null);
      toast.success(t('settings:backups.restoreSuccess'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Download backup
  const downloadMutation = useMutation({
    mutationFn: (backupId: string) => backupsApi.download(project!.id, backupId),
    onError: (err: Error) => toast.error(err.message),
  });

  // Update schedule
  const scheduleMutation = useMutation({
    mutationFn: () => backupsApi.updateSchedule(project!.id, {
      cron_expression: cronExpression,
      is_active: isActive,
      max_backups: maxBackups,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backups-schedule', project?.id] });
      toast.success(t('settings:backups.scheduleSaved'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <PageWrapper>
      <h1 className="text-2xl font-bold mb-6">{t('settings:backups.title')}</h1>

      {/* Quota Usage */}
      <Card className="mb-6">
        <CardContent>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">{t('settings:backups.quotaUsage')}</span>
            <span className="text-sm text-muted-foreground">
              {currentBackupCount}/{maxBackupsQuota} {t('settings:backups.used')}
            </span>
          </div>
          <Progress value={usagePercent} className="h-2" />
          {quotaReached && (
            <div className="flex items-center gap-2 mt-2 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4" />
              {t('settings:backups.quotaReached')}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Backups List */}
      <Card className="mb-6">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{t('settings:backups.title')}</CardTitle>
          <Button onClick={openCreateDialog} disabled={createMutation.isPending}>
            {createMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Plus className="h-4 w-4 mr-2" />
            )}
            {t('settings:backups.createBackup')}
          </Button>
        </CardHeader>
        <CardContent>
          {backups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Database className="h-12 w-12 text-muted-foreground mb-4" />
              <h2 className="text-lg font-medium mb-2">{t('settings:backups.noBackups')}</h2>
              <p className="text-muted-foreground">{t('settings:backups.noBackupsDesc')}</p>
            </div>
          ) : (
            <div className="border rounded-lg overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('settings:backups.headers.date')}</TableHead>
                    <TableHead>{t('settings:backups.headers.type')}</TableHead>
                    <TableHead>{t('settings:backups.headers.status')}</TableHead>
                    <TableHead>{t('settings:backups.headers.size')}</TableHead>
                    <TableHead>Tables</TableHead>
                    <TableHead className="text-right">{t('common:actions.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {backups.map((backup: Backup) => {
                    const tables = parseMetadataTables(backup);
                    return (
                      <TableRow key={backup.id}>
                        <TableCell className="whitespace-nowrap">
                          {new Date(backup.created_at).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {t(`settings:backups.types.${backup.type}`)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(backup.status)}>
                            {t(`settings:backups.status.${backup.status}`)}
                          </Badge>
                        </TableCell>
                        <TableCell>{formatBytes(backup.file_size)}</TableCell>
                        <TableCell>
                          {tables.length > 0 ? (
                            <span className="text-sm text-muted-foreground">
                              {tables.length} {tables.length === 1 ? 'table' : 'tables'}
                            </span>
                          ) : (
                            <span className="text-sm text-muted-foreground">All tables</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {backup.status === 'completed' && backup.file_path && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => downloadMutation.mutate(backup.id)}
                                  disabled={downloadMutation.isPending}
                                  title="Download"
                                >
                                  <Download className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => setRestoreBackupId(backup.id)}
                                  title="Restore"
                                >
                                  <RotateCcw className="h-4 w-4" />
                                </Button>
                              </>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive"
                              onClick={() => setDeleteBackupId(backup.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Schedule */}
      <Card>
        <CardHeader>
          <CardTitle>{t('settings:backups.schedule')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cron-expression">{t('settings:backups.cronExpression')}</Label>
            <Input
              id="cron-expression"
              value={cronExpression}
              onChange={(e) => setCronExpression(e.target.value)}
              placeholder="0 2 * * *"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="max-backups">{t('settings:backups.maxBackups')}</Label>
            <Input
              id="max-backups"
              type="number"
              min={1}
              max={maxBackupsQuota}
              value={maxBackups}
              onChange={(e) => setMaxBackups(Math.min(Number(e.target.value), maxBackupsQuota))}
            />
            <p className="text-xs text-muted-foreground">
              {t('settings:backups.maxScheduleHint', { max: maxBackupsQuota })}
            </p>
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="backup-active">{t('settings:backups.active')}</Label>
            <Switch
              id="backup-active"
              checked={isActive}
              onCheckedChange={setIsActive}
            />
          </div>
          <Button onClick={() => scheduleMutation.mutate()} disabled={scheduleMutation.isPending}>
            {t('common:actions.save')}
          </Button>
        </CardContent>
      </Card>

      {/* Create Backup Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('settings:backups.createBackup')}</DialogTitle>
            <DialogDescription>
              Select tables to include in the backup. Leave all unchecked to back up all tables.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-64 overflow-y-auto space-y-2 py-2">
            {tablesList.length > 0 && (
              <div className="flex items-center space-x-2 pb-2 border-b">
                <Checkbox
                  id="select-all"
                  checked={allTablesSelected}
                  onCheckedChange={handleToggleAll}
                />
                <Label htmlFor="select-all" className="font-medium cursor-pointer">
                  Select All ({tablesList.length} tables)
                </Label>
              </div>
            )}
            {tablesList.map((table) => (
              <div key={table.name} className="flex items-center space-x-2">
                <Checkbox
                  id={`table-${table.name}`}
                  checked={selectedTables.includes(table.name)}
                  onCheckedChange={() => handleToggleTable(table.name)}
                />
                <Label htmlFor={`table-${table.name}`} className="cursor-pointer flex-1">
                  <span>{table.name}</span>
                  <span className="text-xs text-muted-foreground ml-2">
                    ({table.row_count} rows)
                  </span>
                </Label>
              </div>
            ))}
            {tablesList.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                No tables found in this project.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button
              onClick={() => {
                const tables = selectedTables.length > 0 ? selectedTables : undefined;
                createMutation.mutate(tables);
              }}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t('settings:backups.createBackup')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <ConfirmDialog
        open={deleteBackupId !== null}
        onOpenChange={(open) => { if (!open) setDeleteBackupId(null); }}
        title={t('settings:backups.deleteConfirm.title')}
        description={t('settings:backups.deleteConfirm.desc')}
        confirmText={t('common:actions.delete')}
        variant="destructive"
        onConfirm={() => { if (deleteBackupId) deleteMutation.mutate(deleteBackupId); }}
        loading={deleteMutation.isPending}
      />

      {/* Restore Confirm Dialog */}
      <ConfirmDialog
        open={restoreBackupId !== null}
        onOpenChange={(open) => { if (!open) setRestoreBackupId(null); }}
        title="Restore Backup"
        description="This will overwrite current data in the backed-up tables with the backup contents. This action cannot be undone. Are you sure you want to proceed?"
        confirmText="Restore"
        variant="destructive"
        onConfirm={() => { if (restoreBackupId) restoreMutation.mutate(restoreBackupId); }}
        loading={restoreMutation.isPending}
      />
    </PageWrapper>
  );
}
