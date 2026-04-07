import { useState, useMemo, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Plug, MoreHorizontal, Pencil, Trash2, Copy, Link, Table2, Code, ChevronDown, Search, ChevronsUpDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Skeleton } from '@/components/ui/skeleton';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { useCurrentProject } from '@/hooks/useProject';
import { endpointsApi } from '@/api/endpoints.api';
import { HTTP_METHOD_COLORS } from '@/lib/constants';
import { toast } from 'sonner';
import { usePageTitle } from '@/hooks/usePageTitle';
import { getProjectColor } from '@/lib/project-colors';

interface EndpointGroup {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  endpoints: Record<string, unknown>[];
}

// Persist open/closed state per group in sessionStorage
function getStorageKey(projectSlug: string | undefined) {
  return `df-ep-groups:${projectSlug ?? ''}`;
}

function loadOpenGroups(projectSlug: string | undefined): Set<string> {
  try {
    const raw = sessionStorage.getItem(getStorageKey(projectSlug));
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch { /* ignore */ }
  return new Set(); // empty = all open by default (handled via defaultOpen logic)
}

function saveOpenGroups(projectSlug: string | undefined, groups: Set<string>) {
  sessionStorage.setItem(getStorageKey(projectSlug), JSON.stringify([...groups]));
}

export function EndpointsListPage() {
  const { t } = useTranslation(['api', 'common']);
  usePageTitle(t('api:pageTitle'));
  const navigate = useNavigate();
  const { data: project } = useCurrentProject();
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  // Track which groups are explicitly closed (default = all open)
  const [closedGroups, setClosedGroups] = useState<Set<string>>(new Set());
  const slug = project?.slug;

  // Load saved state when project slug is available
  useEffect(() => {
    if (slug) setClosedGroups(loadOpenGroups(slug));
  }, [slug]);

  const toggleGroup = useCallback((key: string, open: boolean) => {
    setClosedGroups((prev) => {
      const next = new Set(prev);
      if (open) {
        next.delete(key);
      } else {
        next.add(key);
      }
      if (slug) saveOpenGroups(slug, next);
      return next;
    });
  }, [slug]);

  const { data, isLoading } = useQuery({
    queryKey: ['endpoints', project?.id],
    queryFn: () => endpointsApi.list(project!.id),
    enabled: !!project?.id,
  });

  const toggleMutation = useMutation({
    mutationFn: (id: string) => endpointsApi.toggle(project!.id, id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['endpoints', project?.id] }); queryClient.invalidateQueries({ queryKey: ['openapi-spec', project?.id] }); },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => endpointsApi.delete(project!.id, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['endpoints', project?.id] });
      queryClient.invalidateQueries({ queryKey: ['openapi-spec', project?.id] });
      toast.success(t('api:endpointDeleted'));
      setDeleteTarget(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const versionMutation = useMutation({
    mutationFn: (id: string) => endpointsApi.createVersion(project!.id, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['endpoints', project?.id] });
      queryClient.invalidateQueries({ queryKey: ['openapi-spec', project?.id] });
      toast.success(t('api:versioning.versionCreated'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const endpoints = data?.endpoints ?? [];
  const basePath = `/projects/${project?.slug}`;

  // Filter + group endpoints by table name
  const groups = useMemo((): EndpointGroup[] => {
    const q = search.toLowerCase();
    const filtered = q
      ? endpoints.filter((ep) => {
          const path = String(ep.path ?? '').toLowerCase();
          const method = String(ep.method ?? '').toLowerCase();
          const desc = String(ep.description ?? '').toLowerCase();
          return path.includes(q) || method.includes(q) || desc.includes(q);
        })
      : endpoints;

    const tableMap = new Map<string, Record<string, unknown>[]>();
    const custom: Record<string, unknown>[] = [];

    for (const ep of filtered) {
      const sourceConfig = (typeof ep.source_config === 'string' ? JSON.parse(ep.source_config as string) : ep.source_config) as Record<string, unknown> | null;
      const tableName = ep.source_type === 'table' && sourceConfig?.table
        ? String(sourceConfig.table)
        : null;

      if (tableName) {
        const list = tableMap.get(tableName) ?? [];
        list.push(ep);
        tableMap.set(tableName, list);
      } else {
        custom.push(ep);
      }
    }

    const result: EndpointGroup[] = [];
    for (const [table, eps] of [...tableMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      result.push({ key: table, label: table, icon: Table2, endpoints: eps });
    }
    if (custom.length > 0) {
      result.push({ key: '__custom__', label: 'Custom', icon: Code, endpoints: custom });
    }
    return result;
  }, [endpoints, search]);

  const allClosed = groups.length > 0 && groups.every((g) => closedGroups.has(g.key));

  function toggleAll() {
    if (allClosed) {
      setClosedGroups(new Set());
      if (slug) saveOpenGroups(slug, new Set());
    } else {
      const all = new Set(groups.map((g) => g.key));
      setClosedGroups(all);
      if (slug) saveOpenGroups(slug, all);
    }
  }

  function renderEndpointRow(ep: Record<string, unknown>) {
    return (
      <TableRow key={ep.id as string} className="cursor-pointer group/row" onClick={() => navigate(`${basePath}/endpoints/${ep.id}`)}>
        <TableCell>
          <Badge className={HTTP_METHOD_COLORS[ep.method as string] ?? ''} variant="outline">
            {ep.method as string}
          </Badge>
        </TableCell>
        <TableCell className="font-mono text-sm">
          <div className="flex items-center gap-1.5">
            <span>{ep.path as string}</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0 opacity-0 group-hover/row:opacity-100 transition-opacity"
              onClick={(e) => {
                e.stopPropagation();
                const baseUrl = project?.node_url?.replace(/\/$/, '') ?? window.location.origin;
                const fullUrl = `${baseUrl}/api/v1/${project?.slug}${ep.path}`;
                navigator.clipboard.writeText(fullUrl);
                toast.success(t('api:urlCopied'));
              }}
            >
              <Link className="h-3 w-3" />
            </Button>
          </div>
        </TableCell>
        <TableCell className="text-muted-foreground text-sm max-w-[200px] truncate">
          {(ep.description as string) ?? '—'}
        </TableCell>
        <TableCell>
          <Badge variant="outline">{ep.auth_type as string}</Badge>
        </TableCell>
        <TableCell onClick={(e) => e.stopPropagation()}>
          <Switch
            checked={ep.is_active as boolean}
            onCheckedChange={() => toggleMutation.mutate(ep.id as string)}
          />
        </TableCell>
        <TableCell onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => navigate(`${basePath}/endpoints/${ep.id}`)}>
                <Pencil className="h-4 w-4 mr-2" />{t('common:actions.edit')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => versionMutation.mutate(ep.id as string)}>
                <Copy className="h-4 w-4 mr-2" />{t('api:versioning.createNew')}
              </DropdownMenuItem>
              <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(ep.id as string)}>
                <Trash2 className="h-4 w-4 mr-2" />{t('common:actions.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <PageWrapper>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">{t('api:pageTitle')}</h1>
        <Button onClick={() => navigate(`${basePath}/endpoints/new`)}>
          <Plus className="h-4 w-4 mr-2" />
          {t('api:createEndpoint')}
        </Button>
      </div>

      {endpoints.length > 0 && (
        <div className="flex items-center gap-2 mb-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('common:actions.search')}
              className="w-full h-8 pl-8 pr-3 rounded-md border border-input bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <Button variant="ghost" size="sm" className="h-8 text-xs gap-1" onClick={toggleAll}>
            <ChevronsUpDown className="h-3.5 w-3.5" />
            {allClosed ? t('api:expandAll') : t('api:collapseAll')}
          </Button>
          <Badge variant="secondary" className="text-xs">{endpoints.length}</Badge>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
        </div>
      ) : endpoints.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Plug className="h-12 w-12 text-muted-foreground mb-4" />
          <h2 className="text-lg font-medium mb-2">{t('api:noEndpoints')}</h2>
          <p className="text-muted-foreground mb-4">{t('api:noEndpointsDesc')}</p>
          <Button onClick={() => navigate(`${basePath}/endpoints/new`)}>
            <Plus className="h-4 w-4 mr-2" />
            {t('api:createEndpoint')}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => (
            <Collapsible
              key={group.key}
              open={!closedGroups.has(group.key)}
              onOpenChange={(open) => toggleGroup(group.key, open)}
            >
              <Card>
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-2 w-full px-4 py-3 text-left hover:bg-muted/50 transition-colors"
                  >
                    <div
                      className="h-6 w-6 rounded flex items-center justify-center text-white font-bold text-[10px] shrink-0"
                      style={{ backgroundColor: getProjectColor(group.label) }}
                    >
                      {group.label.charAt(0).toUpperCase()}
                    </div>
                    <span className="font-medium text-sm">{group.label}</span>
                    <Badge variant="secondary" className="text-[10px] px-1.5 h-5 ml-1">
                      {group.endpoints.length}
                    </Badge>
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground ml-auto transition-transform [[data-state=open]_&]:rotate-180" />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-24">{t('api:headers.method')}</TableHead>
                        <TableHead>{t('api:headers.path')}</TableHead>
                        <TableHead>{t('api:headers.description')}</TableHead>
                        <TableHead>{t('api:headers.auth')}</TableHead>
                        <TableHead>{t('api:headers.status')}</TableHead>
                        <TableHead className="w-12" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {group.endpoints.map(renderEndpointRow)}
                    </TableBody>
                  </Table>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={t('api:deleteConfirm.title')}
        description={t('api:deleteConfirm.desc')}
        confirmText={t('common:actions.delete')}
        variant="destructive"
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
        loading={deleteMutation.isPending}
      />
    </PageWrapper>
  );
}
