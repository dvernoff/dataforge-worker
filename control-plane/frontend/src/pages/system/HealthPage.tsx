import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Activity, Database, Server, Cpu, HardDrive, Clock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { healthApi } from '@/api/health.api';
import { usePageTitle } from '@/hooks/usePageTitle';

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function HealthPage() {
  const { t } = useTranslation('system');
  usePageTitle(t('health.title'));

  const { data, isLoading } = useQuery({
    queryKey: ['health-detailed'],
    queryFn: () => healthApi.getDetailed(),
    refetchInterval: 30_000,
  });

  const cp = data?.controlPlane;
  const workers = data?.workers ?? [];
  const cpStatus = (cp?.status as string) ?? 'unknown';
  const cpDb = cp?.database as Record<string, unknown> | undefined;
  const cpRedis = cp?.redis as Record<string, unknown> | undefined;
  const cpMemory = cp?.memory as Record<string, unknown> | undefined;

  return (
    <PageWrapper>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('health.title')}</h1>
        <Badge variant="outline" className="text-xs">
          {t('health.autoRefresh')}
        </Badge>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </div>
        </div>
      ) : (
        <>
          {/* Overview Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <Card>
              <CardContent>
                <div className="flex items-center gap-3">
                  <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${cpStatus === 'healthy' ? 'bg-green-100 dark:bg-green-900/30' : 'bg-red-100 dark:bg-red-900/30'}`}>
                    <Activity className={`h-5 w-5 ${cpStatus === 'healthy' ? 'text-green-600' : 'text-red-600'}`} />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t('health.cpStatus')}</p>
                    <p className="text-lg font-semibold">
                      <Badge variant={cpStatus === 'healthy' ? 'default' : 'destructive'}>
                        {cpStatus === 'healthy' ? t('health.healthy') : t('health.degraded')}
                      </Badge>
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent>
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                    <Server className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t('health.workerCount')}</p>
                    <p className="text-lg font-semibold">{workers.length}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent>
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                    <Database className="h-5 w-5 text-purple-600" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t('health.totalProjects')}</p>
                    <p className="text-lg font-semibold">{data?.totalProjects ?? 0}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Tabs defaultValue="overview" className="space-y-4">
            <TabsList>
              <TabsTrigger value="overview">{t('health.tabs.overview')}</TabsTrigger>
              <TabsTrigger value="postgresql">{t('health.tabs.postgresql')}</TabsTrigger>
              <TabsTrigger value="redis">{t('health.tabs.redis')}</TabsTrigger>
              <TabsTrigger value="nodejs">{t('health.tabs.nodejs')}</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4">
              {/* Control Plane Details */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t('health.controlPlane')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">{t('health.uptime')}</p>
                      <p className="font-medium">{formatUptime(cp?.uptime as number ?? 0)}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">{t('health.hostname')}</p>
                      <p className="font-medium font-mono text-sm">{cp?.hostname as string ?? '-'}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">{t('health.ramUsage')}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <Progress value={cp?.ram_usage as number ?? 0} className="h-2 flex-1" />
                        <span className="text-xs text-muted-foreground">{cp?.ram_usage as number ?? 0}%</span>
                      </div>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">{t('health.heapUsed')}</p>
                      <p className="font-medium">{cpMemory?.heap_used_mb as number ?? 0} MB</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Worker Nodes */}
              {workers.map((worker) => {
                const wh = worker.health;
                const whMem = wh?.memory as Record<string, unknown> | undefined;
                return (
                  <Card key={worker.nodeId}>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base flex items-center gap-2">
                          <Server className="h-4 w-4" />
                          {worker.nodeName}
                        </CardTitle>
                        <Badge variant={worker.health ? 'default' : 'destructive'}>
                          {worker.health ? t('health.healthy') : t('health.unreachable')}
                        </Badge>
                      </div>
                    </CardHeader>
                    {worker.health && (
                      <CardContent>
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                          <div>
                            <p className="text-sm text-muted-foreground flex items-center gap-1">
                              <Cpu className="h-3 w-3" /> {t('health.cpu')}
                            </p>
                            <div className="flex items-center gap-2 mt-1">
                              <Progress value={wh?.cpu_usage as number ?? 0} className="h-2 flex-1" />
                              <span className="text-xs text-muted-foreground">{wh?.cpu_usage as number ?? 0}%</span>
                            </div>
                          </div>
                          <div>
                            <p className="text-sm text-muted-foreground flex items-center gap-1">
                              <HardDrive className="h-3 w-3" /> {t('health.ram')}
                            </p>
                            <div className="flex items-center gap-2 mt-1">
                              <Progress value={wh?.ram_usage as number ?? 0} className="h-2 flex-1" />
                              <span className="text-xs text-muted-foreground">{wh?.ram_usage as number ?? 0}%</span>
                            </div>
                          </div>
                          <div>
                            <p className="text-sm text-muted-foreground flex items-center gap-1">
                              <HardDrive className="h-3 w-3" /> {t('health.disk')}
                            </p>
                            <div className="flex items-center gap-2 mt-1">
                              <Progress value={wh?.disk_usage as number ?? 0} className="h-2 flex-1" />
                              <span className="text-xs text-muted-foreground">{wh?.disk_usage as number ?? 0}%</span>
                            </div>
                            {(wh?.disk_total_gb as number ?? 0) > 0 && (
                              <p className="text-[10px] text-muted-foreground mt-0.5">
                                {t('health.diskFree', { free: wh?.disk_free_gb, total: wh?.disk_total_gb })}
                              </p>
                            )}
                          </div>
                          <div>
                            <p className="text-sm text-muted-foreground flex items-center gap-1">
                              <Clock className="h-3 w-3" /> {t('health.uptime')}
                            </p>
                            <p className="font-medium">{formatUptime(wh?.uptime as number ?? 0)}</p>
                          </div>
                        </div>
                        {whMem && (
                          <div className="mt-3 grid grid-cols-2 gap-4">
                            <div>
                              <p className="text-sm text-muted-foreground">{t('health.heapUsed')}</p>
                              <p className="font-medium">{whMem?.heap_used as number ?? 0} MB</p>
                            </div>
                            <div>
                              <p className="text-sm text-muted-foreground">{t('health.rss')}</p>
                              <p className="font-medium">{whMem?.rss as number ?? 0} MB</p>
                            </div>
                          </div>
                        )}
                      </CardContent>
                    )}
                    {worker.error && (
                      <CardContent>
                        <p className="text-sm text-destructive">{worker.error}</p>
                      </CardContent>
                    )}
                  </Card>
                );
              })}
            </TabsContent>

            <TabsContent value="postgresql">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t('health.tabs.postgresql')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">{t('health.dbStatus')}</p>
                      <Badge variant={cpDb?.connected ? 'default' : 'destructive'} className="mt-1">
                        {cpDb?.connected ? t('health.connected') : t('health.disconnected')}
                      </Badge>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">{t('health.latency')}</p>
                      <p className="font-medium">{cpDb?.latency_ms as number ?? 0} ms</p>
                    </div>
                  </div>
                  {workers.length > 0 && (
                    <div className="mt-6">
                      <h4 className="text-sm font-medium mb-3">{t('health.workerDbStatus')}</h4>
                      <div className="space-y-2">
                        {workers.map((w) => (
                          <div key={w.nodeId} className="flex items-center justify-between py-2 border-b last:border-0">
                            <span className="text-sm">{w.nodeName}</span>
                            <Badge variant={w.health?.database === 'connected' ? 'default' : 'destructive'}>
                              {(w.health?.database as string) ?? t('health.unreachable')}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="redis">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t('health.tabs.redis')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">{t('health.redisStatus')}</p>
                      <Badge variant={cpRedis?.connected ? 'default' : 'destructive'} className="mt-1">
                        {cpRedis?.connected ? t('health.connected') : t('health.disconnected')}
                      </Badge>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">{t('health.latency')}</p>
                      <p className="font-medium">{cpRedis?.latency_ms as number ?? 0} ms</p>
                    </div>
                  </div>
                  {workers.length > 0 && (
                    <div className="mt-6">
                      <h4 className="text-sm font-medium mb-3">{t('health.workerRedisStatus')}</h4>
                      <div className="space-y-2">
                        {workers.map((w) => (
                          <div key={w.nodeId} className="flex items-center justify-between py-2 border-b last:border-0">
                            <span className="text-sm">{w.nodeName}</span>
                            <Badge variant={w.health?.redis === 'connected' ? 'default' : 'destructive'}>
                              {(w.health?.redis as string) ?? t('health.unreachable')}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="nodejs">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t('health.tabs.nodejs')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">{t('health.nodeVersion')}</p>
                      <p className="font-medium font-mono text-sm">{cp?.node_version as string ?? '-'}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">{t('health.platform')}</p>
                      <p className="font-medium">{cp?.platform as string ?? '-'}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">{t('health.uptime')}</p>
                      <p className="font-medium">{formatUptime(cp?.uptime as number ?? 0)}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">{t('health.heapUsed')}</p>
                      <p className="font-medium">{cpMemory?.heap_used_mb as number ?? 0} / {cpMemory?.heap_total_mb as number ?? 0} MB</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">{t('health.rss')}</p>
                      <p className="font-medium">{cpMemory?.rss_mb as number ?? 0} MB</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">{t('health.ramUsage')}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <Progress value={cp?.ram_usage as number ?? 0} className="h-2 flex-1" />
                        <span className="text-xs text-muted-foreground">{cp?.ram_usage as number ?? 0}%</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}
    </PageWrapper>
  );
}
