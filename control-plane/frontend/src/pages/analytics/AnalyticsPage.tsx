import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { BarChart3, Clock, AlertCircle, Globe } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { analyticsApi } from '@/api/analytics.api';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useCurrentProject } from '@/hooks/useProject';

function statusBadgeVariant(code: number): 'default' | 'destructive' | 'outline' {
  if (code < 300) return 'default';
  if (code < 400) return 'outline';
  return 'destructive';
}

export function AnalyticsPage() {
  const { t } = useTranslation('analytics');
  usePageTitle(t('title'));
  const { data: project } = useCurrentProject();
  const projectId = project?.id;
  const [requestPage, setRequestPage] = useState(1);

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['analytics-summary', projectId],
    queryFn: () => analyticsApi.getSummary(projectId!),
    enabled: !!projectId,
    refetchInterval: 30_000,
  });

  const { data: topEndpoints, isLoading: topLoading } = useQuery({
    queryKey: ['analytics-top-endpoints', projectId],
    queryFn: () => analyticsApi.getTopEndpoints(projectId!),
    enabled: !!projectId,
  });

  const { data: slowQueries } = useQuery({
    queryKey: ['analytics-slow-queries', projectId],
    queryFn: () => analyticsApi.getSlowQueries(projectId!),
    enabled: !!projectId,
  });

  const { data: requestsData, isLoading: requestsLoading } = useQuery({
    queryKey: ['analytics-requests', projectId, requestPage],
    queryFn: () => analyticsApi.getRequests(projectId!, { page: String(requestPage), limit: '20' }),
    enabled: !!projectId,
  });

  return (
    <PageWrapper>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
      </div>

      {summaryLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardContent>
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                  <BarChart3 className="h-5 w-5 text-blue-500" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t('totalRequests')}</p>
                  <p className="text-2xl font-bold">{(summary?.totalRequests ?? 0).toLocaleString()}</p>
                  <p className="text-[11px] text-muted-foreground">{t('last7days')}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                  <Clock className="h-5 w-5 text-green-500" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t('avgResponseTime')}</p>
                  <p className="text-2xl font-bold">{t('ms', { value: summary?.avgResponseTime ?? 0 })}</p>
                  <p className="text-[11px] text-muted-foreground">{t('last7days')}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-red-500/10 flex items-center justify-center">
                  <AlertCircle className="h-5 w-5 text-red-500" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t('errorRate')}</p>
                  <p className="text-2xl font-bold">{t('percent', { value: summary?.errorRate ?? 0 })}</p>
                  <p className="text-[11px] text-muted-foreground">{t('last7days')}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
                  <Globe className="h-5 w-5 text-purple-500" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t('uniqueIps')}</p>
                  <p className="text-2xl font-bold">{(summary?.uniqueIps ?? 0).toLocaleString()}</p>
                  <p className="text-[11px] text-muted-foreground">{t('last7days')}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Top Endpoints */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">{t('topEndpoints')}</CardTitle>
        </CardHeader>
        <CardContent>
          {topLoading ? (
            <Skeleton className="h-32" />
          ) : (topEndpoints?.endpoints?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">{t('noData')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('headers.method')}</TableHead>
                  <TableHead>{t('headers.path')}</TableHead>
                  <TableHead>{t('headers.requests')}</TableHead>
                  <TableHead>{t('headers.avgTime')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topEndpoints!.endpoints.map((ep, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Badge variant="outline">{ep.method}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-sm">{ep.path}</TableCell>
                    <TableCell>{ep.requestCount}</TableCell>
                    <TableCell>{t('ms', { value: ep.avgResponseTime })}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Slow Queries */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">{t('slowQueries')}</CardTitle>
        </CardHeader>
        <CardContent>
          {(slowQueries?.requests?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">{t('noData')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('headers.method')}</TableHead>
                  <TableHead>{t('headers.path')}</TableHead>
                  <TableHead>{t('headers.statusCode')}</TableHead>
                  <TableHead>{t('headers.responseTime')}</TableHead>
                  <TableHead>{t('headers.time')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {slowQueries!.requests.slice(0, 10).map((req) => (
                  <TableRow key={req.id}>
                    <TableCell>
                      <Badge variant="outline">{req.method}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-sm max-w-[300px] truncate">{req.path}</TableCell>
                    <TableCell>
                      <Badge variant={statusBadgeVariant(req.status_code)}>{req.status_code}</Badge>
                    </TableCell>
                    <TableCell>{t('ms', { value: req.response_time_ms })}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(req.created_at).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Full Request Log */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('requestLog')}</CardTitle>
        </CardHeader>
        <CardContent>
          {requestsLoading ? (
            <Skeleton className="h-32" />
          ) : (requestsData?.requests?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">{t('noData')}</p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('headers.method')}</TableHead>
                    <TableHead>{t('headers.path')}</TableHead>
                    <TableHead>{t('headers.statusCode')}</TableHead>
                    <TableHead>{t('headers.responseTime')}</TableHead>
                    <TableHead>{t('headers.ip')}</TableHead>
                    <TableHead>{t('headers.time')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requestsData!.requests.map((req) => (
                    <TableRow key={req.id}>
                      <TableCell>
                        <Badge variant="outline">{req.method}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-sm max-w-[250px] truncate">{req.path}</TableCell>
                      <TableCell>
                        <Badge variant={statusBadgeVariant(req.status_code)}>{req.status_code}</Badge>
                      </TableCell>
                      <TableCell>{t('ms', { value: req.response_time_ms })}</TableCell>
                      <TableCell className="font-mono text-xs">{req.ip_address}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(req.created_at).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {requestsData && requestsData.total > requestsData.limit && (
                <div className="flex justify-center gap-2 mt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={requestPage <= 1}
                    onClick={() => setRequestPage((p) => p - 1)}
                  >
                    {t('pagination.previous', { ns: 'common' })}
                  </Button>
                  <span className="text-sm text-muted-foreground self-center">
                    {requestPage} / {Math.ceil(requestsData.total / requestsData.limit)}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={requestPage >= Math.ceil(requestsData.total / requestsData.limit)}
                    onClick={() => setRequestPage((p) => p + 1)}
                  >
                    {t('pagination.next', { ns: 'common' })}
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </PageWrapper>
  );
}
