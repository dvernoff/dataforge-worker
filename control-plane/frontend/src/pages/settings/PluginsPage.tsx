import { useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Puzzle, Settings, Clock, Webhook, Play, Braces, Radio,
  Archive, Lock, LayoutDashboard, Kanban, CalendarDays, Image,
  Map, Search, BarChart3, Zap, Code, Terminal, Sparkles, Cpu, Wand2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { staggerContainer, staggerItem } from '@/lib/animations';
import { useCurrentProject } from '@/hooks/useProject';
import { pluginsApi } from '@/api/plugins.api';
import { useFeaturesStore } from '@/stores/features.store';
import { toast } from 'sonner';
import { usePageTitle } from '@/hooks/usePageTitle';

const ICON_MAP: Record<string, typeof Puzzle> = {
  'terminal': Terminal,
  'clock': Clock,
  'webhook': Webhook,
  'play': Play,
  'braces': Braces,
  'radio': Radio,
  'archive': Archive,
  'lock': Lock,
  'layout-dashboard': LayoutDashboard,
  'kanban': Kanban,
  'calendar-days': CalendarDays,
  'image': Image,
  'map': Map,
  'search': Search,
  'bar-chart-3': BarChart3,
  'zap': Zap,
  'code': Code,
  'sparkles': Sparkles,
  'cpu': Cpu,
  'wand-2': Wand2,
};

interface ModulePlugin {
  id: string;
  name: string;
  icon: string;
  default_enabled: boolean;
  configurable?: boolean;
}

interface ViewPlugin {
  id: string;
  name: string;
  icon: string;
  default_enabled: boolean;
}

const MODULES: ModulePlugin[] = [
  { id: 'feature-cron', name: 'Cron Jobs', icon: 'terminal', default_enabled: true },
  { id: 'feature-webhooks', name: 'Webhooks', icon: 'webhook', default_enabled: false },
  { id: 'feature-graphql', name: 'GraphQL', icon: 'braces', default_enabled: false },
  { id: 'feature-websocket', name: 'WebSocket', icon: 'radio', default_enabled: false },
  { id: 'feature-backups', name: 'Backups', icon: 'archive', default_enabled: true },
];

const VIEWS: ViewPlugin[] = [
  { id: 'feature-dashboards', name: 'Dashboards', icon: 'layout-dashboard', default_enabled: false },
  { id: 'feature-kanban', name: 'Kanban', icon: 'kanban', default_enabled: false },
  { id: 'feature-calendar', name: 'Calendar', icon: 'calendar-days', default_enabled: false },
  { id: 'feature-gallery', name: 'Gallery', icon: 'image', default_enabled: false },
  { id: 'feature-db-map', name: 'DB Map', icon: 'map', default_enabled: false },
  { id: 'feature-query-builder', name: 'Query Builder', icon: 'search', default_enabled: false },
  { id: 'feature-analytics', name: 'Analytics', icon: 'bar-chart-3', default_enabled: true },
  { id: 'feature-api-playground', name: 'API Playground', icon: 'play', default_enabled: false },
  { id: 'feature-sdk', name: 'SDK', icon: 'code', default_enabled: false },
];

const AI_PLUGINS: ModulePlugin[] = [
  { id: 'ai-rest-gateway', name: 'AI REST Gateway', icon: 'sparkles', default_enabled: false },
  { id: 'ai-mcp-server', name: 'AI MCP Server', icon: 'cpu', default_enabled: false },
  { id: 'ai-studio', name: 'AI Studio', icon: 'wand-2', default_enabled: false, configurable: true },
];

const CONFIGURABLE_ROUTES: Record<string, string> = {
  'feature-graphql': 'graphql',
  'feature-websocket': 'websocket',
};

interface PluginSettingDef {
  key: string;
  label: string;
  type: string;
  required?: boolean;
  default?: unknown;
  placeholder?: string;
  sensitive?: boolean;
}

interface PluginData {
  id: string;
  name: string;
  description: string;
  version: string;
  runtime: string;
  icon: string;
  type?: string;
  settings: PluginSettingDef[] | Record<string, unknown>;
  saved_settings?: Record<string, unknown>;
  is_enabled: boolean;
  [key: string]: unknown;
}

export function PluginsPage() {
  const { t } = useTranslation(['plugins', 'common']);
  usePageTitle(t('plugins:pageTitle'));
  const { data: project } = useCurrentProject();
  const queryClient = useQueryClient();
  const [selectedPlugin, setSelectedPlugin] = useState<PluginData | null>(null);
  const [settingsForm, setSettingsForm] = useState<Record<string, unknown>>({});
  const { slug } = useParams<{ slug: string }>();
  const { isFeatureEnabled: _isFeatureEnabled, setFeatureEnabled: _setFeatureEnabled } = useFeaturesStore();

  const isFeatureEnabled = (id: string) => _isFeatureEnabled(slug, id);
  const setFeatureEnabled = async (id: string, enabled: boolean) => {
    if (!slug) return;
    _setFeatureEnabled(slug, id, enabled);
    if (project?.id) {
      try {
        if (enabled) {
          await pluginsApi.enable(project.id, id, {});
        } else {
          await pluginsApi.disable(project.id, id);
        }
      } catch { /* ignore */ }
      queryClient.invalidateQueries({ queryKey: ['plugins', project?.id] });
      queryClient.invalidateQueries({ queryKey: ['enabled-features', project?.id] });
    }
  };

  const { data, isLoading } = useQuery({
    queryKey: ['plugins', project?.id],
    queryFn: () => pluginsApi.list(project!.id),
    enabled: !!project?.id,
  });

  const refreshFeatures = useCallback(async () => {
    await queryClient.refetchQueries({ queryKey: ['enabled-features', project?.id] });
    queryClient.invalidateQueries({ queryKey: ['plugins', project?.id] });
  }, [queryClient, project?.id]);

  const enableMutation = useMutation({
    mutationFn: ({ pluginId, settings }: { pluginId: string; settings: Record<string, unknown> }) =>
      pluginsApi.enable(project!.id, pluginId, settings),
    onSuccess: async () => {
      await refreshFeatures();
      queryClient.invalidateQueries({ queryKey: ['ai-gateway-status'] });
      queryClient.invalidateQueries({ queryKey: ['features'] });
      toast.success(t('plugins:pluginEnabled'));
      setSelectedPlugin(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const disableMutation = useMutation({
    mutationFn: (pluginId: string) => pluginsApi.disable(project!.id, pluginId),
    onSuccess: async () => {
      await refreshFeatures();
      queryClient.invalidateQueries({ queryKey: ['ai-gateway-status'] });
      queryClient.invalidateQueries({ queryKey: ['features'] });
      toast.success(t('plugins:pluginDisabled'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateSettingsMutation = useMutation({
    mutationFn: ({ pluginId, settings }: { pluginId: string; settings: Record<string, unknown> }) =>
      pluginsApi.updateSettings(project!.id, pluginId, settings),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plugins', project?.id] });
      toast.success(t('plugins:settingsUpdated'));
      setSelectedPlugin(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const plugins = (data?.plugins ?? []) as PluginData[];
  const AI_PLUGIN_IDS = new Set(AI_PLUGINS.map(p => p.id));
  const workerPlugins = plugins.filter((p) => p.runtime === 'worker' && !AI_PLUGIN_IDS.has(String(p.id)));

  function getSettingDefs(plugin: PluginData): PluginSettingDef[] {
    if (Array.isArray(plugin.settings)) return plugin.settings;
    return [];
  }

  function openSettings(plugin: PluginData) {
    setSelectedPlugin(plugin);
    const savedValues = plugin.saved_settings ?? {};
    const initial: Record<string, unknown> = {};
    const defs = getSettingDefs(plugin);
    for (const def of defs) {
      initial[def.key] = savedValues[def.key] ?? def.default ?? '';
    }
    setSettingsForm(initial);
  }

  function handleSaveSettings() {
    if (!selectedPlugin) return;
    if (selectedPlugin.is_enabled) {
      updateSettingsMutation.mutate({ pluginId: selectedPlugin.id, settings: settingsForm });
    } else {
      enableMutation.mutate({ pluginId: selectedPlugin.id, settings: settingsForm });
    }
  }

  function handleToggleIntegration(plugin: PluginData) {
    if (plugin.is_enabled) {
      disableMutation.mutate(plugin.id);
    } else {
      const defs = getSettingDefs(plugin);
      const hasRequired = defs.some((d) => d.required);
      if (hasRequired) {
        openSettings(plugin);
      } else {
        enableMutation.mutate({ pluginId: plugin.id, settings: {} });
      }
    }
  }

  function handleToggleModule(mod: ModulePlugin) {
    const enabled = isFeatureEnabled(mod.id);
    setFeatureEnabled(mod.id, !enabled);
  }

  function handleToggleAiPlugin(mod: ModulePlugin) {
    const enabled = isFeatureEnabled(mod.id);
    if (enabled) {
      setFeatureEnabled(mod.id, false);
      disableMutation.mutate(mod.id);
    } else {
      setFeatureEnabled(mod.id, true);
      enableMutation.mutate({ pluginId: mod.id, settings: {} });
    }
  }

  function handleToggleView(view: ViewPlugin) {
    const enabled = isFeatureEnabled(view.id);
    setFeatureEnabled(view.id, !enabled);
  }

  return (
    <PageWrapper>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('plugins:pageTitle')}</h1>
      </div>

      <Tabs defaultValue="views" className="w-full">
        <TabsList className="mb-6">
          <TabsTrigger value="views">{t('plugins:tabs.views')}</TabsTrigger>
          <TabsTrigger value="modules">{t('plugins:tabs.modules')}</TabsTrigger>
          <TabsTrigger value="integrations">{t('plugins:tabs.integrations')}</TabsTrigger>
          <TabsTrigger value="ai" className="gap-1.5">
            <Sparkles className="h-3.5 w-3.5" />
            AI
          </TabsTrigger>
        </TabsList>

        <TabsContent value="modules">
          <div className="mb-4">
            <p className="text-sm text-muted-foreground">{t('plugins:modules.description')}</p>
          </div>
          <motion.div variants={staggerContainer} initial={false} animate="animate" className="columns-1 md:columns-2 lg:columns-3 gap-4 [&>*]:mb-4 [&>*]:break-inside-avoid">
            {MODULES.map((mod) => {
              const Icon = ICON_MAP[mod.icon] ?? Puzzle;
              const enabled = isFeatureEnabled(mod.id);
              const configRoute = CONFIGURABLE_ROUTES[mod.id];
              return (
                <motion.div key={mod.id} variants={staggerItem}>
                  <Card>
                    <CardContent>
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                            <Icon className="h-5 w-5 text-primary" />
                          </div>
                          <div>
                            <h3 className="font-medium">{t(`plugins:featurePlugins.${mod.id}.name`, mod.name)}</h3>
                            <p className="text-xs text-muted-foreground">{t('plugins:modules.title')}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {mod.configurable && configRoute && slug && (
                            <Link
                              to={`/projects/${slug}/${configRoute}`}
                              className="h-8 w-8 rounded-md flex items-center justify-center hover:bg-muted transition-colors"
                              title={t('plugins:settings')}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Settings className="h-4 w-4 text-muted-foreground" />
                            </Link>
                          )}
                          <Switch
                            checked={enabled}
                            onCheckedChange={() => handleToggleModule(mod)}
                          />
                        </div>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {t(`plugins:featurePlugins.${mod.id}.description`, '')}
                      </p>
                      <div className="flex items-center gap-2 mt-3">
                        <Badge variant={enabled ? 'default' : 'secondary'}>
                          {enabled ? t('plugins:enabled') : t('plugins:disabled')}
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </motion.div>
        </TabsContent>

        <TabsContent value="integrations">
          <div className="mb-4">
            <p className="text-sm text-muted-foreground">{t('plugins:integrations.description')}</p>
          </div>
          {isLoading ? (
            <div className="columns-1 md:columns-2 lg:columns-3 gap-4 [&>*]:mb-4 [&>*]:break-inside-avoid">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40" />)}
            </div>
          ) : workerPlugins.length > 0 ? (
            <motion.div variants={staggerContainer} initial={false} animate="animate" className="columns-1 md:columns-2 lg:columns-3 gap-4 [&>*]:mb-4 [&>*]:break-inside-avoid">
              {workerPlugins.map((plugin) => {
                const Icon = ICON_MAP[plugin.icon] ?? Puzzle;
                const defs = getSettingDefs(plugin);
                const hasSettings = defs.length > 0;
                return (
                  <motion.div key={plugin.id} variants={staggerItem}>
                    <Card className="transition-colors">
                      <CardContent>
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                              <Icon className="h-5 w-5 text-primary" />
                            </div>
                            <div>
                              <h3 className="font-medium">{t(`plugins:plugins.${plugin.id}.name`, String(plugin.name))}</h3>
                              <p className="text-xs text-muted-foreground">{t('plugins:version')} {String(plugin.version)}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={plugin.is_enabled}
                              onCheckedChange={() => handleToggleIntegration(plugin)}
                            />
                          </div>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {t(`plugins:descriptions.${plugin.id}`, String(plugin.description))}
                        </p>
                        <div className="flex items-center gap-2 mt-3">
                          <Badge variant={plugin.is_enabled ? 'default' : 'secondary'}>
                            {plugin.is_enabled ? t('plugins:enabled') : t('plugins:disabled')}
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            {t(`plugins:runtimes.${plugin.runtime}`)}
                          </Badge>
                          {plugin.type && (
                            <Badge variant="outline" className="text-xs">
                              {plugin.type}
                            </Badge>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })}
            </motion.div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <Puzzle className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>{t('plugins:noPlugins')}</p>
              <p className="text-sm mt-1">{t('plugins:noPluginsDesc')}</p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="views">
          <div className="mb-4">
            <p className="text-sm text-muted-foreground">{t('plugins:views.description')}</p>
          </div>
          <motion.div variants={staggerContainer} initial={false} animate="animate" className="columns-1 md:columns-2 lg:columns-3 gap-4 [&>*]:mb-4 [&>*]:break-inside-avoid">
            {VIEWS.map((view) => {
              const Icon = ICON_MAP[view.icon] ?? Puzzle;
              const enabled = isFeatureEnabled(view.id);
              return (
                <motion.div key={view.id} variants={staggerItem}>
                  <Card>
                    <CardContent>
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                            <Icon className="h-5 w-5 text-primary" />
                          </div>
                          <div>
                            <h3 className="font-medium">{t(`plugins:featurePlugins.${view.id}.name`, view.name)}</h3>
                            <p className="text-xs text-muted-foreground">{t('plugins:views.title')}</p>
                          </div>
                        </div>
                        <Switch
                          checked={enabled}
                          onCheckedChange={() => handleToggleView(view)}
                        />
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {t(`plugins:featurePlugins.${view.id}.description`, '')}
                      </p>
                      <div className="flex items-center gap-2 mt-3">
                        <Badge variant={enabled ? 'default' : 'secondary'}>
                          {enabled ? t('plugins:enabled') : t('plugins:disabled')}
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </motion.div>
        </TabsContent>

        <TabsContent value="ai">
          <div className="mb-4">
            <p className="text-sm text-muted-foreground">{t('ai:subtitle')}</p>
          </div>
          <motion.div variants={staggerContainer} initial={false} animate="animate" className="columns-1 md:columns-2 gap-4 [&>*]:mb-4 [&>*]:break-inside-avoid">
            {AI_PLUGINS.map((mod) => {
              const Icon = ICON_MAP[mod.icon] ?? Puzzle;
              const enabled = isFeatureEnabled(mod.id);
              return (
                <motion.div key={mod.id} variants={staggerItem}>
                  <Card className={enabled ? 'border-purple-500/30 bg-purple-500/5' : ''}>
                    <CardContent>
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
                            <Icon className="h-5 w-5 text-purple-500" />
                          </div>
                          <div>
                            <h3 className="font-medium">{t(`ai:plugins.${mod.id === 'ai-rest-gateway' ? 'restName' : mod.id === 'ai-mcp-server' ? 'mcpName' : 'studioName'}`)}</h3>
                            <p className="text-xs text-muted-foreground">{t('ai:plugins.category')}</p>
                          </div>
                        </div>
                        <Switch checked={enabled} onCheckedChange={() => handleToggleAiPlugin(mod)} />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {t(`ai:plugins.${mod.id === 'ai-rest-gateway' ? 'restDesc' : mod.id === 'ai-mcp-server' ? 'mcpDesc' : 'studioDesc'}`)}
                      </p>
                      {enabled && (
                        <Badge variant="outline" className="mt-2 text-[10px] border-purple-500/30 text-purple-500">{t('ai:active')}</Badge>
                      )}
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </motion.div>
        </TabsContent>
      </Tabs>

      <Dialog open={!!selectedPlugin} onOpenChange={(o) => !o && setSelectedPlugin(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('plugins:settingsDialog.title')}: {selectedPlugin?.name}</DialogTitle>
            <DialogDescription>{t('plugins:settingsDialog.description')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 max-h-[60vh] overflow-y-auto">
            {selectedPlugin && (() => {
              const defs = getSettingDefs(selectedPlugin);
              if (defs.length === 0) {
                return <p className="text-muted-foreground text-sm">{t('plugins:settingsDialog.noSettings')}</p>;
              }
              return defs.map((setting) => (
                <div key={setting.key}>
                  <Label>
                    {t(`plugins:settingLabels.${selectedPlugin.id}.${setting.key}`, setting.label)}
                    {setting.required && <span className="text-destructive ml-1">*</span>}
                  </Label>
                  <Input
                    type={setting.type === 'password' || setting.sensitive ? 'password' : setting.type === 'number' ? 'number' : 'text'}
                    value={String(settingsForm[setting.key] ?? '')}
                    onChange={(e) => setSettingsForm({ ...settingsForm, [setting.key]: setting.type === 'number' ? Number(e.target.value) : e.target.value })}
                    placeholder={setting.placeholder ?? ''}
                    className="mt-1"
                  />
                </div>
              ));
            })()}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedPlugin(null)}>{t('common:actions.cancel')}</Button>
            <Button
              onClick={handleSaveSettings}
              disabled={enableMutation.isPending || updateSettingsMutation.isPending}
            >
              {selectedPlugin?.is_enabled ? t('plugins:saveSettings') : t('plugins:enable')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageWrapper>
  );
}
