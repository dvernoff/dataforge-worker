import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ZoomIn, ZoomOut, RotateCcw, Map, Search, Database,
  Table2, Columns3, Link2, HardDrive, Key, ArrowRight,
  X, ChevronRight, Eye,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { useCurrentProject } from '@/hooks/useProject';
import { api } from '@/api/client';
import { usePageTitle } from '@/hooks/usePageTitle';

interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
  maxLength: number | null;
}

interface IndexInfo {
  name: string;
  definition: string;
  isUnique: boolean;
}

interface TableNode {
  name: string;
  columns: ColumnInfo[];
  rowCount: number;
  totalSize: number;
  primaryKeys: string[];
  indexes: IndexInfo[];
}

interface Relationship {
  sourceTable: string;
  sourceColumn: string;
  targetTable: string;
  targetColumn: string;
  constraintName: string;
}

interface DBMapData {
  tables: TableNode[];
  relationships: Relationship[];
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

const NODE_W = 230;
const NODE_H = 200;
const CARD_COLS_VISIBLE = 5;

export function DBMapPage() {
  const { t } = useTranslation(['common', 'tables']);
  usePageTitle(t('common:nav.dbMap'));
  const navigate = useNavigate();
  const { data: project } = useCurrentProject();
  const svgRef = useRef<SVGSVGElement>(null);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [hoveredTable, setHoveredTable] = useState<string | null>(null);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['db-map', project?.id],
    queryFn: () => api.get<DBMapData>(`/projects/${project!.id}/db-map`),
    enabled: !!project?.id,
  });

  const tables = data?.tables ?? [];
  const relationships = data?.relationships ?? [];

  const filteredTables = useMemo(() => {
    if (!searchQuery.trim()) return tables;
    const q = searchQuery.toLowerCase();
    return tables.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.columns.some((c) => c.name.toLowerCase().includes(q)),
    );
  }, [tables, searchQuery]);

  const stats = useMemo(() => {
    const totalRows = tables.reduce((sum, t) => sum + t.rowCount, 0);
    const totalSize = tables.reduce((sum, t) => sum + t.totalSize, 0);
    const totalCols = tables.reduce((sum, t) => sum + t.columns.length, 0);
    return { totalRows, totalSize, totalCols, totalTables: tables.length, totalRelationships: relationships.length };
  }, [tables, relationships]);

  const tableRelationshipCount = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const rel of relationships) {
      counts[rel.sourceTable] = (counts[rel.sourceTable] ?? 0) + 1;
      counts[rel.targetTable] = (counts[rel.targetTable] ?? 0) + 1;
    }
    return counts;
  }, [relationships]);

  const positions = useMemo(() => {
    const pos: Record<string, { x: number; y: number }> = {};
    const count = filteredTables.length;
    if (count === 0) return pos;

    const spacingX = NODE_W + 80;
    const spacingY = NODE_H + 60;

    const adjacency: Record<string, Set<string>> = {};
    for (const t of filteredTables) adjacency[t.name] = new Set();
    for (const rel of relationships) {
      if (adjacency[rel.sourceTable] && adjacency[rel.targetTable]) {
        adjacency[rel.sourceTable].add(rel.targetTable);
        adjacency[rel.targetTable].add(rel.sourceTable);
      }
    }

    const placed = new Set<string>();
    const queue: string[] = [];

    const sorted = [...filteredTables].sort(
      (a, b) => (tableRelationshipCount[b.name] ?? 0) - (tableRelationshipCount[a.name] ?? 0),
    );

    let clusterX = 60;
    let clusterY = 60;

    for (const seed of sorted) {
      if (placed.has(seed.name)) continue;

      const cluster: string[] = [];
      const bfs = [seed.name];
      while (bfs.length > 0) {
        const current = bfs.shift()!;
        if (placed.has(current)) continue;
        placed.add(current);
        cluster.push(current);
        for (const neighbor of adjacency[current] ?? []) {
          if (!placed.has(neighbor)) bfs.push(neighbor);
        }
      }

      if (cluster.length === 1) {
        queue.push(cluster[0]);
        continue;
      }

      const clusterCols = Math.min(cluster.length, Math.ceil(Math.sqrt(cluster.length * 1.2)));
      cluster.forEach((name, i) => {
        const row = Math.floor(i / clusterCols);
        const col = i % clusterCols;
        pos[name] = {
          x: clusterX + col * spacingX,
          y: clusterY + row * spacingY,
        };
      });

      const clusterRows = Math.ceil(cluster.length / clusterCols);
      clusterX += clusterCols * spacingX + 60;

      if (clusterX > spacingX * 4) {
        clusterX = 60;
        clusterY += clusterRows * spacingY + 40;
      }
    }

    if (queue.length > 0) {
      if (Object.keys(pos).length > 0) {
        clusterY = Math.max(...Object.values(pos).map((p) => p.y)) + spacingY + 30;
        clusterX = 60;
      }

      const orphanCols = Math.min(queue.length, Math.ceil(Math.sqrt(queue.length * 2)));
      queue.forEach((name, i) => {
        const row = Math.floor(i / orphanCols);
        const col = i % orphanCols;
        const offsetX = row % 2 === 1 ? spacingX * 0.4 : 0;
        pos[name] = {
          x: clusterX + col * spacingX + offsetX,
          y: clusterY + row * spacingY,
        };
      });
    }
    return pos;
  }, [filteredTables, tableRelationshipCount, relationships]);

  const canvasBounds = useMemo(() => {
    const vals = Object.values(positions);
    if (vals.length === 0) return { minX: 0, minY: 0, w: 1000, h: 600 };
    const minX = Math.min(...vals.map((p) => p.x));
    const minY = Math.min(...vals.map((p) => p.y));
    const maxX = Math.max(...vals.map((p) => p.x)) + NODE_W;
    const maxY = Math.max(...vals.map((p) => p.y)) + NODE_H;
    return { minX, minY, w: maxX - minX + 80, h: maxY - minY + 80 };
  }, [positions]);
  const canvasSize = canvasBounds;

  const getTableRelationships = useCallback(
    (tableName: string) =>
      relationships.filter((r) => r.sourceTable === tableName || r.targetTable === tableName),
    [relationships],
  );

  const selectedTableData = useMemo(
    () => (selectedTable ? tables.find((t) => t.name === selectedTable) : null),
    [tables, selectedTable],
  );

  const selectedTableRels = useMemo(
    () => (selectedTable ? getTableRelationships(selectedTable) : []),
    [selectedTable, getTableRelationships],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest('[data-table-card]')) return;
      setDragging(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    },
    [pan],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dragging) return;
      setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
    },
    [dragging, dragStart],
  );

  const handleMouseUp = useCallback(() => setDragging(false), []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoom((prev) => Math.max(0.2, Math.min(3, prev + delta)));
  }, []);

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const fitToScreen = useCallback(() => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const pad = 40;
    const contentW = canvasBounds.w + pad * 2;
    const contentH = canvasBounds.h + pad * 2;
    const scaleX = rect.width / contentW;
    const scaleY = rect.height / contentH;
    const newZoom = Math.max(0.4, Math.min(scaleX, scaleY, 1.2));
    setZoom(newZoom);
    setPan({
      x: (rect.width - contentW * newZoom) / 2 - (canvasBounds.minX - pad) * newZoom,
      y: (rect.height - contentH * newZoom) / 2 - (canvasBounds.minY - pad) * newZoom,
    });
  }, [canvasBounds]);

  // Auto-fit on first data load
  const hasFitted = useRef(false);
  useEffect(() => {
    if (tables.length > 0 && svgRef.current && !hasFitted.current) {
      hasFitted.current = true;
      requestAnimationFrame(() => fitToScreen());
    }
  }, [tables, fitToScreen]);

  if (isLoading) {
    return (
      <PageWrapper>
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold">{t('common:nav.dbMap')}</h1>
        </div>
        <div className="grid grid-cols-4 gap-3 mb-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
        <Skeleton className="h-[500px] w-full" />
      </PageWrapper>
    );
  }

  if (tables.length === 0) {
    return (
      <PageWrapper>
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold">{t('common:nav.dbMap')}</h1>
        </div>
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Map className="h-12 w-12 text-muted-foreground mb-4" />
          <h2 className="text-lg font-medium mb-2">{t('common:actions.noData')}</h2>
          <p className="text-muted-foreground">{t('tables:noTablesDesc')}</p>
        </div>
      </PageWrapper>
    );
  }

  return (
    <PageWrapper className="!p-0 flex flex-col h-[calc(100vh-4rem)]">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-background/80 backdrop-blur-sm shrink-0">
        <h1 className="text-lg font-bold">{t('common:nav.dbMap')}</h1>
        <div className="flex items-center gap-2">
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setZoom((z) => Math.min(3, z + 0.2))}>
                  <ZoomIn className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Zoom In</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setZoom((z) => Math.max(0.2, z - 0.2))}>
                  <ZoomOut className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Zoom Out</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={fitToScreen}>
                  <Eye className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Fit to Screen</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={resetView}>
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Reset View</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Separator orientation="vertical" className="h-6" />
          <Badge variant="outline" className="text-xs gap-1">
            <span className="font-mono">{Math.round(zoom * 100)}%</span>
          </Badge>
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-5 gap-2 px-4 py-2 border-b bg-card/50 shrink-0">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-background/60">
          <Table2 className="h-3.5 w-3.5 text-primary" />
          <div className="text-xs">
            <span className="text-muted-foreground">Tables</span>
            <span className="ml-1.5 font-semibold font-mono">{stats.totalTables}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-background/60">
          <Columns3 className="h-3.5 w-3.5 text-blue-400" />
          <div className="text-xs">
            <span className="text-muted-foreground">Columns</span>
            <span className="ml-1.5 font-semibold font-mono">{stats.totalCols}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-background/60">
          <Database className="h-3.5 w-3.5 text-amber-400" />
          <div className="text-xs">
            <span className="text-muted-foreground">Rows</span>
            <span className="ml-1.5 font-semibold font-mono">{formatNumber(stats.totalRows)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-background/60">
          <Link2 className="h-3.5 w-3.5 text-purple-400" />
          <div className="text-xs">
            <span className="text-muted-foreground">Relations</span>
            <span className="ml-1.5 font-semibold font-mono">{stats.totalRelationships}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-background/60">
          <HardDrive className="h-3.5 w-3.5 text-emerald-400" />
          <div className="text-xs">
            <span className="text-muted-foreground">Size</span>
            <span className="ml-1.5 font-semibold font-mono">{formatBytes(stats.totalSize)}</span>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 min-h-0">
        {/* Left sidebar */}
        <div
          className={`border-r bg-card/30 flex flex-col shrink-0 transition-all duration-200 ${
            sidebarCollapsed ? 'w-10' : 'w-64'
          }`}
        >
          {sidebarCollapsed ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 mx-auto mt-2"
              onClick={() => setSidebarCollapsed(false)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          ) : (
            <>
              <div className="p-2 border-b flex items-center gap-1">
                <div className="relative flex-1">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={t('common:actions.search')}
                    className="h-8 pl-7 text-xs"
                  />
                  {searchQuery && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute right-0.5 top-1/2 -translate-y-1/2 h-6 w-6"
                      onClick={() => setSearchQuery('')}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => setSidebarCollapsed(true)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
              <ScrollArea className="flex-1">
                <div className="p-1.5 space-y-0.5">
                  {filteredTables.map((table) => {
                    const relCount = tableRelationshipCount[table.name] ?? 0;
                    const isActive = selectedTable === table.name;
                    const isHovered = hoveredTable === table.name;
                    return (
                      <button
                        key={table.name}
                        className={`w-full text-left px-2.5 py-2 rounded-md text-xs transition-colors ${
                          isActive
                            ? 'bg-primary/15 text-primary'
                            : isHovered
                              ? 'bg-accent'
                              : 'hover:bg-accent/50'
                        }`}
                        onClick={() => setSelectedTable(table.name === selectedTable ? null : table.name)}
                        onMouseEnter={() => setHoveredTable(table.name)}
                        onMouseLeave={() => setHoveredTable(null)}
                      >
                        <div className="font-mono font-medium truncate">{table.name}</div>
                        <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground">
                          <span>{table.columns.length} col</span>
                          <span>{formatNumber(table.rowCount)} rows</span>
                          {relCount > 0 && <span>{relCount} FK</span>}
                          <span className="ml-auto">{formatBytes(table.totalSize)}</span>
                        </div>
                      </button>
                    );
                  })}
                  {filteredTables.length === 0 && searchQuery && (
                    <div className="text-center py-6 text-xs text-muted-foreground">
                      No tables match "{searchQuery}"
                    </div>
                  )}
                </div>
              </ScrollArea>
              <div className="px-3 py-2 border-t text-[10px] text-muted-foreground">
                {filteredTables.length} / {tables.length} tables
              </div>
            </>
          )}
        </div>

        {/* Canvas */}
        <div className="flex-1 relative overflow-hidden bg-[radial-gradient(circle_at_50%_50%,hsl(var(--card))_0%,hsl(var(--background))_100%)]">
          {/* Grid pattern background */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-[0.04]">
            <defs>
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
          </svg>

          <svg
            ref={svgRef}
            className="absolute inset-0 w-full h-full cursor-grab active:cursor-grabbing select-none"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onWheel={handleWheel}
          >
            <defs>
              <marker
                id="arrowhead"
                markerWidth="8"
                markerHeight="6"
                refX="8"
                refY="3"
                orient="auto"
              >
                <polygon points="0 0, 8 3, 0 6" className="fill-muted-foreground/40" />
              </marker>
              <marker
                id="arrowhead-active"
                markerWidth="8"
                markerHeight="6"
                refX="8"
                refY="3"
                orient="auto"
              >
                <polygon points="0 0, 8 3, 0 6" className="fill-primary" />
              </marker>
              <filter id="card-shadow" x="-10%" y="-10%" width="120%" height="130%">
                <feDropShadow dx="0" dy="2" stdDeviation="4" floodOpacity="0.3" />
              </filter>
              <filter id="card-glow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="0" stdDeviation="8" floodColor="hsl(142,71%,45%)" floodOpacity="0.3" />
              </filter>
            </defs>

            <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
              {/* Relationship lines */}
              {relationships.map((rel, i) => {
                const from = positions[rel.sourceTable];
                const to = positions[rel.targetTable];
                if (!from || !to) return null;

                const isHighlighted =
                  hoveredTable === rel.sourceTable ||
                  hoveredTable === rel.targetTable ||
                  selectedTable === rel.sourceTable ||
                  selectedTable === rel.targetTable;

                const fromCx = from.x + NODE_W / 2;
                const fromCy = from.y + NODE_H / 2;
                const toCx = to.x + NODE_W / 2;
                const toCy = to.y + NODE_H / 2;

                const dx = toCx - fromCx;
                const dy = toCy - fromCy;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist === 0) return null;

                const nx = dx / dist;
                const ny = dy / dist;

                const startX = fromCx + nx * (NODE_W / 2 + 4);
                const startY = fromCy + ny * (NODE_H / 2 + 4);
                const endX = toCx - nx * (NODE_W / 2 + 12);
                const endY = toCy - ny * (NODE_H / 2 + 12);

                const midX = (startX + endX) / 2;
                const midY = (startY + endY) / 2;
                const cpx = midX + ny * 30;
                const cpy = midY - nx * 30;

                return (
                  <path
                    key={i}
                    d={`M ${startX} ${startY} Q ${cpx} ${cpy} ${endX} ${endY}`}
                    fill="none"
                    className={isHighlighted ? 'stroke-primary' : 'stroke-muted-foreground/20'}
                    strokeWidth={isHighlighted ? 2.5 : 1}
                    strokeDasharray={isHighlighted ? undefined : '6 4'}
                    markerEnd={isHighlighted ? 'url(#arrowhead-active)' : 'url(#arrowhead)'}
                  />
                );
              })}

              {/* Table cards */}
              {filteredTables.map((table) => {
                const pos = positions[table.name];
                if (!pos) return null;
                const isHovered = hoveredTable === table.name;
                const isSelected = selectedTable === table.name;
                const isActive = isHovered || isSelected;
                const relCount = tableRelationshipCount[table.name] ?? 0;
                const hasPK = table.primaryKeys && table.primaryKeys.length > 0;

                return (
                  <g key={table.name} transform={`translate(${pos.x}, ${pos.y})`}>
                    <foreignObject
                      width={NODE_W}
                      height={NODE_H}
                      data-table-card
                      onMouseEnter={() => setHoveredTable(table.name)}
                      onMouseLeave={() => setHoveredTable(null)}
                      onClick={() => setSelectedTable(table.name === selectedTable ? null : table.name)}
                      className="cursor-pointer"
                    >
                      <div
                        className={`h-full rounded-lg border transition-all duration-150 overflow-hidden ${
                          isActive
                            ? 'border-primary bg-card shadow-lg shadow-primary/10'
                            : 'border-border/60 bg-card/90 hover:border-border'
                        }`}
                      >
                        {/* Card header */}
                        <div
                          className={`px-3 py-2 border-b flex items-center gap-2 ${
                            isActive ? 'bg-primary/10 border-primary/20' : 'bg-muted/30 border-border/40'
                          }`}
                        >
                          <Table2 className={`h-3.5 w-3.5 shrink-0 ${isActive ? 'text-primary' : 'text-muted-foreground'}`} />
                          <span className="font-mono text-xs font-semibold truncate flex-1">{table.name}</span>
                          {hasPK && (
                            <Key className="h-3 w-3 text-amber-400 shrink-0" />
                          )}
                        </div>

                        {/* Card body */}
                        <div className="px-3 py-2 space-y-1.5">
                          {/* Stats row */}
                          <div className="flex items-center justify-between text-[10px]">
                            <span className="text-muted-foreground">
                              {table.columns.length} columns
                            </span>
                            <span className={`font-mono font-medium ${table.rowCount > 0 ? 'text-foreground' : 'text-muted-foreground'}`}>
                              {formatNumber(table.rowCount)} rows
                            </span>
                          </div>

                          {/* Mini columns preview */}
                          <div className="space-y-0.5">
                            {table.columns.slice(0, CARD_COLS_VISIBLE).map((col) => {
                              const isPK = table.primaryKeys?.includes(col.name);
                              return (
                                <div key={col.name} className="flex items-center gap-1 text-[9px]">
                                  {isPK && <Key className="h-2.5 w-2.5 text-amber-400 shrink-0" />}
                                  <span className={`font-mono truncate ${isPK ? 'text-amber-300' : 'text-muted-foreground'}`}>
                                    {col.name}
                                  </span>
                                  <span className="text-muted-foreground/50 ml-auto shrink-0">{col.type}</span>
                                </div>
                              );
                            })}
                            {table.columns.length > CARD_COLS_VISIBLE && (
                              <div className="text-[9px] text-muted-foreground/50">
                                +{table.columns.length - CARD_COLS_VISIBLE} more
                              </div>
                            )}
                          </div>

                          {/* Footer badges */}
                          <div className="flex items-center gap-1 pt-0.5">
                            {relCount > 0 && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400">
                                {relCount} FK
                              </span>
                            )}
                            <span className="text-[9px] text-muted-foreground/50 ml-auto">
                              {formatBytes(table.totalSize)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </foreignObject>
                  </g>
                );
              })}

              {/* Relationship labels (rendered last = on top of everything) */}
              {relationships.map((rel, i) => {
                const from = positions[rel.sourceTable];
                const to = positions[rel.targetTable];
                if (!from || !to) return null;

                const isHighlighted =
                  hoveredTable === rel.sourceTable ||
                  hoveredTable === rel.targetTable ||
                  selectedTable === rel.sourceTable ||
                  selectedTable === rel.targetTable;

                if (!isHighlighted) return null;

                const fromCx = from.x + NODE_W / 2;
                const fromCy = from.y + NODE_H / 2;
                const toCx = to.x + NODE_W / 2;
                const toCy = to.y + NODE_H / 2;

                const midX = (fromCx + toCx) / 2;
                const midY = (fromCy + toCy) / 2;

                const dx = toCx - fromCx;
                const dy = toCy - fromCy;
                const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                const ny = dy / dist;
                const nx = dx / dist;
                const labelX = midX + ny * 30;
                const labelY = midY - nx * 30;

                const label = `${rel.sourceColumn} → ${rel.targetColumn}`;

                return (
                  <g key={`label-${i}`}>
                    <rect
                      x={labelX - label.length * 3.2 - 6}
                      y={labelY - 18}
                      width={label.length * 6.4 + 12}
                      height={22}
                      rx={4}
                      className="fill-card stroke-primary/40"
                      strokeWidth={1}
                    />
                    <text
                      x={labelX}
                      y={labelY - 4}
                      textAnchor="middle"
                      className="fill-primary text-[10px] font-mono font-medium"
                    >
                      {label}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        </div>
      </div>

      {/* Detail Sheet */}
      <Sheet open={!!selectedTableData} onOpenChange={(open) => { if (!open) setSelectedTable(null); }}>
        <SheetContent className="w-[420px] sm:w-[480px] overflow-y-auto">
          {selectedTableData && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <Table2 className="h-5 w-5 text-primary" />
                  <span className="font-mono">{selectedTableData.name}</span>
                </SheetTitle>
              </SheetHeader>

              <div className="mt-6 space-y-6">
                {/* Stats cards */}
                <div className="grid grid-cols-3 gap-2">
                  <Card className="p-3 text-center">
                    <div className="text-lg font-bold font-mono">{formatNumber(selectedTableData.rowCount)}</div>
                    <div className="text-[10px] text-muted-foreground">Rows</div>
                  </Card>
                  <Card className="p-3 text-center">
                    <div className="text-lg font-bold font-mono">{selectedTableData.columns.length}</div>
                    <div className="text-[10px] text-muted-foreground">Columns</div>
                  </Card>
                  <Card className="p-3 text-center">
                    <div className="text-lg font-bold font-mono">{formatBytes(selectedTableData.totalSize)}</div>
                    <div className="text-[10px] text-muted-foreground">Size</div>
                  </Card>
                </div>

                {/* Primary keys */}
                {selectedTableData.primaryKeys && selectedTableData.primaryKeys.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <Key className="h-3 w-3 text-amber-400" />
                      Primary Key
                    </h4>
                    <div className="flex flex-wrap gap-1">
                      {selectedTableData.primaryKeys.map((pk) => (
                        <Badge key={pk} variant="outline" className="font-mono text-xs text-amber-300 border-amber-500/30">
                          {pk}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Columns */}
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Columns3 className="h-3 w-3 text-blue-400" />
                    Columns ({selectedTableData.columns.length})
                  </h4>
                  <div className="rounded-md border overflow-hidden">
                    <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 px-3 py-1.5 bg-muted/30 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider border-b">
                      <span>Name</span>
                      <span>Type</span>
                      <span>Null</span>
                    </div>
                    <ScrollArea className="max-h-[240px]">
                      {selectedTableData.columns.map((col, i) => {
                        const isPK = selectedTableData.primaryKeys?.includes(col.name);
                        const isFK = relationships.some(
                          (r) =>
                            (r.sourceTable === selectedTable && r.sourceColumn === col.name) ||
                            (r.targetTable === selectedTable && r.targetColumn === col.name),
                        );
                        return (
                          <div
                            key={col.name}
                            className={`grid grid-cols-[1fr_auto_auto] gap-x-3 px-3 py-1.5 text-xs ${
                              i % 2 === 0 ? 'bg-transparent' : 'bg-muted/10'
                            }`}
                          >
                            <div className="flex items-center gap-1.5 font-mono truncate">
                              {isPK && <Key className="h-3 w-3 text-amber-400 shrink-0" />}
                              {isFK && !isPK && <Link2 className="h-3 w-3 text-purple-400 shrink-0" />}
                              <span className={isPK ? 'text-amber-300' : isFK ? 'text-purple-300' : ''}>{col.name}</span>
                            </div>
                            <span className="text-muted-foreground font-mono">
                              {col.type}
                              {col.maxLength ? `(${col.maxLength})` : ''}
                            </span>
                            <span className={col.nullable ? 'text-muted-foreground/50' : 'text-emerald-400'}>
                              {col.nullable ? 'YES' : 'NO'}
                            </span>
                          </div>
                        );
                      })}
                    </ScrollArea>
                  </div>
                </div>

                {/* Relationships */}
                {selectedTableRels.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <Link2 className="h-3 w-3 text-purple-400" />
                      Foreign Keys ({selectedTableRels.length})
                    </h4>
                    <div className="space-y-1.5">
                      {selectedTableRels.map((rel) => {
                        const isOutgoing = rel.sourceTable === selectedTable;
                        return (
                          <Card
                            key={rel.constraintName}
                            className="p-2.5 cursor-pointer hover:border-primary/40 transition-colors"
                            onClick={() => setSelectedTable(isOutgoing ? rel.targetTable : rel.sourceTable)}
                          >
                            <div className="flex items-center gap-2 text-xs">
                              <Badge
                                variant="outline"
                                className={`text-[10px] shrink-0 ${
                                  isOutgoing
                                    ? 'border-orange-500/30 text-orange-400'
                                    : 'border-blue-500/30 text-blue-400'
                                }`}
                              >
                                {isOutgoing ? 'OUT' : 'IN'}
                              </Badge>
                              <span className="font-mono text-muted-foreground">{rel.sourceColumn}</span>
                              <ArrowRight className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                              <span className="font-mono font-medium text-primary">
                                {isOutgoing ? rel.targetTable : rel.sourceTable}
                              </span>
                              <span className="font-mono text-muted-foreground">.{rel.targetColumn}</span>
                            </div>
                          </Card>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Indexes */}
                {selectedTableData.indexes && selectedTableData.indexes.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                      Indexes ({selectedTableData.indexes.length})
                    </h4>
                    <div className="space-y-1">
                      {selectedTableData.indexes.map((idx) => (
                        <div key={idx.name} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded bg-muted/20">
                          {idx.isUnique && (
                            <Badge variant="outline" className="text-[9px] border-amber-500/30 text-amber-400">
                              UNIQUE
                            </Badge>
                          )}
                          <span className="font-mono text-muted-foreground truncate">{idx.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Navigate button */}
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={() => navigate(`/projects/${project?.slug}/tables/${selectedTableData.name}/schema`)}
                >
                  <Table2 className="h-4 w-4 mr-2" />
                  Open Table Schema
                </Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </PageWrapper>
  );
}
