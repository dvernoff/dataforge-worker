import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ZoomIn, ZoomOut, RotateCcw, Map } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { useCurrentProject } from '@/hooks/useProject';
import { api } from '@/api/client';
import { usePageTitle } from '@/hooks/usePageTitle';

interface TableNode {
  name: string;
  columns: { name: string; type: string; nullable: boolean }[];
  rowCount: number;
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

export function DBMapPage() {
  const { t } = useTranslation(['common']);
  usePageTitle(t('common:nav.dbMap'));
  const navigate = useNavigate();
  const { data: project } = useCurrentProject();
  const svgRef = useRef<SVGSVGElement>(null);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 50, y: 50 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [hoveredTable, setHoveredTable] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['db-map', project?.id],
    queryFn: () => api.get<DBMapData>(`/projects/${project!.id}/db-map`),
    enabled: !!project?.id,
  });

  const tables = data?.tables ?? [];
  const relationships = data?.relationships ?? [];

  // Calculate positions in a circular layout
  const positions = useMemo(() => {
    const pos: Record<string, { x: number; y: number }> = {};
    const count = tables.length;
    if (count === 0) return pos;

    const centerX = 500;
    const centerY = 400;
    const radius = Math.min(350, 100 + count * 30);

    tables.forEach((table, i) => {
      const angle = (2 * Math.PI * i) / count - Math.PI / 2;
      pos[table.name] = {
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle),
      };
    });
    return pos;
  }, [tables]);

  // Radius based on row count (min 30, max 70)
  const getRadius = useCallback((rowCount: number) => {
    if (rowCount === 0) return 30;
    return Math.min(70, 30 + Math.log10(rowCount + 1) * 10);
  }, []);

  // Mouse handlers for panning
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return;
    setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  }, [dragging, dragStart]);

  const handleMouseUp = useCallback(() => setDragging(false), []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoom((prev) => Math.max(0.3, Math.min(3, prev + delta)));
  }, []);

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 50, y: 50 });
  }, []);

  if (isLoading) {
    return (
      <PageWrapper>
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">{t('common:nav.dbMap')}</h1>
        </div>
        <Skeleton className="h-[600px] w-full" />
      </PageWrapper>
    );
  }

  return (
    <PageWrapper>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('common:nav.dbMap')}</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setZoom((z) => Math.min(3, z + 0.2))}>
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={() => setZoom((z) => Math.max(0.3, z - 0.2))}>
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={resetView}>
            <RotateCcw className="h-4 w-4" />
          </Button>
          <Badge variant="secondary">{tables.length} {t('common:nav.tables').toLowerCase()}</Badge>
        </div>
      </div>

      {tables.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Map className="h-12 w-12 text-muted-foreground mb-4" />
          <h2 className="text-lg font-medium mb-2">{t('common:actions.noData')}</h2>
          <p className="text-muted-foreground">{t('tables:noTablesDesc')}</p>
        </div>
      ) : (
        <Card className="overflow-hidden relative">
          <svg
            ref={svgRef}
            width="100%"
            height="600"
            className="cursor-grab active:cursor-grabbing select-none"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onWheel={handleWheel}
          >
            <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
              {/* FK relationship lines */}
              {relationships.map((rel, i) => {
                const from = positions[rel.sourceTable];
                const to = positions[rel.targetTable];
                if (!from || !to) return null;
                const isHighlighted = hoveredTable === rel.sourceTable || hoveredTable === rel.targetTable;
                return (
                  <line
                    key={i}
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    className={isHighlighted ? 'stroke-primary' : 'stroke-muted-foreground/30'}
                    strokeWidth={isHighlighted ? 2.5 : 1.5}
                    strokeDasharray={isHighlighted ? undefined : '6 3'}
                  />
                );
              })}

              {/* Table nodes */}
              {tables.map((table) => {
                const pos = positions[table.name];
                if (!pos) return null;
                const r = getRadius(table.rowCount);
                const isHovered = hoveredTable === table.name;

                return (
                  <g
                    key={table.name}
                    transform={`translate(${pos.x}, ${pos.y})`}
                    onMouseEnter={() => setHoveredTable(table.name)}
                    onMouseLeave={() => setHoveredTable(null)}
                    onClick={() => navigate(`/projects/${project?.slug}/tables/${table.name}/schema`)}
                    className="cursor-pointer"
                  >
                    <circle
                      r={r}
                      className={isHovered ? 'fill-primary stroke-primary' : 'fill-primary/20 stroke-primary/60'}
                      strokeWidth={isHovered ? 3 : 2}
                    />
                    <text
                      textAnchor="middle"
                      dy="-0.2em"
                      className={`text-xs font-mono ${isHovered ? 'fill-primary-foreground' : 'fill-foreground'}`}
                      style={{ fontSize: Math.max(10, Math.min(13, r / 3.5)) }}
                    >
                      {table.name}
                    </text>
                    <text
                      textAnchor="middle"
                      dy="1.2em"
                      className={`text-[10px] ${isHovered ? 'fill-primary-foreground/80' : 'fill-muted-foreground'}`}
                    >
                      {table.rowCount.toLocaleString()} rows
                    </text>

                    {/* Tooltip on hover */}
                    {isHovered && (
                      <foreignObject x={r + 8} y={-60} width={220} height={140}>
                        <div className="bg-popover border rounded-lg p-3 shadow-lg text-xs">
                          <p className="font-semibold font-mono mb-1">{table.name}</p>
                          <p className="text-muted-foreground mb-2">
                            {table.columns.length} columns, {table.rowCount.toLocaleString()} rows
                          </p>
                          <div className="space-y-0.5 max-h-[80px] overflow-y-auto">
                            {table.columns.slice(0, 8).map((col) => (
                              <div key={col.name} className="flex justify-between">
                                <span className="font-mono truncate">{col.name}</span>
                                <span className="text-muted-foreground ml-2">{col.type}</span>
                              </div>
                            ))}
                            {table.columns.length > 8 && (
                              <p className="text-muted-foreground">+{table.columns.length - 8} more</p>
                            )}
                          </div>
                        </div>
                      </foreignObject>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>
        </Card>
      )}
    </PageWrapper>
  );
}
