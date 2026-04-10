import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, ScrollText, Shield } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { useCurrentProject } from '@/hooks/useProject';
import { auditApi } from '@/api/audit.api';
import { usePageTitle } from '@/hooks/usePageTitle';

const ACTION_TYPES = ['all', 'auth', 'project', 'node', 'table', 'data', 'api', 'webhook', 'token', 'invite', 'sql', 'cache', 'quota'];

function actionVariant(action: string): 'default' | 'destructive' | 'outline' {
  if (action.includes('delete') || action.includes('drop') || action.includes('block')) return 'destructive';
  if (action.includes('create') || action.includes('insert') || action.includes('login')) return 'default';
  return 'outline';
}

function actionColor(action: string): string {
  if (action.startsWith('quota')) return 'bg-orange-500/10 text-orange-500 border-orange-500/20';
  if (action.startsWith('auth')) return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
  if (action.includes('delete') || action.includes('drop')) return 'bg-red-500/10 text-red-500 border-red-500/20';
  if (action.includes('create') || action.includes('insert')) return 'bg-green-500/10 text-green-500 border-green-500/20';
  if (action.includes('update') || action.includes('alter')) return 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20';
  if (action.startsWith('node') || action.includes('regenerate')) return 'bg-purple-500/10 text-purple-500 border-purple-500/20';
  if (action.startsWith('project')) return 'bg-cyan-500/10 text-cyan-500 border-cyan-500/20';
  if (action.startsWith('cache')) return 'bg-orange-500/10 text-orange-500 border-orange-500/20';
  return 'bg-muted text-muted-foreground';
}

function formatDetails(details: unknown): string | null {
  if (!details || typeof details !== 'object') return null;
  const d = details as Record<string, unknown>;
  const parts: string[] = [];
  if (d.name) parts.push(String(d.name));
  if (d.slug) parts.push(String(d.slug));
  if (d.email) parts.push(String(d.email));
  if (d.role) parts.push(String(d.role));
  if (d.keysCleared) parts.push(`${d.keysCleared} keys`);
  if (parts.length > 0) return parts.join(' · ');
  const json = JSON.stringify(d);
  return json === '{}' ? null : json;
}

interface AuditLog {
  id: string;
  action: string;
  user_email: string | null;
  is_superadmin_action: boolean;
  resource_type: string | null;
  resource_id: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

export function AuditLogPage() {
  const { t } = useTranslation('audit');
  usePageTitle(t('pageTitle'));
  const { data: project } = useCurrentProject();
  const isGlobal = !project?.id;
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<AuditLog | null>(null);

  const queryParams = {
    page: String(page),
    limit: '50',
    ...(action !== 'all' ? { action } : {}),
    ...(search ? { search } : {}),
  };

  const { data, isLoading } = useQuery({
    queryKey: ['audit', project?.id ?? 'global', page, action, search],
    queryFn: () => project?.id
      ? auditApi.getByProject(project.id, queryParams)
      : auditApi.getGlobal(queryParams),
  });

  const logs = (data?.data ?? []) as AuditLog[];
  const pagination = data?.pagination;

  return (
    <PageWrapper>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">{isGlobal ? t('globalTitle') : t('pageTitle')}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isGlobal ? t('globalDesc') : t('projectDesc')}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t('searchPlaceholder')}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-9"
          />
        </div>
        <Select value={action} onValueChange={(v) => { setAction(v); setPage(1); }}>
          <SelectTrigger className="w-44">
            <SelectValue>{action === 'all' ? t('allTypes') : t(`types.${action}`, action)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {ACTION_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {type === 'all' ? t('allTypes') : t(`types.${type}`, type)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
        </div>
      ) : logs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <ScrollText className="h-12 w-12 text-muted-foreground mb-4" />
          <h2 className="text-lg font-medium mb-2">{t('noLogs')}</h2>
          <p className="text-muted-foreground">{t('noLogsDesc')}</p>
        </div>
      ) : (
        <>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[170px]">{t('headers.time')}</TableHead>
                  <TableHead>{t('headers.user')}</TableHead>
                  <TableHead>{t('headers.action')}</TableHead>
                  <TableHead>{t('headers.resource')}</TableHead>
                  <TableHead>{t('headers.details')}</TableHead>
                  {isGlobal && <TableHead className="w-[100px]">{t('headers.ip')}</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow
                    key={log.id}
                    className={`cursor-pointer hover:bg-muted/50 ${log.is_superadmin_action ? 'border-l-2 border-l-orange-500' : ''}`}
                    onClick={() => setSelected(log)}
                  >
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-sm">
                      <div className="flex items-center gap-1.5">
                        {log.user_email ?? '—'}
                        {log.is_superadmin_action && (
                          <Badge variant="outline" className="text-[10px] px-1 py-0 text-orange-500 border-orange-500/30">
                            <Shield className="h-2.5 w-2.5 mr-0.5" />SA
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge className={actionColor(log.action)} variant="outline">
                        {log.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {log.resource_type ? `${log.resource_type}` : '—'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[250px] truncate">
                      {formatDetails(log.details) ?? '—'}
                    </TableCell>
                    {isGlobal && (
                      <TableCell className="text-xs text-muted-foreground font-mono">
                        {log.ip_address ?? '—'}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          {pagination && Number(pagination.totalPages) > 1 && (
            <div className="flex items-center justify-center gap-3 mt-4">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                {t('previous')}
              </Button>
              <span className="text-sm text-muted-foreground">
                {t('page', { page, total: pagination.totalPages })}
              </span>
              <Button variant="outline" size="sm" disabled={page >= Number(pagination.totalPages)} onClick={() => setPage(page + 1)}>
                {t('next')}
              </Button>
            </div>
          )}
        </>
      )}

      {/* Detail Sheet */}
      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>{t('detail.title')}</SheetTitle>
              </SheetHeader>
              <div className="mt-4 space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Badge className={actionColor(selected.action)} variant="outline">
                    {selected.action}
                  </Badge>
                  {selected.is_superadmin_action && (
                    <Badge variant="outline" className="text-orange-500 border-orange-500/30">
                      <Shield className="h-3 w-3 mr-1" />{t('detail.superadmin')}
                    </Badge>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-muted-foreground text-xs mb-0.5">{t('headers.time')}</p>
                    <p>{new Date(selected.created_at).toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs mb-0.5">{t('headers.user')}</p>
                    <p>{selected.user_email ?? '—'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs mb-0.5">{t('headers.resource')}</p>
                    <p className="font-mono text-xs">{selected.resource_type ?? '—'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs mb-0.5">{t('detail.resourceId')}</p>
                    <p className="font-mono text-xs break-all">{selected.resource_id ?? '—'}</p>
                  </div>
                  {selected.ip_address && (
                    <div>
                      <p className="text-muted-foreground text-xs mb-0.5">{t('headers.ip')}</p>
                      <p className="font-mono text-xs">{selected.ip_address}</p>
                    </div>
                  )}
                </div>

                {selected.details && Object.keys(selected.details).length > 0 && (
                  <div>
                    <p className="text-sm font-medium mb-1">{t('headers.details')}</p>
                    <pre className="text-xs bg-muted p-3 rounded-md overflow-x-auto max-h-40 whitespace-pre-wrap">
                      {JSON.stringify(selected.details, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </PageWrapper>
  );
}
