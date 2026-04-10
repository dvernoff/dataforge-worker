import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Wand2, Plus, Trash2, Play, Settings, MessageSquare, BarChart3,
  Loader2, Check, ArrowLeft, ArrowRight, Copy, Clock, Zap, Brain, BookOpen,
  ChevronRight, Sparkles,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { useCurrentProject } from '@/hooks/useProject';
import { aiStudioApi } from '@/api/ai-studio.api';
import { usePageTitle } from '@/hooks/usePageTitle';
import { staggerContainer, staggerItem } from '@/lib/animations';
import { toast } from 'sonner';

const PROVIDERS = [
  { id: 'openai', label: 'OpenAI', color: 'text-green-400', bg: 'bg-green-500/10 border-green-500/20', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1-mini', 'o3-mini'] },
  { id: 'deepseek', label: 'DeepSeek', color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20', models: ['deepseek-chat', 'deepseek-reasoner'] },
  { id: 'claude', label: 'Claude', color: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/20', models: ['claude-sonnet-4-20250514', 'claude-haiku-4-20250414'] },
];

const CONTEXT_TTL_OPTIONS = [
  { label: '1 час', value: 60 }, { label: '6 часов', value: 360 },
  { label: '24 часа', value: 1440 }, { label: '3 дня', value: 4320 }, { label: '7 дней', value: 10080 },
];

const EMPTY_FORM = {
  name: '', provider: 'openai', model: 'gpt-4o-mini', api_key: '',
  system_prompt: '', temperature: 0.7, max_tokens: 1024,
  context_enabled: false, context_ttl_hours: 60,
  max_context_messages: 50, max_tokens_per_session: 0,
  retry_on_invalid: false, max_retries: 3,
  validation_json: false, validation_required_fields: '',
};

const WIZARD_STEPS = ['provider', 'prompt', 'settings'] as const;

export function AIStudioPage() {
  const { t } = useTranslation(['ai', 'common']);
  usePageTitle(t('ai:studio.pageTitle'));
  const navigate = useNavigate();
  const { data: project } = useCurrentProject();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [editDialog, setEditDialog] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editId, setEditId] = useState<string | null>(null);
  const [wizardStep, setWizardStep] = useState(0);
  const [promptMode, setPromptMode] = useState<'builder' | 'raw'>('builder');
  const [promptFields, setPromptFields] = useState({ role: '', task: '', inputDesc: '', rules: '', responseFormat: '', important: '' });
  const [testInput, setTestInput] = useState('');
  const [testResult, setTestResult] = useState<Record<string, unknown> | null>(null);
  const [testLoading, setTestLoading] = useState(false);

  const { data: endpointsData, isLoading } = useQuery({
    queryKey: ['ai-studio-endpoints', project?.id],
    queryFn: () => aiStudioApi.listEndpoints(project!.id),
    enabled: !!project?.id,
  });

  const { data: statsData } = useQuery({
    queryKey: ['ai-studio-stats', project?.id],
    queryFn: () => aiStudioApi.getStats(project!.id),
    enabled: !!project?.id, refetchInterval: 15000,
  });

  const { data: logsData } = useQuery({
    queryKey: ['ai-studio-logs', project?.id, selected],
    queryFn: () => aiStudioApi.getLogs(project!.id, { limit: 20, endpointId: selected ?? undefined }),
    enabled: !!project?.id && !!selected, refetchInterval: 10000,
  });

  function buildPayload() {
    const finalPrompt = promptMode === 'builder' ? buildPromptFromFields() : form.system_prompt;
    const payload: Record<string, unknown> = {
      name: form.name, provider: form.provider, model: form.model,
      system_prompt: finalPrompt || null,
      temperature: form.temperature, max_tokens: form.max_tokens,
      context_enabled: form.context_enabled, context_ttl_minutes: form.context_ttl_hours,
      max_context_messages: form.max_context_messages, max_tokens_per_session: form.max_tokens_per_session,
      retry_on_invalid: form.retry_on_invalid, max_retries: form.max_retries,
    };
    if (form.api_key) payload.api_key = form.api_key;
    const vr: Record<string, unknown> = {};
    if (form.validation_json) { vr.json = true; vr.type = 'json'; }
    if (form.validation_required_fields) vr.required_fields = form.validation_required_fields.split(',').map(s => s.trim()).filter(Boolean);
    if (Object.keys(vr).length > 0) payload.validation_rules = vr;
    return payload;
  }

  const createMutation = useMutation({
    mutationFn: () => {
      const data = buildPayload();
      return editId ? aiStudioApi.updateEndpoint(project!.id, editId, data) : aiStudioApi.createEndpoint(project!.id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-studio-endpoints'] });
      setEditDialog(false);
      toast.success(editId ? t('ai:studio.endpointUpdated') : t('ai:studio.endpointCreated'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => aiStudioApi.deleteEndpoint(project!.id, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-studio-endpoints'] });
      if (selected === deleteTarget) setSelected(null);
      setDeleteTarget(null);
      toast.success(t('ai:studio.endpointDeleted'));
    },
  });

  const endpoints = endpointsData?.endpoints ?? [];
  const selectedEp = endpoints.find((e: Record<string, unknown>) => e.id === selected);
  const providerModels = PROVIDERS.find(p => p.id === form.provider)?.models ?? [];

  function buildPromptFromFields() {
    const parts: string[] = [];
    if (promptFields.role) parts.push(`ROLE:\n${promptFields.role}`);
    if (promptFields.task) parts.push(`TASK:\n${promptFields.task}`);
    if (promptFields.inputDesc) parts.push(`INPUT:\n${promptFields.inputDesc}`);
    if (promptFields.responseFormat) parts.push(`RESPONSE FORMAT:\n${promptFields.responseFormat}`);
    if (promptFields.rules) parts.push(`RULES:\n${promptFields.rules}`);
    if (promptFields.important) parts.push(`IMPORTANT:\n${promptFields.important}`);
    return parts.join('\n\n');
  }

  function syncPromptToForm() {
    setForm(f => ({ ...f, system_prompt: buildPromptFromFields() }));
  }

  function openCreate() {
    setForm({ ...EMPTY_FORM, system_prompt: '' });
    setPromptFields({ role: '', task: '', inputDesc: '', rules: '', responseFormat: '', important: '' });
    setPromptMode('builder'); setEditId(null); setWizardStep(0); setEditDialog(true);
  }
  function openEdit(ep: Record<string, unknown>) {
    const vr = ep.validation_rules as Record<string, unknown> | null;
    setForm({
      name: ep.name as string, provider: ep.provider as string, model: ep.model as string,
      api_key: (ep.api_key as string) ?? '',
      system_prompt: (ep.system_prompt as string) ?? '', temperature: ep.temperature as number,
      max_tokens: ep.max_tokens as number, context_enabled: ep.context_enabled as boolean,
      context_ttl_hours: ep.context_ttl_minutes as number,
      max_context_messages: (ep.max_context_messages as number) ?? 50,
      max_tokens_per_session: (ep.max_tokens_per_session as number) ?? 0,
      retry_on_invalid: ep.retry_on_invalid as boolean, max_retries: ep.max_retries as number,
      validation_json: !!vr?.json || vr?.type === 'json',
      validation_required_fields: Array.isArray(vr?.required_fields) ? (vr.required_fields as string[]).join(', ') : '',
    });
    setPromptMode((ep.system_prompt as string) ? 'raw' : 'builder');
    setPromptFields({ role: '', task: '', inputDesc: '', rules: '', responseFormat: '', important: '' });
    setEditId(ep.id as string); setWizardStep(0); setEditDialog(true);
  }
  async function handleTest() {
    if (!selected || !testInput.trim()) return;
    setTestLoading(true); setTestResult(null);
    try { setTestResult(await aiStudioApi.testEndpoint(project!.id, selected, { input: testInput })); }
    catch (err) { setTestResult({ error: (err as Error).message }); }
    finally { setTestLoading(false); }
  }

  const basePath = `/projects/${project?.slug}`;
  const workerUrl = project?.node_url?.replace(/\/$/, '') ?? window.location.origin;

  return (
    <PageWrapper>
      <div className="relative">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(16,185,129,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(16,185,129,0.02)_1px,transparent_1px)] bg-[size:48px_48px] pointer-events-none" />

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="relative mb-6">
          <button onClick={() => navigate(`${basePath}/ai`)} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3">
            <ArrowLeft className="h-3.5 w-3.5" /> AI Gateway
          </button>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <motion.div animate={{ rotate: [0, 5, -5, 0] }} transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
                className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/20 flex items-center justify-center">
                <Wand2 className="h-5 w-5 text-emerald-400" />
              </motion.div>
              <div>
                <h1 className="text-2xl font-bold bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">{t('ai:studio.pageTitle')}</h1>
                <p className="text-xs text-muted-foreground">{t('ai:tabs.studio.desc')}</p>
              </div>
            </div>
            <Button onClick={openCreate} className="bg-emerald-600 hover:bg-emerald-700">
              <Plus className="h-4 w-4 mr-2" /> {t('common:actions.create')}
            </Button>
          </div>
        </motion.div>

        {statsData && (
          <motion.div variants={staggerContainer} initial="initial" animate="animate" className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            {[
              { label: t('ai:studio.stats.totalCalls'), value: statsData.calls_24h ?? statsData.total_calls ?? 0, icon: BarChart3, color: 'text-emerald-400', gradient: 'from-emerald-400 to-teal-400' },
              { label: t('ai:studio.stats.avgResponse'), value: `${statsData.avg_duration_ms}ms`, icon: Zap, color: 'text-blue-400', gradient: 'from-blue-400 to-cyan-400' },
              { label: t('ai:studio.stats.totalTokens'), value: statsData.total_tokens.toLocaleString(), icon: Brain, color: 'text-purple-400', gradient: 'from-purple-400 to-pink-400' },
              { label: t('ai:studio.stats.endpoints'), value: endpoints.length, icon: Wand2, color: 'text-emerald-400', gradient: 'from-emerald-400 to-green-400' },
            ].map((s, i) => (
              <motion.div key={i} variants={staggerItem} whileHover={{ scale: 1.02 }}>
                <Card className="border-emerald-500/10 hover:border-emerald-500/20 transition-colors"><CardContent className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <s.icon className={`h-4 w-4 ${s.color}`} />
                    <span className={`text-lg font-bold bg-gradient-to-r ${s.gradient} bg-clip-text text-transparent`}>{s.value}</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">{s.label}</p>
                </CardContent></Card>
              </motion.div>
            ))}
          </motion.div>
        )}

        <div className="flex gap-4 min-h-[500px]">
          <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}>
            <Card className="w-64 shrink-0 border-emerald-500/10">
              <CardContent className="p-2">
                <ScrollArea className="h-[460px]">
                  {isLoading ? (
                    <div className="space-y-2 p-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-14 rounded-lg bg-muted animate-pulse" />)}</div>
                  ) : endpoints.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">
                      <Sparkles className="h-8 w-8 mx-auto mb-2 opacity-20 animate-pulse" />
                      <p className="text-sm">{t('ai:studio.noEndpoints')}</p>
                      <Button variant="ghost" size="sm" onClick={openCreate} className="mt-2 text-emerald-400">
                        <Plus className="h-3.5 w-3.5 mr-1" /> {t('common:actions.create')}
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-1 p-1">
                      {endpoints.map((ep: Record<string, unknown>) => {
                        const prov = PROVIDERS.find(p => p.id === ep.provider);
                        return (
                          <motion.button key={ep.id as string} whileHover={{ x: 2 }} onClick={() => setSelected(ep.id as string)}
                            className={`w-full text-left rounded-lg px-3 py-2.5 transition-all ${selected === ep.id ? 'bg-emerald-500/10 border border-emerald-500/30' : 'hover:bg-muted/50 border border-transparent'}`}>
                            <div className="flex items-center gap-2">
                              <div className={`h-2 w-2 rounded-full ${(ep.is_active as boolean) ? 'bg-emerald-400' : 'bg-muted-foreground/30'}`} />
                              <span className="text-sm font-medium truncate flex-1">{ep.name as string}</span>
                            </div>
                            <div className="flex items-center gap-1.5 mt-1 ml-4">
                              <Badge variant="outline" className={`text-[8px] border ${prov?.bg ?? ''}`}>{prov?.label ?? ep.provider}</Badge>
                            </div>
                          </motion.button>
                        );
                      })}
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="flex-1 min-w-0">
            {selectedEp ? (
              <Card className="border-emerald-500/10">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h2 className="text-lg font-semibold">{selectedEp.name as string}</h2>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="outline" className={PROVIDERS.find(p => p.id === selectedEp.provider)?.bg ?? ''}>
                          {selectedEp.provider as string}
                        </Badge>
                        <span className="text-xs text-muted-foreground font-mono">{selectedEp.model as string}</span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-2">
                        <code className="text-[10px] font-mono bg-muted px-2 py-1 rounded">POST /api/v1/{project?.slug}/ai-studio/{selectedEp.slug as string}</code>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { navigator.clipboard.writeText(`${workerUrl}/api/v1/${project?.slug}/ai-studio/${selectedEp.slug}`); toast.success('URL copied'); }}>
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => openEdit(selectedEp)}><Settings className="h-3.5 w-3.5 mr-1" /> {t('common:actions.edit')}</Button>
                      <Button variant="outline" size="sm" className="text-destructive" onClick={() => setDeleteTarget(selectedEp.id as string)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>

                  <Tabs defaultValue="docs">
                    <TabsList className="mb-4">
                      <TabsTrigger value="docs"><BookOpen className="h-3.5 w-3.5 mr-1" /> Docs</TabsTrigger>
                      <TabsTrigger value="test"><Play className="h-3.5 w-3.5 mr-1" /> {t('ai:studio.tabs.test')}</TabsTrigger>
                      <TabsTrigger value="logs"><Clock className="h-3.5 w-3.5 mr-1" /> {t('ai:studio.tabs.logs')}</TabsTrigger>
                    </TabsList>

                    <TabsContent value="docs">
                      {(() => {
                        const ep = selectedEp;
                        const epUrl = `${workerUrl}/api/v1/${project?.slug}/ai-studio/${ep.slug}`;
                        const ctxEnabled = ep.context_enabled as boolean;
                        const vr = ep.validation_rules as Record<string, unknown> | null;
                        const hasJson = !!vr?.json || vr?.type === 'json';
                        const reqFields = Array.isArray(vr?.required_fields) ? (vr.required_fields as string[]) : [];
                        return (
                          <div className="space-y-4 text-sm max-h-[400px] overflow-auto pr-1">
                            <div>
                              <h4 className="font-semibold mb-2 flex items-center gap-1.5"><Zap className="h-3.5 w-3.5 text-emerald-400" /> Запрос</h4>
                              <div className="relative">
                                <pre className="text-[11px] font-mono bg-muted p-3 rounded-md overflow-x-auto whitespace-pre-wrap">{`POST ${epUrl}${ctxEnabled ? '/ctx/{session_id}' : ''}
x-api-key: YOUR_TOKEN

${JSON.stringify({ input: "Ваше сообщение" }, null, 2)}`}</pre>
                                <Button variant="ghost" size="icon" className="absolute top-1 right-1 h-6 w-6" onClick={() => { navigator.clipboard.writeText(`curl -X POST "${epUrl}${ctxEnabled ? '/ctx/session-1' : ''}" -H "x-api-key: YOUR_TOKEN" -H "Content-Type: application/json" -d '{"input":"test"}'`); toast.success('cURL copied'); }}>
                                  <Copy className="h-3 w-3" />
                                </Button>
                              </div>
                            </div>
                            {ctxEnabled && (
                              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                                <h4 className="font-semibold mb-1 flex items-center gap-1.5"><MessageSquare className="h-3.5 w-3.5 text-emerald-400" /> Контекст</h4>
                                <p className="text-[11px] text-muted-foreground mb-2">Передайте <code className="bg-muted px-1 rounded">session_id</code> в URL для хранения истории. Каждый ID — отдельный диалог.</p>
                                <pre className="text-[10px] font-mono bg-muted p-2 rounded-md">{`POST ${ep.slug}/ctx/user-123    — вызов с контекстом\nGET  ${ep.slug}/ctx/user-123    — история\nDEL  ${ep.slug}/ctx/user-123    — очистка`}</pre>
                                <p className="text-[10px] text-muted-foreground mt-1">TTL: {(ep.context_ttl_minutes as number) >= 1440 ? `${Math.round((ep.context_ttl_minutes as number) / 1440)} дн.` : `${ep.context_ttl_minutes} мин.`}</p>
                              </div>
                            )}
                            <div>
                              <h4 className="font-semibold mb-2">Ответ</h4>
                              <pre className="text-[11px] font-mono bg-muted p-3 rounded-md overflow-x-auto whitespace-pre-wrap">{JSON.stringify({
                                content: hasJson ? `{ ${reqFields.map(f => `"${f}": "..."`).join(', ') || '"result": "..."'} }` : "Ответ AI",
                                tokens_used: 150, model: ep.model, duration_ms: 1200, attempts: 1,
                              }, null, 2)}</pre>
                            </div>
                            {hasJson && (
                              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                                <p className="text-[11px]"><Check className="h-3 w-3 inline mr-1 text-amber-400" />
                                  JSON валидация{reqFields.length > 0 && <>: поля <code className="bg-muted px-1 rounded">{reqFields.join(', ')}</code></>}.
                                  {ep.retry_on_invalid && <> Повтор до {ep.max_retries as number}x при ошибке.</>}
                                </p>
                              </div>
                            )}
                            <div>
                              <h4 className="font-semibold mb-1">Ошибка</h4>
                              <pre className="text-[10px] font-mono bg-muted p-2 rounded-md">{`{ "error": "описание" }  // HTTP 400`}</pre>
                            </div>
                          </div>
                        );
                      })()}
                    </TabsContent>

                    <TabsContent value="test" className="space-y-3">
                      <Textarea value={testInput} onChange={e => setTestInput(e.target.value)} placeholder={t('ai:studio.test.placeholder')} className="min-h-[80px]" />
                      <Button onClick={handleTest} disabled={testLoading || !testInput.trim()} className="bg-emerald-600 hover:bg-emerald-700">
                        {testLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
                        {t('ai:studio.test.send')}
                      </Button>
                      {testResult && (
                        <Card className={`${(testResult).error ? 'border-destructive/30' : 'border-emerald-500/30'}`}>
                          <CardContent className="p-3">
                            {(testResult).error ? (
                              <p className="text-sm text-destructive">{(testResult).error as string}</p>
                            ) : (
                              <>
                                <pre className="text-sm font-mono whitespace-pre-wrap bg-muted p-3 rounded-md mb-2 max-h-[300px] overflow-auto">{(testResult).content as string}</pre>
                                <div className="flex gap-3 text-[10px] text-muted-foreground">
                                  <span>{(testResult).tokens_used as number} {t('ai:studio.test.tokens')}</span>
                                  <span>{(testResult).duration_ms as number}ms</span>
                                  <span>{(testResult).model as string}</span>
                                </div>
                              </>
                            )}
                          </CardContent>
                        </Card>
                      )}
                    </TabsContent>

                    <TabsContent value="logs">
                      {logsData?.logs && logsData.logs.length > 0 ? (
                        <div className="space-y-1.5 max-h-[350px] overflow-auto">
                          {logsData.logs.map((log: Record<string, unknown>) => (
                            <div key={log.id as string} className="flex items-center gap-3 text-sm py-1.5 border-b border-border/50 last:border-0">
                              <Badge variant={log.status === 'success' ? 'default' : 'destructive'}
                                className={`text-[9px] ${log.status === 'success' ? 'bg-green-500/10 text-green-500 border-green-500/20' : ''}`}>
                                {log.status as string}
                              </Badge>
                              <span className="text-xs text-muted-foreground">{log.tokens_used as number} tok</span>
                              <span className="text-xs text-muted-foreground">{log.duration_ms as number}ms</span>
                              <span className="text-[10px] text-muted-foreground ml-auto">{new Date(log.created_at as string).toLocaleString()}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground text-center py-8">{t('ai:studio.logs.noLogs')}</p>
                      )}
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>
            ) : (
              <Card className="border-dashed border-emerald-500/10 h-full flex items-center justify-center">
                <CardContent className="text-center py-16">
                  <motion.div animate={{ rotate: [0, 10, -10, 0] }} transition={{ duration: 3, repeat: Infinity }}>
                    <Sparkles className="h-12 w-12 mx-auto mb-3 text-emerald-500/20" />
                  </motion.div>
                  <p className="text-sm text-muted-foreground">{t('ai:studio.selectEndpoint')}</p>
                  <Button variant="ghost" size="sm" onClick={openCreate} className="mt-3 text-emerald-400">
                    <Plus className="h-3.5 w-3.5 mr-1" /> {t('ai:studio.newEndpoint')}
                  </Button>
                </CardContent>
              </Card>
            )}
          </motion.div>
        </div>
      </div>

      {/* ── WIZARD DIALOG ── */}
      <Dialog open={editDialog} onOpenChange={setEditDialog}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wand2 className="h-5 w-5 text-emerald-400" />
              {editId ? t('ai:studio.editEndpoint') : t('ai:studio.newEndpoint')}
            </DialogTitle>
          </DialogHeader>

          <div className="flex gap-1 mb-4">
            {WIZARD_STEPS.map((step, i) => (
              <button key={step} onClick={() => setWizardStep(i)}
                className={`flex-1 h-1.5 rounded-full transition-colors ${i <= wizardStep ? 'bg-emerald-500' : 'bg-muted'}`} />
            ))}
          </div>

          <AnimatePresence mode="wait">
            <motion.div key={wizardStep} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.15 }}>

              {wizardStep === 0 && (
                <div className="space-y-4">
                  <div><Label>{t('ai:studio.form.name')}</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder={t('ai:studio.form.namePlaceholder')} className="mt-1" /></div>
                  <div>
                    <Label>{t('ai:studio.form.provider')}</Label>
                    <div className="grid grid-cols-3 gap-2 mt-2">
                      {PROVIDERS.map(p => (
                        <button key={p.id} onClick={() => setForm({ ...form, provider: p.id, model: p.models[0] })}
                          className={`rounded-lg border p-3 text-center transition-all ${form.provider === p.id ? `${p.bg} border-2` : 'border-border hover:border-border/80'}`}>
                          <span className={`text-sm font-medium ${p.color}`}>{p.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>{t('ai:studio.form.model')}</Label>
                      <select value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} className="w-full h-9 rounded-md border bg-background px-3 text-sm mt-1">
                        {providerModels.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                    <div><Label>API Key</Label>
                      <Input type="password" value={form.api_key} onChange={e => setForm({ ...form, api_key: e.target.value })} placeholder="sk-..." className="mt-1 font-mono text-xs" />
                    </div>
                  </div>
                </div>
              )}

              {wizardStep === 1 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>{t('ai:studio.form.systemPrompt')}</Label>
                      <p className="text-[10px] text-muted-foreground">Инструкция для AI. Получает при каждом вызове.</p>
                    </div>
                    <div className="flex rounded-lg border p-0.5 gap-0.5">
                      <button onClick={() => { if (promptMode === 'builder') { syncPromptToForm(); } setPromptMode('builder'); }}
                        className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${promptMode === 'builder' ? 'bg-emerald-500/10 text-emerald-400' : 'text-muted-foreground hover:text-foreground'}`}>
                        Конструктор
                      </button>
                      <button onClick={() => { if (promptMode === 'builder') { setForm(f => ({ ...f, system_prompt: buildPromptFromFields() })); } setPromptMode('raw'); }}
                        className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${promptMode === 'raw' ? 'bg-emerald-500/10 text-emerald-400' : 'text-muted-foreground hover:text-foreground'}`}>
                        Текст
                      </button>
                    </div>
                  </div>

                  <AnimatePresence mode="wait">
                    {promptMode === 'builder' ? (
                      <motion.div key="builder" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label className="text-xs text-muted-foreground">Роль AI</Label>
                            <Input value={promptFields.role} onChange={e => setPromptFields({ ...promptFields, role: e.target.value })}
                              placeholder="Ты — модератор игрового чата" className="mt-1 text-xs" />
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground">Задача</Label>
                            <Input value={promptFields.task} onChange={e => setPromptFields({ ...promptFields, task: e.target.value })}
                              placeholder="Определять нарушения правил" className="mt-1 text-xs" />
                          </div>
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Что приходит на вход</Label>
                          <Input value={promptFields.inputDesc} onChange={e => setPromptFields({ ...promptFields, inputDesc: e.target.value })}
                            placeholder="Сообщения из игрового чата с именем игрока" className="mt-1 text-xs" />
                        </div>
                        <div>
                          <div className="flex items-center justify-between">
                            <Label className="text-xs text-muted-foreground">Формат ответа</Label>
                            <button onClick={() => setPromptFields({ ...promptFields, responseFormat: 'Отвечай ТОЛЬКО валидным JSON, ничего кроме:\n{\n  "result": true,\n  "reason": "краткое объяснение"\n}' })}
                              className="text-[10px] text-emerald-400 hover:text-emerald-300 transition-colors">
                              + Вставить JSON шаблон
                            </button>
                          </div>
                          <Textarea value={promptFields.responseFormat} onChange={e => setPromptFields({ ...promptFields, responseFormat: e.target.value })}
                            placeholder={'Отвечай ТОЛЬКО JSON:\n{"ok": true/false, "rule": "1.1", "reason": "описание"}'} className="mt-1 text-xs font-mono min-h-[80px]" />
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Правила / контекст</Label>
                          <Textarea value={promptFields.rules} onChange={e => setPromptFields({ ...promptFields, rules: e.target.value })}
                            placeholder="1. Нельзя оскорблять игроков\n2. Нельзя рекламировать\n3. ..." className="mt-1 text-xs min-h-[120px]" />
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Важные заметки</Label>
                          <Textarea value={promptFields.important} onChange={e => setPromptFields({ ...promptFields, important: e.target.value })}
                            placeholder="- Если непонятно — ok: false\n- Шутки не являются нарушением" className="mt-1 text-xs min-h-[60px]" />
                        </div>
                      </motion.div>
                    ) : (
                      <motion.div key="raw" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                        <Textarea value={form.system_prompt} onChange={e => setForm({ ...form, system_prompt: e.target.value })}
                          placeholder={t('ai:studio.form.systemPromptPlaceholder')} className="min-h-[400px] font-mono text-xs leading-relaxed" />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {wizardStep === 2 && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>{t('ai:studio.form.temperature')} — {form.temperature}</Label>
                      <p className="text-[10px] text-muted-foreground mb-2">0 = точный, 1 = креативный</p>
                      <Slider value={[form.temperature]} onValueChange={([v]) => setForm({ ...form, temperature: v })} min={0} max={2} step={0.1} />
                    </div>
                    <div>
                      <Label>{t('ai:studio.form.maxTokens')}</Label>
                      <p className="text-[10px] text-muted-foreground mb-1">~4 символа = 1 токен</p>
                      <Input type="number" value={form.max_tokens} onChange={e => setForm({ ...form, max_tokens: Number(e.target.value) })} />
                    </div>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <Label className="text-xs">JSON валидация</Label>
                      <p className="text-[10px] text-muted-foreground">AI обязан вернуть JSON</p>
                    </div>
                    <Switch checked={form.validation_json} onCheckedChange={v => setForm({ ...form, validation_json: v })} />
                  </div>
                  {form.validation_json && (
                    <div>
                      <Label className="text-xs">Обязательные поля</Label>
                      <Input value={form.validation_required_fields} onChange={e => setForm({ ...form, validation_required_fields: e.target.value })} placeholder="result, reason" className="text-xs mt-1" />
                    </div>
                  )}
                  <div className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <Label className="text-xs">{t('ai:studio.form.contextLabel')}</Label>
                      <p className="text-[10px] text-muted-foreground">Передайте session_id в URL для истории диалога</p>
                    </div>
                    <Switch checked={form.context_enabled} onCheckedChange={v => setForm({ ...form, context_enabled: v })} />
                  </div>
                  {form.context_enabled && (
                    <div className="space-y-3 pl-3 border-l-2 border-emerald-500/20">
                      <div>
                        <Label className="text-xs">Время хранения диалога (TTL)</Label>
                        <p className="text-[10px] text-muted-foreground mb-1">Неактивные сессии удаляются автоматически</p>
                        <select value={form.context_ttl_hours} onChange={e => setForm({ ...form, context_ttl_hours: Number(e.target.value) })}
                          className="w-full h-9 rounded-md border bg-background px-3 text-sm">
                          {CONTEXT_TTL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs">Макс. сообщений в диалоге</Label>
                          <p className="text-[10px] text-muted-foreground mb-1">Старые обрезаются. 0 = без лимита</p>
                          <Input type="number" value={form.max_context_messages} onChange={e => setForm({ ...form, max_context_messages: Number(e.target.value) })} className="text-xs" />
                        </div>
                        <div>
                          <Label className="text-xs">Макс. токенов на сессию</Label>
                          <p className="text-[10px] text-muted-foreground mb-1">Лимит расхода. 0 = без лимита</p>
                          <Input type="number" value={form.max_tokens_per_session} onChange={e => setForm({ ...form, max_tokens_per_session: Number(e.target.value) })} className="text-xs" />
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <Label className="text-xs">{t('ai:studio.form.retryLabel')}</Label>
                      <p className="text-[10px] text-muted-foreground">{t('ai:studio.form.retryDesc')}</p>
                    </div>
                    <Switch checked={form.retry_on_invalid} onCheckedChange={v => setForm({ ...form, retry_on_invalid: v })} />
                  </div>
                </div>
              )}

            </motion.div>
          </AnimatePresence>

          <div className="flex justify-between mt-4">
            <Button variant="outline" onClick={() => wizardStep > 0 ? setWizardStep(wizardStep - 1) : setEditDialog(false)} size="sm">
              {wizardStep > 0 ? <><ArrowLeft className="h-3.5 w-3.5 mr-1" /> Назад</> : t('common:actions.cancel')}
            </Button>
            {wizardStep < WIZARD_STEPS.length - 1 ? (
              <Button onClick={() => setWizardStep(wizardStep + 1)} size="sm" disabled={wizardStep === 0 && (!form.name || !form.api_key && !editId)} className="bg-emerald-600 hover:bg-emerald-700">
                Далее <ChevronRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            ) : (
              <Button onClick={() => createMutation.mutate()} disabled={!form.name || !form.model || createMutation.isPending} size="sm" className="bg-emerald-600 hover:bg-emerald-700">
                {createMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Check className="h-3.5 w-3.5 mr-1" />}
                {editId ? t('ai:studio.form.save') : t('ai:studio.form.create')}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={!!deleteTarget} onOpenChange={o => !o && setDeleteTarget(null)}
        title={t('ai:studio.deleteTitle')} description={t('ai:studio.deleteDesc')}
        confirmText={t('common:actions.delete')} variant="destructive"
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget)} loading={deleteMutation.isPending} />
    </PageWrapper>
  );
}

export default AIStudioPage;
