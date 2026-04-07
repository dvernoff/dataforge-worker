import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Search, Download, Upload, Trash2, RefreshCw, Wand2, MessageSquare, Clock,
  Table2, Columns, Calendar, Image, Pencil, Key,
} from 'lucide-react';
import { SeedingDialog } from '@/components/data/SeedingDialog';
import { TimeTravelPanel } from '@/components/data/TimeTravelPanel';
import { KanbanView } from '@/components/data/KanbanView';
import { CalendarView } from '@/components/data/CalendarView';
import { GalleryView } from '@/components/data/GalleryView';
import { useFeaturesStore } from '@/stores/features.store';
import {
  useReactTable, getCoreRowModel, type ColumnDef,
  flexRender,
} from '@tanstack/react-table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { useCurrentProject } from '@/hooks/useProject';
import { schemaApi, type ColumnInfo } from '@/api/schema.api';
import { dataApi } from '@/api/data.api';
import { api } from '@/api/client';
import { toast } from 'sonner';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores/auth.store';
import { showErrorToast } from '@/lib/show-error-toast';

export function DataBrowserPage() {
  const { t } = useTranslation(['data', 'common']);
  usePageTitle(t('data:pageTitle'));
  const { slug, name: tableName } = useParams<{ slug: string; name: string }>();
  const navigate = useNavigate();
  const { data: project } = useCurrentProject();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [sort, setSort] = useState<string>('created_at');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Debounce search — wait 350ms after user stops typing
  useEffect(() => {
    debounceRef.current = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 350);
    return () => clearTimeout(debounceRef.current);
  }, [searchInput]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [editingCell, setEditingCell] = useState<{ rowId: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [seedingOpen, setSeedingOpen] = useState(false);
  const [timeTravelOpen, setTimeTravelOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'table' | 'kanban' | 'calendar' | 'gallery'>('table');
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkEditField, setBulkEditField] = useState('');
  const [bulkEditValue, setBulkEditValue] = useState('');
  const [commentRecordId, setCommentRecordId] = useState<string | null>(null);
  const [newComment, setNewComment] = useState('');
  const [expandedCells, setExpandedCells] = useState<Set<string>>(new Set());
  const { user } = useAuthStore();
  const { isFeatureEnabled: _isFeatureEnabled } = useFeaturesStore();
  const isFeatureEnabled = (id: string) => _isFeatureEnabled(slug, id);

  // Get table schema
  const { data: tableData } = useQuery({
    queryKey: ['table', project?.id, tableName],
    queryFn: () => schemaApi.getTable(project!.id, tableName!),
    enabled: !!project?.id && !!tableName,
    staleTime: 60_000,
  });

  // Get data
  const { data: response, isLoading } = useQuery({
    queryKey: ['data', project?.id, tableName, page, limit, sort, order, search],
    queryFn: () => dataApi.list(project!.id, tableName!, {
      page, limit, sort, order,
      search: search || undefined,
    }),
    enabled: !!project?.id && !!tableName,
    staleTime: 5_000,
    refetchOnMount: 'always',
  });

  const TAIL_COLUMNS = new Set(['created_at', 'updated_at', 'deleted_at']);
  const rawColumns = tableData?.table.columns ?? [];
  // Order: id first, then user columns, then timestamps at the end
  const columns = useMemo(() => {
    const id = rawColumns.filter(c => c.name === 'id');
    const user = rawColumns.filter(c => c.name !== 'id' && !TAIL_COLUMNS.has(c.name));
    const tail = rawColumns.filter(c => TAIL_COLUMNS.has(c.name));
    return [...id, ...user, ...tail];
  }, [rawColumns]);
  const rows = response?.data ?? [];
  const pagination = response?.pagination;

  const techTypes = new Set(['uuid', 'timestamp', 'timestamptz', 'timestamp without time zone', 'timestamp with time zone']);
  const isTechColumn = (col: ColumnInfo) => techTypes.has(col.type.toLowerCase());

  const shortTypeName: Record<string, string> = {
    'timestamp with time zone': 'timestamptz',
    'timestamp without time zone': 'timestamp',
    'character varying': 'varchar',
    'double precision': 'float8',
    'boolean': 'bool',
    'integer': 'int4',
    'bigint': 'int8',
    'smallint': 'int2',
  };
  const displayType = (type: string) => shortTypeName[type.toLowerCase()] ?? type;

  // Inline edit mutation
  const updateFieldMutation = useMutation({
    mutationFn: ({ id, field, value }: { id: string; field: string; value: unknown }) =>
      dataApi.updateField(project!.id, tableName!, id, field, value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['data', project?.id, tableName] });
      setEditingCell(null);
    },
    onError: (err: Error) => showErrorToast(err),
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: () => dataApi.bulkDelete(project!.id, tableName!, Array.from(selectedIds)),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['data', project?.id, tableName] });
      toast.success(t('data:delete.deleted', { count: result.deleted }));
      setSelectedIds(new Set());
      setDeleteConfirmOpen(false);
    },
    onError: (err: Error) => showErrorToast(err),
  });

  // Bulk update mutation
  const bulkUpdateMutation = useMutation({
    mutationFn: ({ field, value }: { field: string; value: unknown }) =>
      dataApi.bulkUpdate(project!.id, tableName!, Array.from(selectedIds), field, value),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['data', project?.id, tableName] });
      toast.success(t('data:bulkEdit.success', { count: result.updated }));
      setSelectedIds(new Set());
      setBulkEditOpen(false);
      setBulkEditField('');
      setBulkEditValue('');
    },
    onError: (err: Error) => showErrorToast(err),
  });

  // Comments
  const { data: commentsData } = useQuery({
    queryKey: ['comments', project?.id, tableName, commentRecordId],
    queryFn: () => api.get<{ comments: { id: string; user_name: string; content: string; created_at: string }[] }>(
      `/projects/${project!.id}/tables/${tableName}/data/${commentRecordId}/comments`
    ),
    enabled: !!project?.id && !!tableName && !!commentRecordId,
  });

  // Comment counts for visual indicators
  const { data: commentCountsData } = useQuery({
    queryKey: ['comment-counts', project?.id, tableName],
    queryFn: () => api.get<{ counts: Record<string, number> }>(
      `/projects/${project!.id}/tables/${tableName}/comments/counts`
    ),
    enabled: !!project?.id && !!tableName,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const commentCounts = commentCountsData?.counts ?? {};

  const addCommentMutation = useMutation({
    mutationFn: (content: string) => api.post(
      `/projects/${project!.id}/tables/${tableName}/data/${commentRecordId}/comments`,
      { content, user_name: user?.name ?? 'User' }
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comments', project?.id, tableName, commentRecordId] });
      queryClient.invalidateQueries({ queryKey: ['comment-counts', project?.id, tableName] });
      setNewComment('');
      toast.success(t('data:comments.posted'));
    },
    onError: (err: Error) => showErrorToast(err),
  });

  const deleteCommentMutation = useMutation({
    mutationFn: (commentId: string) => api.delete(
      `/projects/${project!.id}/tables/${tableName}/data/${commentRecordId}/comments/${commentId}`
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comments', project?.id, tableName, commentRecordId] });
      queryClient.invalidateQueries({ queryKey: ['comment-counts', project?.id, tableName] });
      toast.success(t('data:comments.deleted'));
    },
    onError: (err: Error) => showErrorToast(err),
  });

  // Export
  const handleExport = useCallback(async (format: 'json' | 'csv') => {
    try {
      const result = await dataApi.export(project!.id, tableName!);
      let content: string;
      let mimeType: string;
      let ext: string;

      if (format === 'json') {
        content = JSON.stringify(result.records, null, 2);
        mimeType = 'application/json';
        ext = 'json';
      } else {
        if (result.records.length === 0) {
          toast.error(t('data:export.noData'));
          return;
        }
        const headers = Object.keys(result.records[0]);
        const csvRows = [
          headers.join(','),
          ...result.records.map((r) =>
            headers.map((h) => {
              const val = r[h];
              if (val === null || val === undefined) return '';
              const str = String(val);
              return str.includes(',') || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str;
            }).join(',')
          ),
        ];
        content = csvRows.join('\n');
        mimeType = 'text/csv';
        ext = 'csv';
      }

      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${tableName}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t('data:export.success', { format: format.toUpperCase() }));
    } catch (err) {
      toast.error((err as Error).message);
    }
  }, [project?.id, tableName]);

  // Cell value renderer
  function renderCellValue(value: unknown, type: string): string {
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'object') return JSON.stringify(value);
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    const str = String(value);
    // Shorten UUIDs: show first 8 chars + "…"
    if (type.toLowerCase() === 'uuid' && str.length >= 32) return str.substring(0, 8) + '…';
    // Shorten timestamps: show date + time without seconds/ms
    if (techTypes.has(type.toLowerCase()) && str.length > 16) {
      const d = new Date(str);
      if (!isNaN(d.getTime())) return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
    }
    return str;
  }

  const readOnlyFields = ['id', 'created_at', 'updated_at', 'deleted_at'];

  function handleCellClick(rowId: string, field: string, currentValue: unknown) {
    if (readOnlyFields.includes(field)) return;
    // Don't re-enter edit if already editing this cell
    if (editingCell?.rowId === rowId && editingCell?.field === field) return;
    setEditingCell({ rowId, field });
    setEditValue(currentValue === null ? '' : String(currentValue));
  }

  function handleCellSave() {
    if (!editingCell) return;
    let parsedValue: unknown = editValue;
    // Try to parse JSON for jsonb columns
    if (editValue.startsWith('{') || editValue.startsWith('[')) {
      try { parsedValue = JSON.parse(editValue); } catch { /* keep as string */ }
    }
    // Parse booleans
    if (editValue === 'true') parsedValue = true;
    if (editValue === 'false') parsedValue = false;
    // Parse null
    if (editValue === '' || editValue === 'NULL') parsedValue = null;

    updateFieldMutation.mutate({
      id: editingCell.rowId,
      field: editingCell.field,
      value: parsedValue,
    });
  }

  function toggleRow(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selectedIds.size === rows.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(rows.map((r) => String(r.id))));
    }
  }

  const basePath = `/projects/${slug}`;

  return (
    <PageWrapper>
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold font-mono">{tableName}</h1>
          {pagination && (
            <Badge variant="secondary">{pagination.total.toLocaleString()} {t('data:records')}</Badge>
          )}
          <div className="flex items-center gap-1 ml-2 border rounded-md p-0.5">
            <Button variant="secondary" size="sm" className="h-7 text-xs">
              {t('tables:tabs.data')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => navigate(`${basePath}/tables/${tableName}/schema`)}
            >
              {t('tables:tabs.columns')}
            </Button>
          </div>
        </div>
        <Button onClick={() => navigate(`${basePath}/tables/${tableName}/records/new`)}>
          <Plus className="h-4 w-4 mr-2" />
          {t('data:newRecord')}
        </Button>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t('data:search')}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-9"
          />
        </div>

        <Select value={String(limit)} onValueChange={(v) => { setLimit(Number(v)); setPage(1); }}>
          <SelectTrigger className="w-20">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[25, 50, 100].map((n) => (
              <SelectItem key={n} value={String(n)}>{n}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Download className="h-4 w-4 mr-1" />
              {t('data:export.button')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={() => handleExport('csv')}>CSV</DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleExport('json')}>JSON</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate(`${basePath}/tables/${tableName}/import`)}
        >
          <Upload className="h-4 w-4 mr-1" />
          {t('data:import.button')}
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setSeedingOpen(true)}
        >
          <Wand2 className="h-4 w-4 mr-1" />
          {t('data:seeding.title')}
        </Button>


        {isFeatureEnabled('feature-time-travel') && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setTimeTravelOpen(!timeTravelOpen)}
          >
            <Clock className="h-4 w-4 mr-1" />
            {t('data:timeTravel.button')}
          </Button>
        )}

        {selectedIds.size > 0 && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setBulkEditOpen(true)}
            >
              <Pencil className="h-4 w-4 mr-1" />
              {t('data:bulkEdit.button')}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setDeleteConfirmOpen(true)}
            >
              <Trash2 className="h-4 w-4 mr-1" />
              {t('data:delete.button', { count: selectedIds.size })}
            </Button>
          </>
        )}

        <Button
          variant="ghost"
          size="icon"
          onClick={() => queryClient.invalidateQueries({ queryKey: ['data', project?.id, tableName] })}
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* View mode switcher */}
      <div className="flex items-center gap-1 mb-4">
        <Button
          variant={viewMode === 'table' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setViewMode('table')}
        >
          <Table2 className="h-4 w-4 mr-1" />
          {t('data:views.table')}
        </Button>
        {isFeatureEnabled('feature-kanban') && (
          <Button
            variant={viewMode === 'kanban' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setViewMode('kanban')}
          >
            <Columns className="h-4 w-4 mr-1" />
            {t('data:views.kanban')}
          </Button>
        )}
        {isFeatureEnabled('feature-calendar') && (
          <Button
            variant={viewMode === 'calendar' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setViewMode('calendar')}
          >
            <Calendar className="h-4 w-4 mr-1" />
            {t('data:views.calendar')}
          </Button>
        )}
        {isFeatureEnabled('feature-gallery') && (
          <Button
            variant={viewMode === 'gallery' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setViewMode('gallery')}
          >
            <Image className="h-4 w-4 mr-1" />
            {t('data:views.gallery')}
          </Button>
        )}
      </div>

      {/* Time Travel Panel */}
      {timeTravelOpen && project?.id && tableName && (
        <div className="mb-4">
          <TimeTravelPanel
            projectId={project.id}
            tableName={tableName}
            columns={columns}
            onClose={() => setTimeTravelOpen(false)}
          />
        </div>
      )}

      {/* Alternative Views */}
      {viewMode === 'kanban' && !isLoading && (
        <KanbanView rows={rows} columns={columns} />
      )}
      {viewMode === 'calendar' && !isLoading && (
        <CalendarView rows={rows} columns={columns} />
      )}
      {viewMode === 'gallery' && !isLoading && (
        <GalleryView rows={rows} columns={columns} />
      )}

      {/* Data Table */}
      {viewMode === 'table' && isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      ) : viewMode === 'table' ? (
        <div className="border rounded-lg overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={rows.length > 0 && selectedIds.size === rows.length}
                    onCheckedChange={toggleAll}
                  />
                </TableHead>
                <TableHead className="w-10"></TableHead>
                {columns.map((col) => (
                  <TableHead
                    key={col.name}
                    className="cursor-pointer hover:bg-muted/50 whitespace-nowrap"
                    onClick={() => {
                      if (sort === col.name) {
                        setOrder(order === 'asc' ? 'desc' : 'asc');
                      } else {
                        setSort(col.name);
                        setOrder('asc');
                      }
                    }}
                  >
                    <div className="flex items-center gap-1.5">
                      {col.is_primary && <Key className="h-3 w-3 text-amber-500 shrink-0" />}
                      <span className="font-mono text-xs font-medium">{col.name}</span>
                      <span className="text-[10px] text-muted-foreground">{displayType(col.type)}</span>
                      {sort === col.name && (
                        <span className="text-xs text-muted-foreground">{order === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </div>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns.length + 1} className="text-center py-8 text-muted-foreground">
                    {t('data:noRecords')}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => {
                  const rowId = String(row.id);
                  return (
                    <TableRow key={rowId} className={selectedIds.has(rowId) ? 'bg-muted/30' : ''}>
                      <TableCell>
                        <Checkbox
                          checked={selectedIds.has(rowId)}
                          onCheckedChange={() => toggleRow(rowId)}
                        />
                      </TableCell>
                      <TableCell className="w-10">
                        <Button
                          variant="ghost"
                          size="icon"
                          className={`h-6 w-6 relative ${commentCounts[rowId] ? 'text-primary' : ''}`}
                          onClick={() => setCommentRecordId(rowId)}
                          title={t('data:comments.title')}
                        >
                          <MessageSquare className={`h-3 w-3 ${commentCounts[rowId] ? 'fill-primary' : ''}`} />
                          {commentCounts[rowId] > 0 && (
                            <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-[9px] font-bold rounded-full min-w-[14px] h-[14px] flex items-center justify-center px-0.5">
                              {commentCounts[rowId]}
                            </span>
                          )}
                        </Button>
                      </TableCell>
                      {columns.map((col) => {
                        const value = row[col.name];
                        const isEditing = editingCell?.rowId === rowId && editingCell?.field === col.name;
                        const isTech = isTechColumn(col);
                        const cellKey = `${rowId}:${col.name}`;
                        const isExpanded = expandedCells.has(cellKey);

                        return (
                          <TableCell
                            key={col.name}
                            className={`${isTech ? 'max-w-[100px]' : 'max-w-[250px]'} truncate font-mono text-xs ${isTech ? 'text-muted-foreground cursor-pointer hover:text-foreground' : ''} ${!isTech && !readOnlyFields.includes(col.name) ? 'cursor-pointer hover:bg-muted/30' : ''}`}
                            onClick={() => {
                              if (isTech) {
                                setExpandedCells((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(cellKey)) next.delete(cellKey); else next.add(cellKey);
                                  return next;
                                });
                              } else {
                                handleCellClick(rowId, col.name, value);
                              }
                            }}
                          >
                            {isEditing ? (
                              <Input
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleCellSave();
                                  if (e.key === 'Escape') setEditingCell(null);
                                }}
                                onBlur={handleCellSave}
                                autoFocus
                                className="h-7 text-xs font-mono"
                              />
                            ) : (
                              <span
                                className={value === null ? 'text-muted-foreground italic' : ''}
                                title={value != null && isTech ? String(value) : undefined}
                              >
                                {isTech && !isExpanded ? renderCellValue(value, col.type) : (value === null ? 'NULL' : String(value))}
                              </span>
                            )}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      ) : null}

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <span className="text-sm text-muted-foreground">
            {t('data:showing', { from: ((page - 1) * limit) + 1, to: Math.min(page * limit, pagination.total), total: pagination.total.toLocaleString() })}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              {t('common:pagination.previous')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= pagination.totalPages}
              onClick={() => setPage(page + 1)}
            >
              {t('common:pagination.next')}
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title={t('data:delete.title')}
        description={t('data:delete.desc', { count: selectedIds.size })}
        confirmText={t('common:actions.delete')}
        variant="destructive"
        onConfirm={() => deleteMutation.mutate()}
        loading={deleteMutation.isPending}
      />

      {project?.id && tableName && (
        <SeedingDialog
          open={seedingOpen}
          onOpenChange={setSeedingOpen}
          projectId={project.id}
          tableName={tableName}
          columns={columns}
        />
      )}

      {/* Bulk Edit Dialog */}
      <Dialog open={bulkEditOpen} onOpenChange={(open) => { if (!open) { setBulkEditOpen(false); setBulkEditField(''); setBulkEditValue(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('data:bulkEdit.title')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>{t('data:bulkEdit.field')}</Label>
              <Select value={bulkEditField} onValueChange={setBulkEditField}>
                <SelectTrigger>
                  <SelectValue placeholder={t('data:bulkEdit.field')} />
                </SelectTrigger>
                <SelectContent>
                  {columns
                    .filter((col) => !['id', 'created_at', 'updated_at', 'deleted_at'].includes(col.name))
                    .map((col) => (
                      <SelectItem key={col.name} value={col.name}>{col.name}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t('data:bulkEdit.value')}</Label>
              <Input
                value={bulkEditValue}
                onChange={(e) => setBulkEditValue(e.target.value)}
                placeholder={t('data:bulkEdit.value')}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                if (!bulkEditField) return;
                let parsedValue: unknown = bulkEditValue;
                if (bulkEditValue.startsWith('{') || bulkEditValue.startsWith('[')) {
                  try { parsedValue = JSON.parse(bulkEditValue); } catch { /* keep as string */ }
                }
                if (bulkEditValue === 'true') parsedValue = true;
                if (bulkEditValue === 'false') parsedValue = false;
                if (bulkEditValue === '' || bulkEditValue === 'NULL') parsedValue = null;
                bulkUpdateMutation.mutate({ field: bulkEditField, value: parsedValue });
              }}
              disabled={!bulkEditField || bulkUpdateMutation.isPending}
            >
              {bulkUpdateMutation.isPending
                ? t('data:bulkEdit.apply', { count: selectedIds.size })
                : t('data:bulkEdit.apply', { count: selectedIds.size })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Comments Sheet */}
      <Sheet open={commentRecordId !== null} onOpenChange={(open) => { if (!open) setCommentRecordId(null); }}>
        <SheetContent className="flex flex-col">
          <SheetHeader>
            <SheetTitle>{t('data:comments.title')}</SheetTitle>
          </SheetHeader>
          <ScrollArea className="flex-1 my-4">
            <div className="space-y-3">
              {commentsData?.comments && commentsData.comments.length > 0 ? (
                commentsData.comments.map((c) => (
                  <div key={c.id} className="flex gap-2 group">
                    <Avatar className="h-7 w-7 shrink-0">
                      <AvatarFallback className="text-[10px] bg-primary/20 text-primary">
                        {c.user_name.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{c.user_name}</span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(c.created_at).toLocaleString()}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 opacity-0 group-hover:opacity-100"
                          onClick={() => deleteCommentMutation.mutate(c.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                      <p className="text-sm mt-0.5 whitespace-pre-wrap">{c.content}</p>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">{t('data:comments.noComments')}</p>
              )}
            </div>
          </ScrollArea>
          <div className="flex gap-2">
            <Textarea
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder={t('data:comments.addComment')}
              className="flex-1 min-h-[60px]"
            />
            <Button
              size="sm"
              className="self-end"
              disabled={!newComment.trim() || addCommentMutation.isPending}
              onClick={() => addCommentMutation.mutate(newComment.trim())}
            >
              {addCommentMutation.isPending ? t('data:comments.submitting') : t('data:comments.submit')}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </PageWrapper>
  );
}
