import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { getProjectColor } from '@/lib/project-colors';
import { useTranslation } from 'react-i18next';
import {
  PanelLeft, Table2, Database, Plug, Webhook, Terminal,
  ScrollText, Settings, Users, KeyRound, Key, Shield, Server,
  FolderKanban, UserCog, FileText, Globe, LogOut, ChevronDown, Archive,
  Braces, Code, Activity, AlertTriangle, BarChart3, Search,
  Clock, Zap, Puzzle, Lock, LayoutDashboard, BookOpen, Map, PlayCircle,
  GitBranch, HardDrive, Radio, Layers,
} from 'lucide-react';
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup,
  SidebarGroupContent, SidebarGroupLabel, SidebarHeader,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarSeparator,
} from '@/components/ui/sidebar';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ThemeToggle } from './ThemeToggle';
import { LanguageSwitcher } from './LanguageSwitcher';
import { useAuthStore } from '@/stores/auth.store';
import { useAuth } from '@/hooks/useAuth';
import { useProjects } from '@/hooks/useProject';
import { useFeaturesStore } from '@/stores/features.store';
import { User } from 'lucide-react';

export function AppSidebar() {
  const { slug } = useParams<{ slug: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { logout } = useAuth();
  const { data: projects } = useProjects();
  const { t } = useTranslation();

  const isSuperadmin = user?.is_superadmin ?? false;
  const basePath = slug ? `/projects/${slug}` : '';
  const { isFeatureEnabled } = useFeaturesStore();
  const checkFeature = (featureId: string) => isFeatureEnabled(slug, featureId);

  const mainNavAll = [
    { label: t('nav.dashboard'), icon: PanelLeft, path: `${basePath}/dashboard` },
    { label: t('nav.tables'), icon: Table2, path: `${basePath}/tables` },
    { label: t('nav.apiEndpoints'), icon: Plug, path: `${basePath}/endpoints` },
    { label: t('nav.apiDocs'), icon: BookOpen, path: `${basePath}/api-docs` },
    { label: t('nav.webhooks'), icon: Webhook, path: `${basePath}/webhooks`, featureId: 'feature-webhooks' },
    { label: t('nav.sqlConsole'), icon: Terminal, path: `${basePath}/sql` },
    { label: t('nav.graphql'), icon: Braces, path: `${basePath}/graphql`, featureId: 'feature-graphql' },
    { label: t('nav.websocket'), icon: Radio, path: `${basePath}/websocket`, featureId: 'feature-websocket' },
    { label: t('nav.sdk'), icon: Code, path: `${basePath}/sdk`, featureId: 'feature-sdk' },
    { label: t('nav.analytics'), icon: BarChart3, path: `${basePath}/analytics`, featureId: 'feature-analytics' },
    { label: t('nav.queryBuilder'), icon: Search, path: `${basePath}/query-builder`, featureId: 'feature-query-builder' },
    { label: t('nav.cron'), icon: Clock, path: `${basePath}/cron`, featureId: 'feature-cron' },
    { label: t('nav.flows'), icon: Zap, path: `${basePath}/flows`, featureId: 'feature-flows' },
    { label: t('nav.dashboards'), icon: LayoutDashboard, path: `${basePath}/dashboards`, featureId: 'feature-dashboards' },
    { label: t('nav.dbMap'), icon: Map, path: `${basePath}/db-map`, featureId: 'feature-db-map' },
    { label: t('nav.apiPlayground'), icon: PlayCircle, path: `${basePath}/api-playground`, featureId: 'feature-api-playground' },
    { label: t('nav.pipelines'), icon: GitBranch, path: `${basePath}/pipelines`, featureId: 'feature-data-pipeline' },
    { label: t('nav.auditLog'), icon: ScrollText, path: `${basePath}/audit` },
  ];

  const mainNav = mainNavAll.filter(
    (item) => !item.featureId || checkFeature(item.featureId),
  );

  const settingsNavAll: typeof mainNavAll = [
    { label: t('nav.users'), icon: Users, path: `${basePath}/settings/users` },
    { label: t('nav.inviteKeys'), icon: KeyRound, path: `${basePath}/settings/invites` },
    { label: t('nav.apiTokens'), icon: Key, path: `${basePath}/settings/tokens` },
    { label: t('nav.security'), icon: Shield, path: `${basePath}/settings/security` },
    { label: t('nav.backups'), icon: Archive, path: `${basePath}/settings/backups`, featureId: 'feature-backups' },
    { label: t('nav.secrets'), icon: Lock, path: `${basePath}/settings/secrets`, featureId: 'feature-secrets' },
    { label: t('nav.plugins'), icon: Puzzle, path: `${basePath}/settings/plugins` },
    { label: t('nav.projectSettings'), icon: Settings, path: `${basePath}/settings/project` },
  ];

  const settingsNav = settingsNavAll.filter(
    (item) => !item.featureId || checkFeature(item.featureId),
  );

  const personalNav: (typeof mainNavAll[number] & { exact?: boolean })[] = [
    { label: t('nav.myProjects'), icon: FolderKanban, path: '/', exact: true },
    { label: t('nav.profile'), icon: User, path: '/profile' },
    { label: t('nav.personalNodes'), icon: HardDrive, path: '/settings/my-nodes' },
  ];

  const systemNav = [
    { label: t('nav.nodes'), icon: Server, path: '/system/nodes' },
    { label: t('nav.allProjects'), icon: FolderKanban, path: '/system/projects' },
    { label: t('nav.allUsers'), icon: UserCog, path: '/system/users' },
    { label: t('nav.roles'), icon: Shield, path: '/system/roles' },
    { label: t('nav.projectPlans'), icon: Layers, path: '/system/project-plans' },
    { label: t('nav.systemLogs'), icon: FileText, path: '/system/logs' },
    { label: t('nav.health'), icon: Activity, path: '/system/health' },
    { label: t('nav.errors'), icon: AlertTriangle, path: '/system/errors' },
    { label: t('nav.globalSettings'), icon: Globe, path: '/system/settings' },
  ];

  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(path + '/');

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
        >
          <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
            <Database className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="font-semibold text-lg">DataForge</span>
        </button>

        {projects && projects.length > 0 && (
          <Select
            value={slug ?? '__all__'}
            onValueChange={(value) => {
              if (value === '__all__') {
                navigate('/');
              } else {
                navigate(`/projects/${value}/dashboard`);
              }
            }}
          >
            <SelectTrigger className="mt-3 w-full">
              <SelectValue placeholder={t('nav.allProjects')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t('nav.allProjects')}</SelectItem>
              {projects.map((p) => {
                const color = getProjectColor(p.name);
                return (
                  <SelectItem key={p.slug} value={p.slug}>
                    <div className="flex items-center gap-2">
                      <div
                        className="h-5 w-5 rounded flex items-center justify-center text-white text-[10px] font-bold shrink-0"
                        style={{ backgroundColor: color }}
                      >
                        {p.name.charAt(0).toUpperCase()}
                      </div>
                      {p.name}
                    </div>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        )}
      </SidebarHeader>

      <SidebarContent>
        {slug && (
          <>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  {mainNav.map((item) => (
                    <SidebarMenuItem key={item.label}>
                      <SidebarMenuButton
                        isActive={isActive(item.path)}
                        onClick={() => navigate(item.path)}
                      >
                        <item.icon className="h-4 w-4" />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            <SidebarSeparator />

            <SidebarGroup>
              <SidebarGroupLabel>{t('nav.settings')}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {settingsNav.map((item) => (
                    <SidebarMenuItem key={item.label}>
                      <SidebarMenuButton
                        isActive={isActive(item.path)}
                        onClick={() => navigate(item.path)}
                      >
                        <item.icon className="h-4 w-4" />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        )}

        <SidebarSeparator />
        <SidebarGroup className={slug ? 'opacity-60 hover:opacity-100 transition-opacity' : ''}>
          <SidebarGroupLabel>
            <User className="h-3 w-3 mr-1" />
            {t('nav.personal')}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {personalNav.map((item) => (
                <SidebarMenuItem key={item.path}>
                  <SidebarMenuButton
                    isActive={item.exact ? location.pathname === item.path : isActive(item.path)}
                    onClick={() => navigate(item.path)}
                  >
                    <item.icon className="h-4 w-4" />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {isSuperadmin && (
          <>
            <SidebarSeparator />
            <SidebarGroup className={slug ? 'opacity-60 hover:opacity-100 transition-opacity' : ''}>
              <SidebarGroupLabel>
                <Shield className="h-3 w-3 mr-1" />
                {t('nav.system')}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {systemNav.map((item) => (
                    <SidebarMenuItem key={item.label}>
                      <SidebarMenuButton
                        isActive={isActive(item.path)}
                        onClick={() => navigate(item.path)}
                      >
                        <item.icon className="h-4 w-4" />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        )}
      </SidebarContent>

      <SidebarFooter className="p-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={isActive('/docs')}
              onClick={() => navigate('/docs')}
            >
              <BookOpen className="h-4 w-4" />
              <span>{t('nav.docs')}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="flex items-center gap-1 mb-1">
          <ThemeToggle />
          <LanguageSwitcher />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 w-full p-2 rounded-md hover:bg-sidebar-accent transition-colors text-left">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-primary/20 text-primary text-xs">
                  {user?.name?.charAt(0).toUpperCase() ?? '?'}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{user?.name}</p>
                {isSuperadmin && (
                  <Badge variant="outline" className="text-[10px] px-1 py-0 border-orange-500/50 text-orange-500">
                    SUPERADMIN
                  </Badge>
                )}
              </div>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <div className="px-2 py-1.5">
              <p className="text-sm font-medium">{user?.name}</p>
              <p className="text-xs text-muted-foreground">{user?.email}</p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate('/profile')}>
              <User className="h-4 w-4 mr-2" />
              {t('nav.profile')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => logout()} className="text-destructive">
              <LogOut className="h-4 w-4 mr-2" />
              {t('logout')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
