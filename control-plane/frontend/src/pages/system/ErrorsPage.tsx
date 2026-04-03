import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { usePageTitle } from '@/hooks/usePageTitle';
import { api } from '@/api/client';
import { toast } from 'sonner';

interface TrackedError {
  id: string;
  project_id: string | null;
  node_id: string | null;
  source: string;
  severity: string;
  title: string;
  message: string | null;
  stack_trace: string | null;
  metadata: Record<string, unknown> | null;
  status: string;
  acknowledged_by: string | null;
  resolved_at: string | null;
  created_at: string;
}

const errorsApi = {
  list: (params: Record<string, string>) => {
    const qs = new URLSearchParams(params).toString();
    return api.get<{ errors: TrackedError[]; total: number; page: number; limit: number }>(
      `/errors?${qs}`
    );
  },
  getById: (id: string) =>
    api.get<{ error: TrackedError }>(`/errors/${id}`),
  acknowledge: (id: string) =>
    api.post<{ error: TrackedError }>(`/errors/${id}/acknowledge`),
  resolve: (id: string) =>
    api.post<{ error: TrackedError }>(`/errors/${id}/resolve`),
};

function severityVariant(severity: string): 'default' | 'destructive' | 'outline' {
  switch (severity) {
    case 'critical': return 'destructive';
    case 'error': return 'destructive';
    case 'warning': return 'outline';
    default: return 'default';
  }
}

function statusVariant(status: string): 'default' | 'destructive' | 'outline' {
  switch (status) {
    case 'open': return 'destructive';
    case 'acknowledged': return 'outline';
    case 'resolved': return 'default';
    default: return 'default';
  }
}

export function ErrorsPage() {
  const { t } = useTranslation('system');
  usePageTitle(t('errors.title'));
  const queryClient = useQueryClient();

  const [source, setSource] = useState<string>('all');
  const [severity, setSeverity] = useState<string>('all');
  const [status, setStatus] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [selectedError, setSelectedError] = useState<TrackedError | null>(null);

  const params: Record<string, string> = { page: String(page), limit: '30' };
  if (source !== 'all') params.source = source;
  if (severity !== 'all') params.severity = severity;
  if (status !== 'all') params.status = status;

  const { data, isLoading } = useQuery({
    queryKey: ['tracked-errors', params],
    queryFn: () => errorsApi.list(params),
  });

  const acknowledgeMutation = useMutation({
    mutationFn: (id: string) => errorsApi.acknowledge(id),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['tracked-errors'] });
      setSelectedError(res.error);
      toast.success(t('errors.status.acknowledged'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const resolveMutation = useMutation({
    mutationFn: (id: string) => errorsApi.resolve(id),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['tracked-errors'] });
      setSelectedError(res.error);
      toast.success(t('errors.status.resolved'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const errors = data?.errors ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 30);

  return (
    <PageWrapper>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('errors.title')}</h1>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <Select value={source} onValueChange={(v) => { setSource(v); setPage(1); }}>
          <SelectTrigger className="w-44">
            <SelectValue>
              {source === 'all' ? t('errors.filters.allSources') : t(`errors.source.${source}`, source)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('errors.filters.allSources')}</SelectItem>
            <SelectItem value="api">{t('errors.source.api')}</SelectItem>
            <SelectItem value="webhook">{t('errors.source.webhook')}</SelectItem>
            <SelectItem value="cron">{t('errors.source.cron')}</SelectItem>
            <SelectItem value="node">{t('errors.source.node')}</SelectItem>
            <SelectItem value="system">{t('errors.source.system')}</SelectItem>
          </SelectContent>
        </Select>

        <Select value={severity} onValueChange={(v) => { setSeverity(v); setPage(1); }}>
          <SelectTrigger className="w-44">
            <SelectValue>
              {severity === 'all' ? t('errors.filters.allSeverities') : t(`errors.severity.${severity}`, severity)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('errors.filters.allSeverities')}</SelectItem>
            <SelectItem value="error">{t('errors.severity.error')}</SelectItem>
            <SelectItem value="warning">{t('errors.severity.warning')}</SelectItem>
            <SelectItem value="critical">{t('errors.severity.critical')}</SelectItem>
          </SelectContent>
        </Select>

        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
          <SelectTrigger className="w-44">
            <SelectValue>
              {status === 'all' ? t('errors.filters.allStatuses') : t(`errors.status.${status}`, status)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('errors.filters.allStatuses')}</SelectItem>
            <SelectItem value="open">{t('errors.status.open')}</SelectItem>
            <SelectItem value="acknowledged">{t('errors.status.acknowledged')}</SelectItem>
            <SelectItem value="resolved">{t('errors.status.resolved')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
        </div>
      ) : errors.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <AlertTriangle className="h-12 w-12 text-muted-foreground mb-4" />
          <h2 className="text-lg font-medium mb-2">{t('errors.empty')}</h2>
          <p className="text-muted-foreground">{t('errors.emptyDesc')}</p>
        </div>
      ) : (
        <>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('errors.headers.time')}</TableHead>
                  <TableHead>{t('errors.headers.source')}</TableHead>
                  <TableHead>{t('errors.headers.severity')}</TableHead>
                  <TableHead>{t('errors.headers.title')}</TableHead>
                  <TableHead>{t('errors.headers.status')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {errors.map((err) => (
                  <TableRow
                    key={err.id}
                    className="cursor-pointer"
                    onClick={() => setSelectedError(err)}
                  >
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {new Date(err.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{t(`errors.source.${err.source}`)}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={severityVariant(err.severity)}>
                        {t(`errors.severity.${err.severity}`)}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[400px] truncate">{err.title}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(err.status)}>
                        {t(`errors.status.${err.status}`)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          {totalPages > 1 && (
            <div className="flex justify-center gap-2 mt-4">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                {t('pagination.previous', { ns: 'common' })}
              </Button>
              <span className="text-sm text-muted-foreground self-center">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                {t('pagination.next', { ns: 'common' })}
              </Button>
            </div>
          )}
        </>
      )}

      {/* Error Detail Sheet */}
      <Sheet open={!!selectedError} onOpenChange={(o) => !o && setSelectedError(null)}>
        <SheetContent className="sm:max-w-xl overflow-y-auto">
          {selectedError && (
            <>
              <SheetHeader>
                <SheetTitle>{t('errors.detail.title')}</SheetTitle>
              </SheetHeader>
              <div className="mt-4 space-y-4">
                <div className="flex gap-2">
                  <Badge variant={severityVariant(selectedError.severity)}>
                    {t(`errors.severity.${selectedError.severity}`)}
                  </Badge>
                  <Badge variant="outline">
                    {t(`errors.source.${selectedError.source}`)}
                  </Badge>
                  <Badge variant={statusVariant(selectedError.status)}>
                    {t(`errors.status.${selectedError.status}`)}
                  </Badge>
                </div>

                <div>
                  <h4 className="text-sm font-medium mb-1">{selectedError.title}</h4>
                  <p className="text-xs text-muted-foreground">
                    {new Date(selectedError.created_at).toLocaleString()}
                  </p>
                </div>

                {selectedError.message && (
                  <div>
                    <p className="text-sm font-medium mb-1">{t('errors.detail.message')}</p>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{selectedError.message}</p>
                  </div>
                )}

                {selectedError.stack_trace && (
                  <div>
                    <p className="text-sm font-medium mb-1">{t('errors.detail.stackTrace')}</p>
                    <pre className="text-xs bg-muted p-3 rounded-md overflow-x-auto max-h-60 whitespace-pre-wrap">
                      {selectedError.stack_trace}
                    </pre>
                  </div>
                )}

                {selectedError.metadata && (
                  <div>
                    <p className="text-sm font-medium mb-1">{t('errors.detail.metadata')}</p>
                    <pre className="text-xs bg-muted p-3 rounded-md overflow-x-auto max-h-40">
                      {JSON.stringify(selectedError.metadata, null, 2)}
                    </pre>
                  </div>
                )}

                {selectedError.resolved_at && (
                  <p className="text-sm text-muted-foreground">
                    {t('errors.detail.resolvedAt')}: {new Date(selectedError.resolved_at).toLocaleString()}
                  </p>
                )}

                <div className="flex gap-2 pt-2">
                  {selectedError.status === 'open' && (
                    <Button
                      variant="outline"
                      onClick={() => acknowledgeMutation.mutate(selectedError.id)}
                      disabled={acknowledgeMutation.isPending}
                    >
                      {t('errors.detail.acknowledge')}
                    </Button>
                  )}
                  {selectedError.status !== 'resolved' && (
                    <Button
                      onClick={() => resolveMutation.mutate(selectedError.id)}
                      disabled={resolveMutation.isPending}
                    >
                      {t('errors.detail.resolve')}
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </PageWrapper>
  );
}
