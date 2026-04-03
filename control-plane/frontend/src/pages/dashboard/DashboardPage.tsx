import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Table2, Database, Plug, Webhook, Activity, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { staggerContainer, staggerItem } from '@/lib/animations';
import { useCurrentProject } from '@/hooks/useProject';
import { schemaApi } from '@/api/schema.api';
import { endpointsApi } from '@/api/endpoints.api';
import { webhooksApi } from '@/api/webhooks.api';
import { auditApi } from '@/api/audit.api';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { usePageTitle } from '@/hooks/usePageTitle';

const apiChartData = Array.from({ length: 7 }, (_, i) => {
  const d = new Date();
  d.setDate(d.getDate() - (6 - i));
  return {
    day: d.toLocaleDateString('en', { weekday: 'short' }),
    requests: Math.floor(Math.random() * 100 + 20),
  };
});

const cacheChartData = [
  { name: 'Hit', value: 12450, fill: 'hsl(142, 71%, 45%)' },
  { name: 'Miss', value: 1810, fill: 'hsl(0, 0%, 14.9%)' },
];

export function DashboardPage() {
  const { t } = useTranslation('dashboard');
  usePageTitle(t('title'));
  const { data: project } = useCurrentProject();
  const { data: tablesData } = useQuery({
    queryKey: ['tables', project?.id],
    queryFn: () => schemaApi.listTables(project!.id),
    enabled: !!project?.id,
  });

  const { data: endpointsData } = useQuery({
    queryKey: ['endpoints', project?.id],
    queryFn: () => endpointsApi.list(project!.id),
    enabled: !!project?.id,
  });

  const { data: webhooksData } = useQuery({
    queryKey: ['webhooks', project?.id],
    queryFn: () => webhooksApi.list(project!.id),
    enabled: !!project?.id,
  });

  const { data: auditData } = useQuery({
    queryKey: ['audit-recent', project?.id],
    queryFn: () => auditApi.getByProject(project!.id, { limit: '10' }),
    enabled: !!project?.id,
  });

  const tables = tablesData?.tables ?? [];
  const endpoints = endpointsData?.endpoints ?? [];
  const webhooks = webhooksData?.webhooks ?? [];
  const recentLogs = auditData?.data ?? [];
  const totalRecords = tables.reduce((sum, t) => sum + t.row_count, 0);
  const activeEndpoints = endpoints.filter((e) => e.is_active).length;

  const metrics = [
    {
      label: t('metrics.tables'),
      value: tables.length,
      icon: Table2,
      sub: tables.length > 0 ? t('metrics.tablesTotal', { count: tables.length }) : t('metrics.noTables'),
    },
    {
      label: t('metrics.records'),
      value: totalRecords.toLocaleString(),
      icon: Database,
      sub: t('metrics.acrossTables', { count: tables.length }),
    },
    {
      label: t('metrics.endpoints'),
      value: endpoints.length,
      icon: Plug,
      sub: t('metrics.active', { count: activeEndpoints }),
    },
    {
      label: t('metrics.webhooks'),
      value: webhooks.length,
      icon: Webhook,
      sub: t('metrics.active', { count: webhooks.filter((w: Record<string, unknown>) => w.is_active).length }),
    },
  ];

  return (
    <PageWrapper>
      <h1 className="text-2xl font-bold mb-6">{t('title')}</h1>

      <motion.div
        variants={staggerContainer}
        initial="initial"
        animate="animate"
        className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4"
      >
        {metrics.map((metric) => (
          <motion.div key={metric.label} variants={staggerItem}>
            <Card className="hover:border-primary/50 transition-colors">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {metric.label}
                </CardTitle>
                <metric.icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{metric.value}</div>
                <p className="text-xs text-muted-foreground mt-1">{metric.sub}</p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="h-4 w-4" />
              {t('charts.apiRequests')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {apiChartData.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-16">{t('noDataYet')}</p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={apiChartData}>
                  <defs>
                    <linearGradient id="colorReq" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(142, 71%, 45%)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(142, 71%, 45%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(0, 0%, 14.9%)" />
                  <XAxis dataKey="day" tick={{ fill: 'hsl(0, 0%, 63.9%)', fontSize: 12 }} />
                  <YAxis tick={{ fill: 'hsl(0, 0%, 63.9%)', fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'hsl(0, 0%, 5.5%)', border: '1px solid hsl(0, 0%, 14.9%)', borderRadius: '0.5rem' }}
                    labelStyle={{ color: 'hsl(0, 0%, 98%)' }}
                    itemStyle={{ color: 'hsl(142, 71%, 45%)' }}
                  />
                  <Area type="monotone" dataKey="requests" stroke="hsl(142, 71%, 45%)" fillOpacity={1} fill="url(#colorReq)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t('charts.cacheRatio')}</CardTitle>
          </CardHeader>
          <CardContent>
            {cacheChartData.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-16">{t('noDataYet')}</p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={cacheChartData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(0, 0%, 14.9%)" />
                  <XAxis type="number" tick={{ fill: 'hsl(0, 0%, 63.9%)', fontSize: 12 }} />
                  <YAxis dataKey="name" type="category" tick={{ fill: 'hsl(0, 0%, 63.9%)', fontSize: 12 }} width={40} />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'hsl(0, 0%, 5.5%)', border: '1px solid hsl(0, 0%, 14.9%)', borderRadius: '0.5rem' }}
                    labelStyle={{ color: 'hsl(0, 0%, 98%)' }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const total = cacheChartData.reduce((sum, d) => sum + d.value, 0);
                      return (
                        <div className="rounded-lg border border-[hsl(0,0%,14.9%)] bg-[hsl(0,0%,5.5%)] px-3 py-2 text-sm">
                          {payload.map((entry) => {
                            const name = String(entry.payload?.name ?? '');
                            const value = Number(entry.value ?? 0);
                            const pct = total > 0 ? ((value / total) * 100).toFixed(1) : '0';
                            const isHit = name === 'Hit';
                            const label = isHit
                              ? t('cacheHit', { count: value.toLocaleString(), percentage: pct })
                              : t('cacheMiss', { count: value.toLocaleString(), percentage: pct });
                            return (
                              <div key={name} style={{ color: isHit ? 'hsl(142, 71%, 45%)' : 'hsl(0, 0%, 63.9%)' }}>
                                {label}
                              </div>
                            );
                          })}
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="h-4 w-4" />
              {t('recentActivity')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentLogs.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">{t('noActivity')}</p>
            ) : (
              <div className="space-y-3">
                {(recentLogs as Record<string, unknown>[]).slice(0, 8).map((log) => (
                  <div key={String(log.id)} className="flex items-center gap-3 text-sm">
                    <Avatar className="h-6 w-6">
                      <AvatarFallback className="text-[10px]">
                        {String(log.user_email ?? '?').charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <Badge variant="outline" className="text-[10px] shrink-0">{String(log.action)}</Badge>
                    <span className="text-muted-foreground truncate flex-1">
                      {log.resource_type ? `${log.resource_type}` : ''}
                    </span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {new Date(String(log.created_at)).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Webhook className="h-4 w-4" />
              {t('activeWebhooks')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {webhooks.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">{t('noWebhooks')}</p>
            ) : (
              <div className="space-y-3">
                {(webhooks as Record<string, unknown>[]).slice(0, 5).map((wh) => (
                  <div key={String(wh.id)} className="flex items-center gap-3 text-sm">
                    <div className={`h-2 w-2 rounded-full ${wh.is_active ? 'bg-green-500' : 'bg-muted-foreground'}`} />
                    <span className="font-mono">{String(wh.table_name)}</span>
                    <div className="flex gap-1">
                      {(wh.events as string[]).map((e) => (
                        <Badge key={e} variant="outline" className="text-[10px]">{e}</Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

    </PageWrapper>
  );
}
