import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles, Cpu, Zap, Database, Plug, Key, Hash, Code, Terminal,
  Copy, Check, ExternalLink, Activity, Lock, ArrowLeft, ArrowRight,
  Info, Loader2, BookOpen, Trash2, Wand2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { useCurrentProject } from '@/hooks/useProject';
import { aiGatewayApi } from '@/api/ai-gateway.api';
import { usePageTitle } from '@/hooks/usePageTitle';
import { staggerContainer, staggerItem } from '@/lib/animations';
import { toast } from 'sonner';

const TOOL_KEYS = [
  'get_project_info', 'get_schema_context', 'create_table', 'alter_columns',
  'drop_table', 'add_index', 'drop_index', 'add_foreign_key', 'drop_foreign_key',
  'create_endpoint', 'update_endpoint', 'delete_endpoint', 'execute_sql',
];

const TOOL_ICONS: Record<string, typeof Database> = {
  get_project_info: BookOpen, get_schema_context: Database, create_table: Database,
  alter_columns: Key, drop_table: Trash2, add_index: Hash, drop_index: Hash,
  add_foreign_key: Key, drop_foreign_key: Key, create_endpoint: Plug,
  update_endpoint: Plug, delete_endpoint: Plug, execute_sql: Terminal,
};

const TOOL_COLORS: Record<string, string> = {
  get_project_info: 'text-pink-400', get_schema_context: 'text-blue-400',
  create_table: 'text-green-400', alter_columns: 'text-amber-400', drop_table: 'text-red-400',
  add_index: 'text-cyan-400', drop_index: 'text-red-400',
  add_foreign_key: 'text-purple-400', drop_foreign_key: 'text-red-400',
  create_endpoint: 'text-green-400', update_endpoint: 'text-amber-400',
  delete_endpoint: 'text-red-400', execute_sql: 'text-blue-400',
};

interface TabDef {
  id: 'rest' | 'mcp' | 'studio';
  icon: typeof Sparkles;
  pluginId: string;
  color: string;
  activeColor: string;
  navigateTo?: string;
}

const TABS: TabDef[] = [
  { id: 'rest', icon: Sparkles, pluginId: 'ai-rest-gateway', color: 'purple', activeColor: 'from-purple-500/20 to-pink-500/20' },
  { id: 'mcp', icon: Cpu, pluginId: 'ai-mcp-server', color: 'blue', activeColor: 'from-blue-500/20 to-cyan-500/20' },
  { id: 'studio', icon: Wand2, pluginId: 'ai-studio', color: 'emerald', activeColor: 'from-emerald-500/20 to-teal-500/20', navigateTo: 'ai/studio' },
];

const ROTATING_KEYS = ['tables', 'endpoints', 'indexes', 'schemas', 'queries', 'foreignKeys', 'caching', 'rateLimits'];

function RotatingText() {
  const { t } = useTranslation(['ai']);
  const words = ROTATING_KEYS.map(k => t(`ai:rotating.${k}`));
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setIndex(i => (i + 1) % words.length), 2000);
    return () => clearInterval(interval);
  }, []);
  return (
    <AnimatePresence mode="wait">
      <motion.span
        key={index}
        initial={{ opacity: 0, width: 0 }}
        animate={{ opacity: 1, width: 'auto' }}
        exit={{ opacity: 0, width: 0 }}
        transition={{ duration: 0.4, ease: 'easeInOut' }}
        className="inline-block overflow-hidden bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent whitespace-nowrap"
      >
        {words[index]}
      </motion.span>
    </AnimatePresence>
  );
}

const BRAIN_WORDS = [
  'SELECT *', 'CREATE TABLE', 'INSERT INTO', 'JOIN', 'WHERE', 'INDEX',
  'uuid', 'bigint', 'jsonb', 'CASCADE', 'PRIMARY KEY', 'FOREIGN KEY',
  'GET /api', 'POST', 'PUT', 'DELETE', 'x-api-key', 'Bearer',
  '200 OK', '{ }', '[ ]', 'async', 'await', 'schema',
  'ALTER', 'DROP', 'GRANT', 'RETURNING', 'LIMIT', 'OFFSET',
  '0x4F2A', '11010011', '$$', 'md5', 'sha256', 'token',
  'cache_ttl: 60', 'rate_limit', 'webhook', 'trigger',
  'neurons', 'gradient', 'embeddings', 'context', 'prompt',
  'function()', '=>', 'import', 'export', 'const',
  'ON DELETE', 'NOT NULL', 'DEFAULT', 'UNIQUE', 'SERIAL',
  'btree', 'hash', 'gin', 'gist', 'EXPLAIN ANALYZE',
];

function AIBrainSphere() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 4000);
    return () => clearInterval(id);
  }, []);

  const items = useMemo(() => {
    const result: { id: number; text: string; xPct: number; yPct: number; driftX: number; driftY: number; size: number; baseOpacity: number; speed: number; delay: number; glow: boolean; fadePhase: number }[] = [];
    for (let i = 0; i < 55; i++) {
      const distFromCenter = Math.random();
      const angle = Math.random() * Math.PI * 2;
      const maxSpread = 48;
      const r = distFromCenter * maxSpread;
      result.push({
        id: i, text: BRAIN_WORDS[i % BRAIN_WORDS.length],
        xPct: 50 + Math.cos(angle) * r, yPct: 50 + Math.sin(angle) * r * 0.7,
        driftX: (Math.random() - 0.5) * 150, driftY: (Math.random() - 0.5) * 100,
        size: 10 + Math.random() * 4, baseOpacity: distFromCenter < 0.3 ? 0.25 + Math.random() * 0.1 : 0.15 + Math.random() * 0.1,
        speed: 18 + Math.random() * 22, delay: Math.random() * 12, glow: distFromCenter < 0.35,
        fadePhase: Math.floor(Math.random() * 8),
      });
    }
    return result;
  }, []);

  const stars = useMemo(() => Array.from({ length: 100 }, (_, i) => ({
    id: i, x: Math.random() * 100, y: Math.random() * 100, size: Math.random() * 2.5 + 0.5,
    duration: Math.random() * 5 + 3, delay: Math.random() * 5,
  })), []);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {stars.map(s => (
        <motion.div key={`s-${s.id}`} className="absolute rounded-full bg-purple-400"
          style={{ left: `${s.x}%`, top: `${s.y}%`, width: s.size, height: s.size }}
          animate={{ opacity: [0.04, 0.25, 0.04] }}
          transition={{ duration: s.duration, repeat: Infinity, delay: s.delay, ease: 'easeInOut' }}
        />
      ))}
      {items.map((item) => {
        const isVisible = (tick + item.fadePhase) % 8 < 6;
        return (
          <motion.span key={item.id} className="absolute font-mono select-none whitespace-nowrap"
            style={{ left: `${item.xPct}%`, top: `${item.yPct}%`, fontSize: item.size,
              color: `rgba(168, 85, 247, ${item.baseOpacity})`,
              textShadow: item.glow ? '0 0 12px rgba(168,85,247,0.25)' : '0 0 4px rgba(168,85,247,0.08)',
            }}
            animate={{
              x: [0, item.driftX, -item.driftX * 0.5, item.driftX * 0.3, 0],
              y: [0, item.driftY, -item.driftY * 0.6, item.driftY * 0.4, 0],
              opacity: isVisible
                ? [item.baseOpacity * 0.5, item.baseOpacity, item.baseOpacity * 1.5, item.baseOpacity, item.baseOpacity * 0.5]
                : [item.baseOpacity * 0.5, 0, 0, 0, item.baseOpacity * 0.5],
            }}
            transition={{ duration: item.speed, repeat: Infinity, delay: item.delay, ease: 'easeInOut' }}
          >
            {item.text}
          </motion.span>
        );
      })}
    </div>
  );
}

export function AIDashboardPage() {
  const { t } = useTranslation(['ai', 'common']);
  usePageTitle(t('ai:pageTitle'));
  const { data: project } = useCurrentProject();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'rest' | 'mcp' | null>(null);
  const [setupDialog, setSetupDialog] = useState(false);
  const [copied, setCopied] = useState(false);

  const { data: status } = useQuery({
    queryKey: ['ai-gateway-status', project?.id],
    queryFn: () => aiGatewayApi.getStatus(project!.id),
    enabled: !!project?.id, refetchInterval: 10000,
  });
  const { data: activity } = useQuery({
    queryKey: ['ai-gateway-activity', project?.id],
    queryFn: () => aiGatewayApi.getActivity(project!.id, 20),
    enabled: !!project?.id && activeTab !== null, refetchInterval: 5000,
  });
  const { data: stats } = useQuery({
    queryKey: ['ai-gateway-stats', project?.id],
    queryFn: () => aiGatewayApi.getStats(project!.id),
    enabled: !!project?.id, refetchInterval: 15000,
  });

  const workerUrl = project?.node_url?.replace(/\/$/, '') ?? window.location.origin;

  function copy(text: string) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success(t('ai:setup.copied'));
    setTimeout(() => setCopied(false), 2000);
  }

  function isPluginEnabled(pluginId: string) {
    if (!status) return false;
    if (pluginId === 'ai-rest-gateway') return status.rest_gateway?.enabled ?? false;
    if (pluginId === 'ai-mcp-server') return status.mcp_server?.enabled ?? false;
    if (pluginId === 'ai-studio') return (status as Record<string, unknown>).ai_studio ? ((status as Record<string, unknown>).ai_studio as { enabled: boolean }).enabled : false;
    return false;
  }

  useEffect(() => {
    if (status && activeTab && !isPluginEnabled(TABS.find(tt => tt.id === activeTab)!.pluginId)) {
      const first = TABS.find(tt => isPluginEnabled(tt.pluginId));
      setActiveTab(first ? first.id : null);
    }
  }, [status]);

  const currentTab = activeTab ? TABS.find(tt => tt.id === activeTab)! : null;
  const baseUrl = `${workerUrl}/api/v1/${project?.slug ?? '{slug}'}/ai`;

  const mcpConfig = JSON.stringify({
    mcpServers: { dataforge: { url: `${workerUrl}/api/v1/${project?.slug ?? '{slug}'}/mcp`, headers: { 'x-api-key': 'YOUR_TOKEN' } } },
  }, null, 2);

  const restPrompt = t('ai:setup.step2restPrompt', { url: baseUrl });

  // ── HOME PAGE ──
  if (activeTab === null) {
    return (
      <PageWrapper>
        <div className="relative min-h-[70vh] flex flex-col items-center justify-center overflow-hidden">
          <div className="absolute inset-0 bg-[linear-gradient(rgba(139,92,246,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(139,92,246,0.03)_1px,transparent_1px)] bg-[size:48px_48px]" />
          <AIBrainSphere />

          <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.5 }} className="relative z-10 text-center mb-12">
            <motion.div animate={{ rotate: [0, 5, -5, 0] }} transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }} className="inline-block mb-6">
              <div className="h-20 w-20 rounded-2xl bg-gradient-to-br from-purple-500/20 via-pink-500/20 to-blue-500/20 border border-purple-500/20 flex items-center justify-center mx-auto">
                <Sparkles className="h-10 w-10 text-purple-400" />
              </div>
            </motion.div>
            <h1 className="text-4xl font-bold mb-3">
              <span className="bg-gradient-to-r from-purple-400 via-pink-400 to-blue-400 bg-clip-text text-transparent">{t('ai:pageTitle')}</span>
            </h1>
            <p className="text-lg text-muted-foreground mb-2 flex items-center justify-center gap-1.5">
              <span>{t('ai:letAiManage')}</span> <RotatingText />
            </p>
            <p className="text-sm text-muted-foreground/60 max-w-md mx-auto">{t('ai:fullDesc')}</p>
          </motion.div>

          <motion.div variants={staggerContainer} initial="initial" animate="animate" className="relative z-10 grid grid-cols-1 md:grid-cols-3 gap-4 max-w-2xl w-full mb-10">
            <motion.div variants={staggerItem}>
              <Card className="border-purple-500/10 text-center"><CardContent className="px-4 py-3">
                <p className="text-3xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">{stats?.total_calls ?? 0}</p>
                <p className="text-[11px] text-muted-foreground mt-1">{t('ai:stats.totalOps')}</p>
              </CardContent></Card>
            </motion.div>
            <motion.div variants={staggerItem}>
              <Card className="border-blue-500/10 text-center"><CardContent className="px-4 py-3">
                <p className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">{stats?.avg_duration_ms ?? 0}<span className="text-sm">ms</span></p>
                <p className="text-[11px] text-muted-foreground mt-1">{t('ai:stats.avgResponseTime')}</p>
              </CardContent></Card>
            </motion.div>
            <motion.div variants={staggerItem}>
              <Card className="border-green-500/10 text-center"><CardContent className="px-4 py-3">
                <p className="text-3xl font-bold bg-gradient-to-r from-green-400 to-emerald-400 bg-clip-text text-transparent">{status?.last_24h_calls ?? 0}</p>
                <p className="text-[11px] text-muted-foreground mt-1">{t('ai:stats.last24hours')}</p>
              </CardContent></Card>
            </motion.div>
          </motion.div>

          <motion.div variants={staggerContainer} initial="initial" animate="animate" className="relative z-10 grid grid-cols-1 md:grid-cols-3 gap-4 max-w-4xl w-full">
            {TABS.map((tab) => {
              const enabled = isPluginEnabled(tab.pluginId);
              return (
                <motion.div key={tab.id} variants={staggerItem} whileHover={enabled ? { scale: 1.02 } : {}} whileTap={enabled ? { scale: 0.98 } : {}}>
                  <Card className={`transition-all ${enabled ? `border-${tab.color}-500/30 hover:border-${tab.color}-500/50 hover:bg-${tab.color}-500/5 cursor-pointer` : 'border-border/30 opacity-50 cursor-not-allowed'}`}
                    onClick={() => { if (!enabled) return; if (tab.navigateTo) navigate(`/projects/${project?.slug}/${tab.navigateTo}`); else setActiveTab(tab.id); }}>
                    <CardContent className="px-5 py-4">
                      <div className="flex items-center gap-3 mb-3">
                        <div className={`h-11 w-11 rounded-xl bg-gradient-to-br ${enabled ? tab.activeColor : 'from-muted to-muted'} flex items-center justify-center`}>
                          {enabled ? <tab.icon className={`h-5 w-5 text-${tab.color}-400`} /> : <Lock className="h-5 w-5 text-muted-foreground/40" />}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold">{t(`ai:tabs.${tab.id}.label`)}</h3>
                            <Badge variant="outline" className={`text-[9px] ${enabled ? 'bg-green-500/10 text-green-500 border-green-500/20' : 'border-border/30 text-muted-foreground/40'}`}>
                              {enabled ? t('ai:active') : t('ai:disabled')}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">{t(`ai:tabs.${tab.id}.desc`)}</p>
                        </div>
                        {enabled && <ArrowRight className={`h-4 w-4 text-${tab.color}-400/50`} />}
                      </div>
                      <p className="text-[11px] text-muted-foreground/70">{t(`ai:tabs.${tab.id}.fullDesc`)}</p>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </motion.div>
        </div>
      </PageWrapper>
    );
  }

  // ── CATEGORY PAGE ──
  return (
    <PageWrapper>
      <div className="relative overflow-visible">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(139,92,246,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(139,92,246,0.03)_1px,transparent_1px)] bg-[size:48px_48px] pointer-events-none" />

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="relative mb-6">
          <button onClick={() => setActiveTab(null)} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3">
            <ArrowLeft className="h-3.5 w-3.5" /> {t('ai:backToAi')}
          </button>
          <div className="flex items-center gap-3">
            <div className={`h-10 w-10 rounded-xl bg-gradient-to-br ${currentTab!.activeColor} flex items-center justify-center`}>
              <currentTab.icon className={`h-5 w-5 text-${currentTab!.color}-400`} />
            </div>
            <div>
              <h1 className="text-2xl font-bold">{t(`ai:tabs.${activeTab}.label`)}</h1>
              <p className="text-xs text-muted-foreground">{t(`ai:tabs.${activeTab}.desc`)}</p>
            </div>
            <Badge variant="outline" className="ml-2 text-[9px] bg-green-500/10 text-green-500 border-green-500/20">{t('ai:active')}</Badge>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}>
          <Card className={`mb-6 border-${currentTab!.color}-500/20 bg-${currentTab!.color}-500/5`}>
            <CardContent className="px-4 py-3">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">{t(`ai:tabs.${activeTab}.fullDesc`)}</p>
                <Button size="sm" onClick={() => setSetupDialog(true)} className={activeTab === 'rest' ? 'bg-purple-600 hover:bg-purple-700' : 'bg-blue-600 hover:bg-blue-700'}>
                  <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> {t('ai:setup.title')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={staggerContainer} initial="initial" animate="animate" className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {[
            { icon: Activity, iconColor: 'text-purple-400', bgColor: 'bg-purple-500/10', value: stats?.total_calls ?? 0, label: t('ai:stats.totalCalls') },
            { icon: Zap, iconColor: 'text-blue-400', bgColor: 'bg-blue-500/10', value: `${stats?.avg_duration_ms ?? 0}`, suffix: 'ms', label: t('ai:stats.avgResponse') },
            { icon: Sparkles, iconColor: 'text-green-400', bgColor: 'bg-green-500/10', value: status?.last_24h_calls ?? 0, label: t('ai:stats.last24h') },
          ].map((m, i) => (
            <motion.div key={i} variants={staggerItem}>
              <Card className={`border-${currentTab!.color}-500/10`}><CardContent className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className={`h-10 w-10 rounded-lg ${m.bgColor} flex items-center justify-center`}><m.icon className={`h-5 w-5 ${m.iconColor}`} /></div>
                  <div>
                    <p className="text-2xl font-bold">{m.value}{m.suffix && <span className="text-sm font-normal text-muted-foreground">{m.suffix}</span>}</p>
                    <p className="text-xs text-muted-foreground">{m.label}</p>
                  </div>
                </div>
              </CardContent></Card>
            </motion.div>
          ))}
        </motion.div>

        <div className="mb-6">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Code className={`h-4 w-4 text-${currentTab!.color}-400`} /> {t('ai:tools.title')}
          </h3>
          <Card>
            <CardContent className="p-0">
              <div className="divide-y divide-border/50">
                {TOOL_KEYS.map((key) => {
                  const Icon = TOOL_ICONS[key] ?? Code;
                  return (
                    <div key={key} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors">
                      <Icon className={`h-4 w-4 shrink-0 ${TOOL_COLORS[key] ?? 'text-muted-foreground'}`} />
                      <span className="font-mono text-[11px] font-medium w-[160px] shrink-0">{t(`ai:tools.${key}.name`)}</span>
                      <span className="text-[11px] text-muted-foreground truncate">{t(`ai:tools.${key}.desc`)}</span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        {activity && activity.activity.length > 0 ? (
          <div>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Activity className={`h-4 w-4 text-${currentTab!.color}-400`} /> {t('ai:activity.title')}
            </h3>
            <Card><CardContent className="p-3">
              <div className="space-y-1.5 max-h-[250px] overflow-auto">
                <AnimatePresence mode="popLayout">
                  {activity.activity.map((entry) => (
                    <motion.div key={entry.id} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
                      className="flex items-center gap-3 text-sm py-1.5 border-b border-border/50 last:border-0">
                      <Badge variant="outline" className={`text-[9px] font-mono ${entry.gateway_type === 'mcp' ? 'text-blue-400 border-blue-500/30' : 'text-purple-400 border-purple-500/30'}`}>
                        {entry.gateway_type.toUpperCase()}
                      </Badge>
                      <span className="font-mono text-xs flex-1">{entry.tool_name}</span>
                      <Badge variant={entry.response_status === 200 ? 'default' : 'destructive'}
                        className={`text-[9px] ${entry.response_status === 200 ? 'bg-green-500/10 text-green-500 border-green-500/20' : ''}`}>
                        {entry.response_status}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground w-14 text-right">{entry.duration_ms}ms</span>
                      <span className="text-[10px] text-muted-foreground w-20 text-right">{new Date(entry.created_at).toLocaleTimeString()}</span>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </CardContent></Card>
          </div>
        ) : (
          <Card className="border-dashed border-muted-foreground/20">
            <CardContent className="px-4 py-8 text-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm font-medium text-muted-foreground">{t('ai:setup.waitingTitle')}</p>
              <p className="text-xs text-muted-foreground/60 mt-1">{t('ai:setup.waitingDesc')}</p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* ── SETUP GUIDE DIALOG ── */}
      <Dialog open={setupDialog} onOpenChange={setSetupDialog}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {currentTab && <currentTab.icon className={`h-5 w-5 text-${currentTab.color}-400`} />}
              {t(`ai:setup.${activeTab === 'rest' ? 'restTitle' : 'mcpTitle'}`)}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 overflow-auto flex-1 pr-1">
            {/* Step 1 */}
            <div className="rounded-lg border p-4 space-y-2">
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-full bg-purple-500/10 flex items-center justify-center text-xs font-bold text-purple-400">1</div>
                <span className="text-sm font-medium">{t('ai:setup.step1title')}</span>
              </div>
              <p className="text-xs text-muted-foreground ml-9">{t('ai:setup.step1desc')}</p>
            </div>

            {/* Step 2 */}
            <div className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-full bg-purple-500/10 flex items-center justify-center text-xs font-bold text-purple-400">2</div>
                <span className="text-sm font-medium">{t(`ai:setup.${activeTab === 'rest' ? 'step2restTitle' : 'step2mcpTitle'}`)}</span>
              </div>

              {activeTab === 'rest' ? (
                <div className="ml-9 space-y-2">
                  <p className="text-xs text-muted-foreground">{t('ai:setup.step2restDesc')}</p>
                  <div className="relative">
                    <pre className="text-[11px] font-mono bg-muted p-3 rounded-md overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-[300px] overflow-y-auto">{restPrompt}</pre>
                    <Button size="icon" variant="ghost" className="absolute top-1 right-1 h-7 w-7" onClick={() => copy(restPrompt)}>
                      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="ml-9 space-y-3">
                  <p className="text-xs text-muted-foreground">{t('ai:setup.step2mcpDesc')}</p>
                  <div className="relative">
                    <pre className="text-[11px] font-mono bg-muted p-3 rounded-md overflow-x-auto">{mcpConfig}</pre>
                    <Button size="icon" variant="ghost" className="absolute top-1 right-1 h-7 w-7" onClick={() => copy(mcpConfig)}>
                      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground/70">
                    <Info className="h-3 w-3 inline mr-1" />{t('ai:setup.step2mcpClients')}
                  </p>
                </div>
              )}
            </div>

            {/* Step 3 */}
            <div className="rounded-lg border p-4 space-y-2">
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-full bg-purple-500/10 flex items-center justify-center text-xs font-bold text-purple-400">3</div>
                <span className="text-sm font-medium">{t('ai:setup.step3title')}</span>
              </div>
              {activeTab === 'rest' ? (
                <div className="ml-9">
                  <p className="text-xs text-muted-foreground mb-2">{t('ai:setup.step3restDesc')}</p>
                  <pre className="text-[11px] font-mono bg-muted p-3 rounded-md overflow-x-auto">{`curl -H "x-api-key: YOUR_TOKEN" \\\n  ${baseUrl}/context`}</pre>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground ml-9">{t('ai:setup.step3mcpDesc')}</p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </PageWrapper>
  );
}

export default AIDashboardPage;
