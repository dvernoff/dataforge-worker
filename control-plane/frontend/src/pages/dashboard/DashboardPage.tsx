import { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Table2, Database, Plug, Zap, Activity, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { staggerContainer, staggerItem } from '@/lib/animations';
import { useCurrentProject } from '@/hooks/useProject';
import { schemaApi } from '@/api/schema.api';
import { endpointsApi } from '@/api/endpoints.api';
import { analyticsApi } from '@/api/analytics.api';
import { auditApi } from '@/api/audit.api';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { usePageTitle } from '@/hooks/usePageTitle';

const STATUS_COLORS: Record<string, string> = {
  '2xx': 'hsl(142, 71%, 45%)',
  '3xx': 'hsl(217, 91%, 60%)',
  '4xx': 'hsl(38, 92%, 50%)',
  '5xx': 'hsl(0, 84%, 60%)',
};

function statusColor(code: number): string {
  if (code < 300) return 'text-green-500';
  if (code < 400) return 'text-blue-500';
  if (code < 500) return 'text-amber-500';
  return 'text-red-500';
}

function methodBadgeVariant(method: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (method) {
    case 'GET': return 'secondary';
    case 'POST': return 'default';
    case 'DELETE': return 'destructive';
    default: return 'outline';
  }
}

const FAKE_CALLS = [
  { method: 'GET', path: '/api/v1/app/users', status: 200, ms: 12 },
  { method: 'POST', path: '/api/v1/app/users', status: 201, ms: 45 },
  { method: 'GET', path: '/api/v1/app/users/1', status: 200, ms: 8 },
  { method: 'PUT', path: '/api/v1/app/users/1', status: 200, ms: 34 },
  { method: 'GET', path: '/api/v1/app/products', status: 200, ms: 18 },
  { method: 'POST', path: '/api/v1/app/orders', status: 201, ms: 67 },
  { method: 'GET', path: '/api/v1/app/orders', status: 200, ms: 22 },
  { method: 'DELETE', path: '/api/v1/app/users/3', status: 204, ms: 15 },
  { method: 'GET', path: '/api/v1/app/products/5', status: 404, ms: 6 },
  { method: 'POST', path: '/api/v1/app/auth/login', status: 200, ms: 89 },
  { method: 'GET', path: '/api/v1/app/analytics', status: 200, ms: 31 },
  { method: 'PUT', path: '/api/v1/app/products/2', status: 200, ms: 41 },
];

const VISIBLE_COUNT = 10;

function FakeApiCallsList() {
  const ROW_H = 32;
  const totalSlots = VISIBLE_COUNT + 1;
  const counterRef = useRef(0);

  const [items, setItems] = useState(() =>
    Array.from({ length: totalSlots }, (_, i) => ({
      ...FAKE_CALLS[i % FAKE_CALLS.length],
      uid: i,
    }))
  );
  const [sliding, setSliding] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setSliding(true);

      setTimeout(() => {
        setSliding(false);
        counterRef.current += 1;
        const nextUid = totalSlots + counterRef.current;
        const nextCall = FAKE_CALLS[nextUid % FAKE_CALLS.length];
        setItems((prev) => [
          { ...nextCall, uid: nextUid },
          ...prev.slice(0, totalSlots - 1),
        ]);
      }, 600);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="overflow-hidden" style={{ height: VISIBLE_COUNT * ROW_H }}>
      <div
        style={{
          transform: sliding ? `translateY(0px)` : `translateY(-${ROW_H}px)`,
          transition: sliding ? 'transform 0.5s cubic-bezier(0.4, 0, 0.2, 1)' : 'none',
        }}
      >
        {items.map((call, i) => {
          const isBottom = i === items.length - 1;
          return (
            <div
              key={call.uid}
              className="flex items-center gap-2 text-sm"
              style={{
                height: ROW_H,
                opacity: sliding && isBottom ? 0 : 1,
                transition: sliding ? 'opacity 0.4s ease' : 'none',
              }}
            >
              <Badge variant={methodBadgeVariant(call.method)} className="text-[10px] shrink-0 w-12 justify-center">
                {call.method}
              </Badge>
              <Skeleton className="h-3.5 flex-1 rounded" />
              <span className={`text-xs font-medium shrink-0 ${statusColor(call.status)}`}>{call.status}</span>
              <span className="text-xs text-muted-foreground shrink-0 w-10 text-right">{call.ms}ms</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DashboardPage() {
  const { t, i18n } = useTranslation('dashboard');
  const locale = i18n.language ?? 'en';
  usePageTitle(t('title'));
  const { data: project } = useCurrentProject();
  const [rightChartMode, setRightChartMode] = useState<'status' | 'cache'>('status');

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

  const { data: summaryData } = useQuery({
    queryKey: ['analytics-summary', project?.id],
    queryFn: () => analyticsApi.getSummary(project!.id),
    enabled: !!project?.id,
    refetchInterval: 15_000,
  });

  const { data: dailyData } = useQuery({
    queryKey: ['analytics-daily', project?.id],
    queryFn: () => analyticsApi.getDailyStats(project!.id, 7),
    enabled: !!project?.id,
    refetchInterval: 30_000,
  });

  const { data: statusData } = useQuery({
    queryKey: ['analytics-status', project?.id],
    queryFn: () => analyticsApi.getStatusBreakdown(project!.id, 7),
    enabled: !!project?.id,
    refetchInterval: 30_000,
  });

  const { data: cacheData } = useQuery({
    queryKey: ['analytics-cache', project?.id],
    queryFn: () => analyticsApi.getCacheStats(project!.id, 7),
    enabled: !!project?.id,
    refetchInterval: 30_000,
  });

  const { data: recentRequestsData } = useQuery({
    queryKey: ['analytics-recent', project?.id],
    queryFn: () => analyticsApi.getRequests(project!.id, { limit: String(VISIBLE_COUNT) }),
    enabled: !!project?.id,
    refetchInterval: 10_000,
  });

  const { data: auditData } = useQuery({
    queryKey: ['audit-recent', project?.id],
    queryFn: () => auditApi.getByProject(project!.id, { limit: '10' }),
    enabled: !!project?.id,
  });

  const tables = tablesData?.tables ?? [];
  const endpoints = endpointsData?.endpoints ?? [];
  const recentLogs = auditData?.data ?? [];
  const recentRequests = recentRequestsData?.requests ?? [];
  const totalRecords = tables.reduce((sum, t) => sum + t.row_count, 0);
  const activeEndpoints = endpoints.filter((e) => e.is_active).length;
  const summary = summaryData ?? { totalRequests: 0, avgResponseTime: 0, errorRate: 0, topEndpoint: null };

  const realChartData = (dailyData?.stats ?? []).map((s) => ({
    day: new Date(s.day).toLocaleDateString(locale, { weekday: 'short' }),
    requests: s.total,
    errors: s.errors,
  }));
  const hasRealChartData = realChartData.some((d) => d.requests > 0);

  const placeholderChartData = useMemo(() =>
    Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      return {
        day: d.toLocaleDateString(locale, { weekday: 'short' }),
        requests: Math.floor(Math.random() * 80 + 20),
        errors: Math.floor(Math.random() * 5),
      };
    }),
  [locale]);

  const chartData = hasRealChartData ? realChartData : placeholderChartData;
  const isChartPlaceholder = !hasRealChartData;

  const statusBreakdown = statusData ?? { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 };
  const hasRealStatusData = Object.values(statusBreakdown).some((v) => v > 0);

  const placeholderStatus = { '2xx': 842, '3xx': 38, '4xx': 17, '5xx': 3 };
  const activeStatus = hasRealStatusData ? statusBreakdown : placeholderStatus;
  const isStatusPlaceholder = !hasRealStatusData;

  const statusChartData = Object.entries(activeStatus)
    .map(([name, value]) => ({
      name,
      value,
      fill: STATUS_COLORS[name] ?? 'hsl(0, 0%, 50%)',
    }));

  const realCache = cacheData ?? { Hit: 0, Miss: 0 };
  const hasRealCacheData = realCache.Hit > 0 || realCache.Miss > 0;
  const placeholderCache = { Hit: 12450, Miss: 1810 };
  const activeCache = hasRealCacheData ? realCache : placeholderCache;
  const isCachePlaceholder = !hasRealCacheData;
  const cacheChartData = [
    { name: 'Hit', value: activeCache.Hit, fill: 'hsl(142, 71%, 45%)' },
    { name: 'Miss', value: activeCache.Miss, fill: 'hsl(0, 0%, 45%)' },
  ];

  const isRightPlaceholder = rightChartMode === 'status' ? isStatusPlaceholder : isCachePlaceholder;
  const rightData = rightChartMode === 'status' ? statusChartData : cacheChartData;

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
      label: t('metrics.apiToday'),
      value: summary.totalRequests.toLocaleString(),
      icon: Zap,
      sub: summary.avgResponseTime > 0
        ? t('metrics.avgResponse', { ms: summary.avgResponseTime })
        : t('metrics.noRequests'),
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
          <CardContent className="relative flex flex-col">
            <ResponsiveContainer width="100%" height={210}>
              <AreaChart data={chartData} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorReq" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(142, 71%, 45%)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(142, 71%, 45%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(0, 0%, 14.9%)" />
                <XAxis dataKey="day" tick={{ fill: 'hsl(0, 0%, 63.9%)', fontSize: 12 }} />
                <YAxis tick={{ fill: 'hsl(0, 0%, 63.9%)', fontSize: 12 }} width={40} />
                <Tooltip
                  contentStyle={{ backgroundColor: 'hsl(0, 0%, 5.5%)', border: '1px solid hsl(0, 0%, 14.9%)', borderRadius: '0.5rem' }}
                  labelStyle={{ color: 'hsl(0, 0%, 98%)' }}
                  itemStyle={{ color: 'hsl(142, 71%, 45%)' }}
                />
                <Area type="monotone" dataKey="requests" stroke="hsl(142, 71%, 45%)" fillOpacity={1} fill="url(#colorReq)" name={t('charts.requests')} />
              </AreaChart>
            </ResponsiveContainer>
            {isChartPlaceholder && (
              <p className="text-[10px] text-muted-foreground/20 text-center mt-auto pt-2">{t('placeholderHint')}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm">
              {rightChartMode === 'status' ? t('charts.statusBreakdown') : t('charts.cacheRatio')}
            </CardTitle>
            <div className="flex gap-1 rounded-md border p-0.5">
              <Button
                variant={rightChartMode === 'status' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-6 px-2.5 text-[11px]"
                onClick={() => setRightChartMode('status')}
              >
                {t('charts.statusBtn')}
              </Button>
              <Button
                variant={rightChartMode === 'cache' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-6 px-2.5 text-[11px]"
                onClick={() => setRightChartMode('cache')}
              >
                {t('charts.cacheBtn')}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="relative flex flex-col">
            <ResponsiveContainer width="100%" height={210}>
              <BarChart data={rightData} layout="vertical" margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(0, 0%, 14.9%)" />
                <XAxis type="number" tick={{ fill: 'hsl(0, 0%, 63.9%)', fontSize: 12 }} />
                <YAxis dataKey="name" type="category" tick={{ fill: 'hsl(0, 0%, 63.9%)', fontSize: 12 }} width={40} />
                <Tooltip
                  contentStyle={{ backgroundColor: 'hsl(0, 0%, 5.5%)', border: '1px solid hsl(0, 0%, 14.9%)', borderRadius: '0.5rem' }}
                  labelStyle={{ color: 'hsl(0, 0%, 98%)' }}
                  formatter={(value: number, _name: string, entry: { payload?: { fill?: string } }) => {
                    const total = rightData.reduce((sum, d) => sum + d.value, 0);
                    const pct = total > 0 ? ((value / total) * 100).toFixed(1) : '0';
                    const color = entry.payload?.fill ?? 'hsl(0, 0%, 98%)';
                    return [<span style={{ color }}>{value.toLocaleString()} ({pct}%)</span>];
                  }}
                />
                <Bar dataKey="value" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
            {isRightPlaceholder && (
              <p className="text-[10px] text-muted-foreground/20 text-center mt-auto pt-2">{t('placeholderHint')}</p>
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
                {(recentLogs as Record<string, unknown>[]).slice(0, 8).map((log) => {
                  const action = String(log.action ?? '');
                  const parts = action.split('.');
                  const resource = parts[0] ?? '';
                  const verb = parts[1] ?? parts[0];

                  const verbLabel = t(`activity.verbs.${verb}`, { defaultValue: verb });
                  const resourceLabel = t(`activity.resources.${resource}`, { defaultValue: resource });
                  const description = `${verbLabel} ${resourceLabel}`;

                  return (
                    <div key={String(log.id)} className="flex items-center gap-3 text-sm">
                      <Avatar className="h-6 w-6">
                        <AvatarFallback className="text-[10px]">
                          {String(log.user_email ?? '?').charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <Badge variant="outline" className="text-[10px] shrink-0">{action}</Badge>
                      <span className="text-muted-foreground text-xs truncate flex-1">
                        {description}
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {new Date(String(log.created_at)).toLocaleTimeString()}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Zap className="h-4 w-4" />
              {t('recentApiCalls')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentRequests.length === 0 ? (
              <FakeApiCallsList />
            ) : (
              <div className="overflow-hidden" style={{ minHeight: VISIBLE_COUNT * 32 }}>
                <AnimatePresence initial={false}>
                  {recentRequests.slice(0, VISIBLE_COUNT).map((req) => (
                    <motion.div
                      key={req.id}
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 32 }}
                      transition={{ duration: 0.3 }}
                      className="flex items-center gap-2 text-sm"
                    >
                      <Badge variant={methodBadgeVariant(req.method)} className="text-[10px] shrink-0 w-12 justify-center">
                        {req.method}
                      </Badge>
                      <span className="font-mono text-xs truncate flex-1">{req.path}</span>
                      <span className={`text-xs font-medium shrink-0 ${statusColor(req.status_code)}`}>
                        {req.status_code}
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0 w-12 text-right">
                        {req.response_time_ms}ms
                      </span>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

    </PageWrapper>
  );
}
