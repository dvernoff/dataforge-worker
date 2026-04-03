import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Puzzle, Gamepad2, Send, Mail, MessageCircle, Cloud,
  HardDrive, Activity, KeyRound, Clock, Server, Shield,
  FileInput, Code, BarChart3, Search, Zap, LayoutDashboard,
  Braces, Archive, Wifi, Map, Play, Database as DatabaseIcon,
  Kanban, CalendarDays, Image, History, Webhook, Lock, Radio,
  Settings,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
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
  'gamepad-2': Gamepad2,
  'send': Send,
  'mail': Mail,
  'message-circle': MessageCircle,
  'cloud': Cloud,
  'hard-drive': HardDrive,
  'activity': Activity,
  'key-round': KeyRound,
  'clock': Clock,
  'server': Server,
  'shield': Shield,
  'chrome': KeyRound,
  'file-input': FileInput,
  'code': Code,
  'bar-chart-3': BarChart3,
  'search': Search,
  'zap': Zap,
  'layout-dashboard': LayoutDashboard,
  'braces': Braces,
  'archive': Archive,
  'wifi': Wifi,
  'map': Map,
  'play': Play,
  'database': DatabaseIcon,
  'kanban': Kanban,
  'calendar-days': CalendarDays,
  'image': Image,
  'history': History,
  'webhook': Webhook,
  'lock': Lock,
  'radio': Radio,
};

interface FeaturePlugin {
  id: string;
  name: string;
  icon: string;
  default_enabled: boolean;
  configurable?: boolean;
}

interface PluginCategory {
  key: string;
  plugins: FeaturePlugin[];
}

const PLUGIN_CATEGORIES: PluginCategory[] = [
  {
    key: 'functionality',
    plugins: [
      { id: 'feature-cron', name: 'Cron Jobs', icon: 'clock', default_enabled: true },
      { id: 'feature-flows', name: 'Flows', icon: 'zap', default_enabled: false },
      { id: 'feature-webhooks', name: 'Webhooks', icon: 'webhook', default_enabled: false },
      { id: 'feature-graphql', name: 'GraphQL', icon: 'braces', default_enabled: false, configurable: true },
      { id: 'feature-websocket', name: 'WebSocket', icon: 'radio', default_enabled: false, configurable: true },
      { id: 'feature-backups', name: 'Backups', icon: 'archive', default_enabled: true },
      { id: 'feature-secrets', name: 'Secrets', icon: 'lock', default_enabled: false },
    ],
  },
  {
    key: 'data',
    plugins: [
      { id: 'feature-query-builder', name: 'Query Builder', icon: 'search', default_enabled: true },
      { id: 'feature-analytics', name: 'Analytics', icon: 'bar-chart-3', default_enabled: true },
      { id: 'feature-data-pipeline', name: 'Data Pipeline', icon: 'database', default_enabled: false },
      { id: 'feature-db-map', name: 'DB Map', icon: 'map', default_enabled: false },
      { id: 'feature-time-travel', name: 'Time Travel', icon: 'history', default_enabled: false },
    ],
  },
  {
    key: 'views',
    plugins: [
      { id: 'feature-kanban', name: 'Kanban', icon: 'kanban', default_enabled: false },
      { id: 'feature-calendar', name: 'Calendar', icon: 'calendar-days', default_enabled: false },
      { id: 'feature-gallery', name: 'Gallery', icon: 'image', default_enabled: false },
      { id: 'feature-dashboards', name: 'Dashboards', icon: 'layout-dashboard', default_enabled: false },
    ],
  },
  {
    key: 'developer',
    plugins: [
      { id: 'feature-sdk', name: 'SDK', icon: 'code', default_enabled: false },
      { id: 'feature-api-playground', name: 'API Playground', icon: 'play', default_enabled: false },
    ],
  },
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

  const { data, isLoading } = useQuery({
    queryKey: ['plugins', project?.id],
    queryFn: () => pluginsApi.list(project!.id),
    enabled: !!project?.id,
  });

  const { data: cpData, isLoading: cpLoading } = useQuery({
    queryKey: ['cp-plugins'],
    queryFn: () => pluginsApi.listCpPlugins(),
  });

  const enableMutation = useMutation({
    mutationFn: ({ pluginId, settings }: { pluginId: string; settings: Record<string, unknown> }) =>
      pluginsApi.enable(project!.id, pluginId, settings),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plugins', project?.id] });
      toast.success(t('plugins:pluginEnabled'));
      setSelectedPlugin(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const disableMutation = useMutation({
    mutationFn: (pluginId: string) => pluginsApi.disable(project!.id, pluginId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plugins', project?.id] });
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
  const cpPlugins = (cpData?.plugins ?? []) as PluginData[];
  const { slug } = useParams<{ slug: string }>();
  const { isFeatureEnabled: _isFeatureEnabled, setFeatureEnabled: _setFeatureEnabled } = useFeaturesStore();
  const isFeatureEnabled = (id: string) => _isFeatureEnabled(slug, id);
  const setFeatureEnabled = (id: string, enabled: boolean) => { if (slug) _setFeatureEnabled(slug, id, enabled); };

  // Split worker plugins from the main list (worker runtime)
  const workerPlugins = plugins.filter((p) => p.runtime === 'worker');

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

  function getSettingDefs(plugin: PluginData): PluginSettingDef[] {
    if (Array.isArray(plugin.settings)) {
      return plugin.settings;
    }
    return [];
  }

  function handleSaveSettings() {
    if (!selectedPlugin) return;
    if (selectedPlugin.is_enabled) {
      updateSettingsMutation.mutate({ pluginId: selectedPlugin.id, settings: settingsForm });
    } else {
      enableMutation.mutate({ pluginId: selectedPlugin.id, settings: settingsForm });
    }
  }

  function handleToggle(plugin: PluginData) {
    const defs = getSettingDefs(plugin);
    if (plugin.is_enabled) {
      disableMutation.mutate(plugin.id);
    } else if (defs.length > 0) {
      openSettings(plugin);
    } else {
      enableMutation.mutate({ pluginId: plugin.id, settings: {} });
    }
  }

  function PluginCard({ plugin, showToggle = true, readonly = false }: { plugin: PluginData; showToggle?: boolean; readonly?: boolean }) {
    const Icon = ICON_MAP[plugin.icon] ?? Puzzle;
    const defs = getSettingDefs(plugin);
    const hasSettings = defs.length > 0;
    return (
      <motion.div variants={staggerItem}>
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
                {!readonly && hasSettings && (
                  <button
                    onClick={() => openSettings(plugin)}
                    className="h-8 w-8 rounded-md flex items-center justify-center hover:bg-muted transition-colors"
                    title={t('plugins:settings')}
                  >
                    <Settings className="h-4 w-4 text-muted-foreground" />
                  </button>
                )}
                {showToggle && (
                  <Switch
                    checked={plugin.is_enabled}
                    onCheckedChange={() => handleToggle(plugin)}
                  />
                )}
              </div>
            </div>
            <p className="text-sm text-muted-foreground ">
              {t(`plugins:descriptions.${plugin.id}`, String(plugin.description))}
            </p>
            <div className="flex items-center gap-2 mt-3">
              {showToggle && (
                <Badge variant={plugin.is_enabled ? 'default' : 'secondary'}>
                  {plugin.is_enabled ? t('plugins:enabled') : t('plugins:disabled')}
                </Badge>
              )}
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
  }

  return (
    <PageWrapper>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('plugins:pageTitle')}</h1>
      </div>

      {/* Features Section — always instant, no API call */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold mb-4">{t('plugins:features')}</h2>
        {PLUGIN_CATEGORIES.map((category) => (
          <div key={category.key} className="mb-6">
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">
              {t(`plugins:categories.${category.key}`)}
            </h3>
            <motion.div variants={staggerContainer} initial={false} animate="animate" className="columns-1 md:columns-2 lg:columns-3 gap-4 [&>*]:mb-4 [&>*]:break-inside-avoid">
              {category.plugins.map((fp) => {
                const Icon = ICON_MAP[fp.icon] ?? Puzzle;
                const enabled = isFeatureEnabled(fp.id);
                const configRoute = CONFIGURABLE_ROUTES[fp.id];
                return (
                  <motion.div key={fp.id} variants={staggerItem}>
                    <Card>
                      <CardContent>
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                              <Icon className="h-5 w-5 text-primary" />
                            </div>
                            <div>
                              <h3 className="font-medium">{t(`plugins:featurePlugins.${fp.id}.name`, fp.name)}</h3>
                              <p className="text-xs text-muted-foreground">{t('plugins:featureType')}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {fp.configurable && configRoute && slug && (
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
                              onCheckedChange={(checked) => setFeatureEnabled(fp.id, checked)}
                            />
                          </div>
                        </div>
                        <p className="text-sm text-muted-foreground ">
                          {t(`plugins:featurePlugins.${fp.id}.description`, '')}
                        </p>
                        <div className="flex items-center gap-2 mt-3">
                          <Badge variant={enabled ? 'default' : 'secondary'}>
                            {enabled ? t('plugins:enabled') : t('plugins:disabled')}
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            {t('plugins:featureType')}
                          </Badge>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })}
            </motion.div>
          </div>
        ))}
      </div>

      {/* Worker Plugins Section */}
      {isLoading ? (
        <div className="mb-8">
          <h2 className="text-lg font-semibold mb-4">{t('plugins:workerPlugins')}</h2>
          <div className="columns-1 md:columns-2 lg:columns-3 gap-4 [&>*]:mb-4 [&>*]:break-inside-avoid">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40" />)}
          </div>
        </div>
      ) : workerPlugins.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold mb-4">{t('plugins:workerPlugins')}</h2>
          <motion.div variants={staggerContainer} initial={false} animate="animate" className="columns-1 md:columns-2 lg:columns-3 gap-4 [&>*]:mb-4 [&>*]:break-inside-avoid">
            {workerPlugins.map((plugin) => (
              <PluginCard key={plugin.id} plugin={plugin} />
            ))}
          </motion.div>
        </div>
      )}

      {/* Control Plane Plugins Section */}
      {cpLoading ? (
        <div className="mb-8">
          <h2 className="text-lg font-semibold mb-4">{t('plugins:cpPlugins')}</h2>
          <div className="columns-1 md:columns-2 lg:columns-3 gap-4 [&>*]:mb-4 [&>*]:break-inside-avoid">
            {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-40" />)}
          </div>
        </div>
      ) : cpPlugins.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold mb-4">{t('plugins:cpPlugins')}</h2>
          <motion.div variants={staggerContainer} initial={false} animate="animate" className="columns-1 md:columns-2 lg:columns-3 gap-4 [&>*]:mb-4 [&>*]:break-inside-avoid">
            {cpPlugins.map((plugin) => (
              <PluginCard key={plugin.id} plugin={plugin} showToggle={false} readonly />
            ))}
          </motion.div>
        </div>
      )}

      {/* Settings Dialog */}
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
