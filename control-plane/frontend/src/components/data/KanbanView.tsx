import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { cn } from '@/lib/utils';

const COL_WIDTH = 270;
const GAP = 12;

interface KanbanPagination {
  page: number;
  totalPages: number;
  total: number;
  limit: number;
}

interface KanbanViewProps {
  rows: Record<string, unknown>[];
  columns: { name: string; type: string }[];
  pagination?: KanbanPagination;
  onPageChange?: (page: number) => void;
}

export function KanbanView({ rows, columns, pagination, onPageChange }: KanbanViewProps) {
  const { t } = useTranslation('data');
  const containerRef = useRef<HTMLDivElement>(null);
  const [visibleCols, setVisibleCols] = useState(4);
  const [colOffset, setColOffset] = useState(0);

  const statusColumns = useMemo(
    () => columns.filter((c) => ['text', 'character varying', 'varchar'].includes(c.type)),
    [columns],
  );

  const [groupByColumn, setGroupByColumn] = useState(statusColumns[0]?.name ?? '');

  const groups = useMemo(() => {
    if (!groupByColumn) return {};
    const map: Record<string, Record<string, unknown>[]> = {};
    for (const row of rows) {
      const val = String(row[groupByColumn] ?? t('views.kanban.noValue'));
      if (!map[val]) map[val] = [];
      map[val].push(row);
    }
    return map;
  }, [rows, groupByColumn, t]);

  const displayColumns = columns
    .filter(
      (c) =>
        !['id', 'created_at', 'updated_at', 'deleted_at'].includes(c.name) &&
        c.name !== groupByColumn,
    )
    .slice(0, 3);

  const groupEntries = Object.entries(groups);

  useEffect(() => {
    const measure = () => {
      if (!containerRef.current) return;
      const w = containerRef.current.offsetWidth;
      const cols = Math.max(1, Math.floor((w + GAP) / (COL_WIDTH + GAP)));
      setVisibleCols(cols);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    setColOffset(0);
  }, [groupByColumn]);

  const maxOffset = Math.max(0, groupEntries.length - visibleCols);
  const safeOffset = Math.min(colOffset, maxOffset);
  const visibleGroups = groupEntries.slice(safeOffset, safeOffset + visibleCols);
  const canGoLeft = safeOffset > 0;
  const canGoRight = safeOffset < maxOffset;

  if (statusColumns.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p>{t('views.kanban.noStatusColumn')}</p>
      </div>
    );
  }

  const from = pagination ? (pagination.page - 1) * pagination.limit + 1 : 1;
  const to = pagination ? Math.min(pagination.page * pagination.limit, pagination.total) : rows.length;

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Label>{t('views.kanban.groupBy')}</Label>
          <Select value={groupByColumn} onValueChange={setGroupByColumn}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statusColumns.map((c) => (
                <SelectItem key={c.name} value={c.name}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">
            {groupEntries.length} {groupEntries.length === 1 ? 'group' : 'groups'}
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* Pagination */}
          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {t('showing', { from, to, total: pagination.total.toLocaleString() })}
              </span>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  disabled={pagination.page <= 1}
                  onClick={() => onPageChange?.(pagination.page - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  disabled={pagination.page >= pagination.totalPages}
                  onClick={() => onPageChange?.(pagination.page + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Board navigation */}
      {groupEntries.length > visibleCols && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              disabled={!canGoLeft}
              onClick={() => setColOffset(0)}
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              disabled={!canGoLeft}
              onClick={() => setColOffset(Math.max(0, safeOffset - 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </div>
          <span className="text-xs text-muted-foreground">
            {safeOffset + 1}–{Math.min(safeOffset + visibleCols, groupEntries.length)} / {groupEntries.length}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              disabled={!canGoRight}
              onClick={() => setColOffset(Math.min(maxOffset, safeOffset + 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              disabled={!canGoRight}
              onClick={() => setColOffset(maxOffset)}
            >
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Board columns */}
      <div ref={containerRef} className="grid gap-3" style={{ gridTemplateColumns: `repeat(${visibleCols}, minmax(0, 1fr))` }}>
        {visibleGroups.map(([groupName, groupRows]) => (
          <div
            key={groupName}
            className="flex flex-col rounded-lg border bg-muted/20 min-w-0"
          >
            {/* Column header */}
            <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b bg-muted/40 rounded-t-lg">
              <h3 className="font-medium text-sm truncate" title={groupName}>
                {groupName}
              </h3>
              <Badge variant="secondary" className="text-xs shrink-0">
                {groupRows.length}
              </Badge>
            </div>

            {/* Cards */}
            <div
              className="p-2 space-y-2 overflow-y-auto"
              style={{ maxHeight: 'calc(70vh - 200px)' }}
            >
              {groupRows.map((row) => (
                <div
                  key={String(row.id)}
                  className={cn(
                    'rounded-md border bg-card p-3 shadow-sm',
                    'hover:shadow-md hover:border-primary/30 transition-all cursor-pointer',
                  )}
                >
                  <p className="font-mono text-[11px] text-muted-foreground mb-1.5">
                    #{String(row.id).slice(0, 8)}
                  </p>
                  {displayColumns.map((col) => (
                    <div key={col.name} className="flex items-baseline justify-between gap-2 text-xs mt-1">
                      <span className="text-muted-foreground shrink-0">{col.name}:</span>
                      <span
                        className="font-mono truncate text-right max-w-[140px]"
                        title={String(row[col.name] ?? '')}
                      >
                        {row[col.name] === null ? (
                          <span className="text-muted-foreground italic">NULL</span>
                        ) : (
                          String(row[col.name])
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
