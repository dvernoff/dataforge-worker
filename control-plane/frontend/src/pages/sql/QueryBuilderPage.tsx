import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  Play, Plus, Trash2, Filter, TableProperties,
  Link2, Search, PenLine, SquarePlus, AlertTriangle,
  Database, Columns3, ArrowDownUp, Hash, Copy, Check,
  Zap, ArrowRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { useCurrentProject } from '@/hooks/useProject';
import { usePageTitle } from '@/hooks/usePageTitle';
import { api } from '@/api/client';
import { toast } from 'sonner';

type QueryType = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
type NodeId = 'table' | 'columns' | 'joins' | 'filter' | 'sort' | 'limit' | 'values' | 'setValues';

interface JoinClause { table: string; type: 'INNER' | 'LEFT' | 'RIGHT' | 'FULL'; leftCol: string; rightCol: string; }
interface WhereCondition { column: string; operator: string; value: string; }
interface ColumnValue { column: string; value: string; }
interface ColumnInfo { name: string; type: string; nullable: boolean; }
interface Relationship { sourceTable: string; sourceColumn: string; targetTable: string; targetColumn: string; constraintName: string; }
interface SQLResult { rows: Record<string, unknown>[]; fields: string[]; rowCount: number; duration_ms: number; }

const OPERATORS = ['=', '!=', '>', '<', '>=', '<=', 'LIKE', 'ILIKE', 'IN', 'IS NULL', 'IS NOT NULL'];
const JOIN_TYPES = ['INNER', 'LEFT', 'RIGHT', 'FULL'] as const;

const TYPE_META: Record<QueryType, { icon: React.ElementType; color: string; label: string }> = {
  SELECT: { icon: Search, color: 'text-emerald-400 border-emerald-500/50 bg-emerald-500/10', label: 'SELECT' },
  INSERT: { icon: SquarePlus, color: 'text-blue-400 border-blue-500/50 bg-blue-500/10', label: 'INSERT' },
  UPDATE: { icon: PenLine, color: 'text-orange-400 border-orange-500/50 bg-orange-500/10', label: 'UPDATE' },
  DELETE: { icon: Trash2, color: 'text-red-400 border-red-500/50 bg-red-500/10', label: 'DELETE' },
};

interface PipelineNodeDef { id: NodeId; icon: React.ElementType; label: string; }

const PIPELINE_NODES: Record<QueryType, PipelineNodeDef[]> = {
  SELECT: [
    { id: 'table', icon: Database, label: 'table' },
    { id: 'columns', icon: Columns3, label: 'columns' },
    { id: 'joins', icon: Link2, label: 'joins' },
    { id: 'filter', icon: Filter, label: 'filters' },
    { id: 'sort', icon: ArrowDownUp, label: 'sort' },
    { id: 'limit', icon: Hash, label: 'limit' },
  ],
  INSERT: [
    { id: 'table', icon: Database, label: 'table' },
    { id: 'values', icon: TableProperties, label: 'values' },
  ],
  UPDATE: [
    { id: 'table', icon: Database, label: 'table' },
    { id: 'setValues', icon: PenLine, label: 'setValues' },
    { id: 'filter', icon: Filter, label: 'filters' },
  ],
  DELETE: [
    { id: 'table', icon: Database, label: 'table' },
    { id: 'filter', icon: Filter, label: 'filters' },
  ],
};

function getHumanSortLabel(colType: string, dir: 'ASC' | 'DESC', t: TFunction): string {
  const lc = colType.toLowerCase();
  if (lc.includes('timestamp') || lc.includes('date'))
    return dir === 'ASC' ? t('sql:queryBuilder.sortLabels.oldestFirst') : t('sql:queryBuilder.sortLabels.newestFirst');
  if (lc.includes('int') || lc.includes('numeric') || lc.includes('float') || lc.includes('decimal') || lc.includes('real') || lc.includes('double'))
    return dir === 'ASC' ? t('sql:queryBuilder.sortLabels.smallestFirst') : t('sql:queryBuilder.sortLabels.largestFirst');
  if (lc.includes('bool'))
    return dir === 'ASC' ? t('sql:queryBuilder.sortLabels.falseFirst') : t('sql:queryBuilder.sortLabels.trueFirst');
  return dir === 'ASC' ? t('sql:queryBuilder.sortLabels.aToZ') : t('sql:queryBuilder.sortLabels.zToA');
}

function WhereRow({ w, idx, columns, onUpdate, onRemove, t }: {
  w: WhereCondition; idx: number; columns: ColumnInfo[];
  onUpdate: (i: number, f: string, v: string) => void; onRemove: (i: number) => void; t: TFunction;
}) {
  const needsValue = w.operator !== 'IS NULL' && w.operator !== 'IS NOT NULL';
  return (
    <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/20 border border-border/40">
      <Select value={w.column || '_'} onValueChange={(v) => onUpdate(idx, 'column', v === '_' ? '' : v)}>
        <SelectTrigger className="h-8 text-xs w-[140px]"><SelectValue placeholder={t('sql:queryBuilder.column')} /></SelectTrigger>
        <SelectContent>
          {columns.map((c) => (
            <SelectItem key={c.name} value={c.name}>
              <span className="font-mono text-xs">{c.name}</span>
              <span className="text-[9px] text-muted-foreground ml-1">{c.type}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={w.operator} onValueChange={(v) => onUpdate(idx, 'operator', v)}>
        <SelectTrigger className="h-8 w-[100px] text-xs font-mono"><SelectValue /></SelectTrigger>
        <SelectContent>{OPERATORS.map((op) => <SelectItem key={op} value={op}>{op}</SelectItem>)}</SelectContent>
      </Select>
      {needsValue ? (
        <Input className="h-8 text-xs font-mono flex-1" placeholder={t('sql:queryBuilder.value')} value={w.value} onChange={(e) => onUpdate(idx, 'value', e.target.value)} />
      ) : <div className="flex-1" />}
      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => onRemove(idx)}>
        <Trash2 className="h-3 w-3" />
      </Button>
    </div>
  );
}

function ValueRow({ cv, idx, columns, onUpdate, onRemove, t }: {
  cv: ColumnValue; idx: number; columns: ColumnInfo[];
  onUpdate: (i: number, f: string, v: string) => void; onRemove: (i: number) => void; t: TFunction;
}) {
  return (
    <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/20 border border-border/40">
      <Select value={cv.column || '_'} onValueChange={(v) => onUpdate(idx, 'column', v === '_' ? '' : v)}>
        <SelectTrigger className="h-8 text-xs w-[140px]"><SelectValue placeholder={t('sql:queryBuilder.column')} /></SelectTrigger>
        <SelectContent>
          {columns.map((c) => (
            <SelectItem key={c.name} value={c.name}>
              <span className="font-mono text-xs">{c.name}</span>
              <span className="text-[9px] text-muted-foreground ml-1">{c.type}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-xs text-muted-foreground font-mono">=</span>
      <Input className="h-8 text-xs font-mono flex-1" placeholder={t('sql:queryBuilder.value')} value={cv.value} onChange={(e) => onUpdate(idx, 'value', e.target.value)} />
      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => onRemove(idx)}>
        <Trash2 className="h-3 w-3" />
      </Button>
    </div>
  );
}

function SQLHighlight({ sql }: { sql: string }) {
  if (!sql) return null;
  const re = /\b(SELECT|FROM|WHERE|AND|OR|ORDER BY|GROUP BY|LIMIT|INSERT INTO|VALUES|UPDATE|SET|DELETE FROM|JOIN|ON|INNER|LEFT|RIGHT|FULL|AS|IN|LIKE|ILIKE|IS NULL|IS NOT NULL|ASC|DESC)\b/g;
  const parts: { text: string; isKw: boolean }[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    if (m.index > last) parts.push({ text: sql.slice(last, m.index), isKw: false });
    parts.push({ text: m[0], isKw: true });
    last = re.lastIndex;
  }
  if (last < sql.length) parts.push({ text: sql.slice(last), isKw: false });
  return (
    <pre className="text-xs font-mono leading-relaxed whitespace-pre-wrap">
      {parts.map((p, i) =>
        p.isKw ? <span key={i} className="font-bold text-primary">{p.text}</span> : <span key={i} className="text-foreground/70">{p.text}</span>
      )}
    </pre>
  );
}

export function QueryBuilderPage() {
  const { t } = useTranslation(['sql', 'common']);
  usePageTitle(t('sql:queryBuilder.title'));
  const { data: project } = useCurrentProject();

  const [queryType, setQueryType] = useState<QueryType>('SELECT');
  const [activeNode, setActiveNode] = useState<NodeId>('table');
  const [selectedTable, setSelectedTable] = useState('');
  const [result, setResult] = useState<SQLResult | null>(null);
  const [copied, setCopied] = useState(false);

  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [joins, setJoins] = useState<JoinClause[]>([]);
  const [wheres, setWheres] = useState<WhereCondition[]>([]);
  const [groupBy, setGroupBy] = useState('');
  const [orderBy, setOrderBy] = useState('');
  const [orderDir, setOrderDir] = useState<'ASC' | 'DESC'>('DESC');
  const [limitValue, setLimitValue] = useState('100');

  const [insertValues, setInsertValues] = useState<ColumnValue[]>([]);
  const [setValues, setSetValues] = useState<ColumnValue[]>([]);
  const [updateWheres, setUpdateWheres] = useState<WhereCondition[]>([]);
  const [deleteWheres, setDeleteWheres] = useState<WhereCondition[]>([]);


  const { data: explorerData } = useQuery({
    queryKey: ['sql-explorer', project?.id],
    queryFn: () => api.get<{ tables: { table_name: string; columns: ColumnInfo[] }[] }>(`/projects/${project!.id}/sql/explorer`),
    enabled: !!project?.id,
  });

  const { data: dbMapData } = useQuery({
    queryKey: ['db-map', project?.id],
    queryFn: () => api.get<{ tables: unknown[]; relationships: Relationship[] }>(`/projects/${project!.id}/db-map`),
    enabled: !!project?.id,
  });

  const tables = explorerData?.tables ?? [];
  const relationships = dbMapData?.relationships ?? [];
  const tableCols = tables.find((tbl) => tbl.table_name === selectedTable)?.columns ?? [];

  const availableJoins = useMemo(() => {
    if (!selectedTable || !relationships.length) return [];
    return relationships
      .filter((r) => r.sourceTable === selectedTable || r.targetTable === selectedTable)
      .map((r) => {
        const isSource = r.sourceTable === selectedTable;
        return {
          table: isSource ? r.targetTable : r.sourceTable,
          leftCol: `${selectedTable}.${isSource ? r.sourceColumn : r.targetColumn}`,
          rightCol: `${isSource ? r.targetTable : r.sourceTable}.${isSource ? r.targetColumn : r.sourceColumn}`,
          sourceCol: isSource ? r.sourceColumn : r.targetColumn,
          targetCol: isSource ? r.targetColumn : r.sourceColumn,
          targetTable: isSource ? r.targetTable : r.sourceTable,
        };
      });
  }, [selectedTable, relationships]);

  const pipelineNodes = PIPELINE_NODES[queryType];

  const nodeCounts = useMemo((): Record<string, number> => ({
    columns: selectedColumns.length,
    joins: joins.length,
    filter: queryType === 'UPDATE' ? updateWheres.length : queryType === 'DELETE' ? deleteWheres.length : wheres.length,
    values: insertValues.length,
    setValues: setValues.length,
  }), [selectedColumns, joins, wheres, updateWheres, deleteWheres, insertValues, setValues, queryType]);

  const generatedSQL = useMemo(() => {
    if (!selectedTable) return '';
    switch (queryType) {
      case 'SELECT': {
        const cols = selectedColumns.length > 0 ? selectedColumns.join(', ') : '*';
        let sql = `SELECT ${cols}\nFROM ${selectedTable}`;
        for (const j of joins) if (j.table) sql += `\n${j.type} JOIN ${j.table} ON ${j.leftCol} = ${j.rightCol}`;
        const conds = wheres.filter((w) => w.column).map((w) =>
          w.operator === 'IS NULL' || w.operator === 'IS NOT NULL' ? `${w.column} ${w.operator}` : `${w.column} ${w.operator} '${w.value}'`);
        if (conds.length) sql += `\nWHERE ${conds.join(' AND ')}`;
        if (groupBy.trim()) sql += `\nGROUP BY ${groupBy}`;
        if (orderBy.trim()) sql += `\nORDER BY ${orderBy} ${orderDir}`;
        if (limitValue) sql += `\nLIMIT ${limitValue}`;
        return sql + ';';
      }
      case 'INSERT': {
        const valid = insertValues.filter((v) => v.column);
        if (!valid.length) return '';
        return `INSERT INTO ${selectedTable} (${valid.map((v) => v.column).join(', ')})\nVALUES (${valid.map((v) => `'${v.value}'`).join(', ')});`;
      }
      case 'UPDATE': {
        const valid = setValues.filter((v) => v.column);
        if (!valid.length) return '';
        let sql = `UPDATE ${selectedTable}\nSET ${valid.map((v) => `${v.column} = '${v.value}'`).join(', ')}`;
        const conds = updateWheres.filter((w) => w.column).map((w) =>
          w.operator === 'IS NULL' || w.operator === 'IS NOT NULL' ? `${w.column} ${w.operator}` : `${w.column} ${w.operator} '${w.value}'`);
        if (conds.length) sql += `\nWHERE ${conds.join(' AND ')}`;
        return sql + ';';
      }
      case 'DELETE': {
        let sql = `DELETE FROM ${selectedTable}`;
        const conds = deleteWheres.filter((w) => w.column).map((w) =>
          w.operator === 'IS NULL' || w.operator === 'IS NOT NULL' ? `${w.column} ${w.operator}` : `${w.column} ${w.operator} '${w.value}'`);
        if (conds.length) sql += `\nWHERE ${conds.join(' AND ')}`;
        return sql + ';';
      }
    }
  }, [queryType, selectedTable, selectedColumns, joins, wheres, groupBy, orderBy, orderDir, limitValue, insertValues, setValues, updateWheres, deleteWheres]);

  const executeMutation = useMutation({
    mutationFn: () => api.post<SQLResult>(`/projects/${project!.id}/sql/execute`, { query: generatedSQL }),
    onSuccess: (data) => { setResult(data); toast.success(t('sql:results.rows', { count: data.rowCount })); },
    onError: (err: Error) => toast.error(err.message),
  });



  const listUpdate = useCallback(<T,>(list: T[], idx: number, field: string, value: string): T[] =>
    list.map((item, i) => (i === idx ? { ...item, [field]: value } : item)), []);

  const toggleColumn = useCallback((col: string) =>
    setSelectedColumns((prev) => (prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col])), []);

  const handleTypeChange = useCallback((val: QueryType) => {
    setQueryType(val);
    setActiveNode('table');
    setResult(null);
  }, []);

  const handleTableChange = useCallback((v: string) => {
    setSelectedTable(v);
    setSelectedColumns([]);
    setJoins([]);
    const nodes = PIPELINE_NODES[queryType];
    if (nodes.length > 1) setActiveNode(nodes[1].id);
  }, [queryType]);

  const goNextNode = useCallback(() => {
    const nodes = PIPELINE_NODES[queryType];
    const idx = nodes.findIndex((n) => n.id === activeNode);
    if (idx >= 0 && idx < nodes.length - 1) setActiveNode(nodes[idx + 1].id);
  }, [queryType, activeNode]);

  const hasNextNode = useMemo(() => {
    const nodes = PIPELINE_NODES[queryType];
    const idx = nodes.findIndex((n) => n.id === activeNode);
    return idx >= 0 && idx < nodes.length - 1;
  }, [queryType, activeNode]);

  const copySQL = useCallback(() => {
    navigator.clipboard.writeText(generatedSQL);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [generatedSQL]);


  const addAutoJoin = useCallback((aj: typeof availableJoins[0]) => {
    setJoins((prev) => [...prev, { table: aj.targetTable, type: 'INNER', leftCol: aj.leftCol, rightCol: aj.rightCol }]);
  }, []);

  const orderByCol = tableCols.find((c) => c.name === orderBy);
  const sortLabel = orderByCol ? getHumanSortLabel(orderByCol.type, orderDir, t) : '';

  const meta = TYPE_META[queryType];

  return (
    <PageWrapper className="!p-0 flex flex-col h-[calc(100vh-4rem)]">
      {/* Zone 1: Top Bar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b bg-background/80 backdrop-blur-sm shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-bold">{t('sql:queryBuilder.title')}</h1>
          <div className="flex rounded-md border overflow-hidden">
            {(['SELECT', 'INSERT', 'UPDATE', 'DELETE'] as QueryType[]).map((qt) => {
              const m = TYPE_META[qt];
              const Icon = m.icon;
              const active = queryType === qt;
              return (
                <button key={qt} type="button" onClick={() => handleTypeChange(qt)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-mono font-bold border-r last:border-r-0 transition-colors ${active ? m.color : 'text-muted-foreground hover:bg-muted/50'}`}>
                  <Icon className="h-3 w-3" />
                  {qt}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-1.5" />
      </div>

      {/* Zone 2: Pipeline Strip */}
      <div className="relative px-6 py-4 border-b bg-card/30 shrink-0">
        {/* Dot grid background */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-[0.03]">
          <defs><pattern id="qb-grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <circle cx="10" cy="10" r="1" fill="currentColor" />
          </pattern></defs>
          <rect width="100%" height="100%" fill="url(#qb-grid)" />
        </svg>

        <div className="relative flex items-center justify-center gap-0">
          {pipelineNodes.map((node, i) => {
            const Icon = node.icon;
            const isActive = activeNode === node.id;
            const count = nodeCounts[node.id] ?? 0;
            const isTableSet = node.id === 'table' && !!selectedTable;
            const isConfigured = isTableSet || count > 0;

            return (
              <div key={node.id} className="flex items-center">
                {/* Connector line */}
                {i > 0 && (
                  <svg width="48" height="2" className="mx-1">
                    <line x1="0" y1="1" x2="48" y2="1" className="stroke-muted-foreground/20" strokeWidth="2" strokeDasharray="4 3">
                      <animate attributeName="stroke-dashoffset" from="0" to="-14" dur="1.5s" repeatCount="indefinite" />
                    </line>
                  </svg>
                )}

                {/* Node */}
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => setActiveNode(node.id)}
                        className={`relative flex flex-col items-center gap-1 px-4 py-2 rounded-xl border transition-all ${
                          isActive
                            ? 'border-primary bg-primary/10 shadow-[0_0_20px_rgba(34,197,94,0.15)]'
                            : isConfigured
                              ? 'border-primary/30 bg-primary/5 hover:border-primary/50'
                              : 'border-border/50 hover:border-border bg-background/50'
                        }`}
                      >
                        <Icon className={`h-4 w-4 ${isActive ? 'text-primary' : isConfigured ? 'text-primary/70' : 'text-muted-foreground'}`} />
                        <span className={`text-[10px] font-medium ${isActive ? 'text-primary' : 'text-muted-foreground'}`}>
                          {node.id === 'table' ? (selectedTable || t(`sql:queryBuilder.${node.label}`)) : t(`sql:queryBuilder.${node.label}`)}
                        </span>
                        {count > 0 && (
                          <Badge variant="secondary" className="absolute -top-1.5 -right-1.5 h-4 min-w-4 px-1 text-[9px] font-bold">
                            {count}
                          </Badge>
                        )}
                        {isTableSet && node.id === 'table' && (
                          <Check className="absolute -top-1 -right-1 h-3.5 w-3.5 text-primary bg-background rounded-full" />
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="text-xs">
                      {t(`sql:queryBuilder.${node.label}`)}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            );
          })}
        </div>
      </div>

      {/* Zone 3: Split Panel */}
      <div className="flex flex-1 min-h-0">
        {/* Left: Active node panel */}
        <div className="flex-1 border-r overflow-y-auto">
          <div className="p-4 max-w-2xl">
            {/* TABLE panel */}
            {activeNode === 'table' && (
              <div>
                <h3 className="text-sm font-semibold mb-3">{t('sql:queryBuilder.selectTable')}</h3>
                <div className="space-y-1">
                  {tables.map((tbl) => (
                    <button
                      key={tbl.table_name}
                      type="button"
                      onClick={() => handleTableChange(tbl.table_name)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                        selectedTable === tbl.table_name ? 'bg-primary/10 border border-primary/30' : 'hover:bg-muted/30 border border-transparent'
                      }`}
                    >
                      <Database className={`h-4 w-4 shrink-0 ${selectedTable === tbl.table_name ? 'text-primary' : 'text-muted-foreground'}`} />
                      <span className="font-mono text-sm flex-1">{tbl.table_name}</span>
                      <span className="text-[10px] text-muted-foreground">{tbl.columns.length} cols</span>
                      {selectedTable === tbl.table_name && <Check className="h-4 w-4 text-primary" />}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* COLUMNS panel */}
            {activeNode === 'columns' && selectedTable && (
              <div>
                <h3 className="text-sm font-semibold mb-1">{t('sql:queryBuilder.columns')}</h3>
                <p className="text-xs text-muted-foreground mb-3">{t('sql:queryBuilder.columnsHint')}</p>
                <label className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-muted/30 cursor-pointer border border-transparent mb-1">
                  <Checkbox checked={selectedColumns.length === 0} onCheckedChange={() => setSelectedColumns([])} />
                  <span className="text-sm font-medium">* ({t('sql:queryBuilder.allColumns')})</span>
                </label>
                <div className="space-y-0.5">
                  {tableCols.map((col) => (
                    <label key={col.name} className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg hover:bg-muted/30 cursor-pointer">
                      <Checkbox checked={selectedColumns.includes(col.name)} onCheckedChange={() => toggleColumn(col.name)} />
                      <span className="font-mono text-xs flex-1">{col.name}</span>
                      <Badge variant="outline" className="text-[9px] font-mono text-muted-foreground">{col.type}</Badge>
                      {col.nullable && <span className="text-[9px] text-muted-foreground/40">NULL</span>}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* JOINS panel */}
            {activeNode === 'joins' && selectedTable && (
              <div>
                <h3 className="text-sm font-semibold mb-1">{t('sql:queryBuilder.joins')}</h3>
                <p className="text-xs text-muted-foreground mb-3">{t('sql:queryBuilder.suggestedJoins')}</p>

                {/* Auto-detected FK joins */}
                {availableJoins.length > 0 && (
                  <div className="space-y-1.5 mb-4">
                    {availableJoins.map((aj, i) => {
                      const alreadyAdded = joins.some((j) => j.table === aj.targetTable);
                      return (
                        <div key={i} className={`flex items-center gap-2 p-2.5 rounded-lg border transition-colors ${alreadyAdded ? 'border-primary/30 bg-primary/5' : 'border-border/40 hover:border-primary/30'}`}>
                          <Zap className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                          <span className="font-mono text-xs text-muted-foreground">{selectedTable}.</span>
                          <span className="font-mono text-xs font-medium">{aj.sourceCol}</span>
                          <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                          <span className="font-mono text-xs text-primary font-medium">{aj.targetTable}</span>
                          <span className="font-mono text-xs text-muted-foreground">.{aj.targetCol}</span>
                          <div className="flex-1" />
                          {alreadyAdded ? (
                            <Badge variant="outline" className="text-[9px] text-primary border-primary/30">
                              <Check className="h-2.5 w-2.5 mr-0.5" />added
                            </Badge>
                          ) : (
                            <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={() => addAutoJoin(aj)}>
                              <Plus className="h-2.5 w-2.5 mr-0.5" />{t('sql:queryBuilder.addJoin')}
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {availableJoins.length === 0 && joins.length === 0 && (
                  <p className="text-xs text-muted-foreground mb-3">{t('sql:queryBuilder.noRelationships')}</p>
                )}

                {/* Active joins */}
                {joins.length > 0 && (
                  <div className="space-y-2 mb-3">
                    <Label className="text-xs text-muted-foreground">Active joins</Label>
                    {joins.map((j, i) => {
                      const isAutoJoin = j.leftCol.includes('.') && j.rightCol.includes('.');
                      const joinTargetCols = tables.find((tbl) => tbl.table_name === j.table)?.columns ?? [];
                      return (
                        <div key={i} className="rounded-lg border border-primary/20 bg-primary/5 overflow-hidden">
                          <div className="flex items-center gap-2 px-3 py-2 bg-primary/5 border-b border-primary/10">
                            <Select value={j.type} onValueChange={(v) => setJoins(listUpdate(joins, i, 'type', v) as JoinClause[])}>
                              <SelectTrigger className="h-7 w-[80px] text-[10px] font-mono"><SelectValue /></SelectTrigger>
                              <SelectContent>{JOIN_TYPES.map((jt) => <SelectItem key={jt} value={jt}>{jt}</SelectItem>)}</SelectContent>
                            </Select>
                            <span className="text-[10px] font-medium flex-1">
                              {j.table ? <span className="font-mono text-primary">{selectedTable} ↔ {j.table}</span> : 'JOIN'}
                            </span>
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive shrink-0" onClick={() => setJoins(joins.filter((_, idx) => idx !== i))}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                          {isAutoJoin ? (
                            <div className="px-3 py-2 flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground">
                              <Zap className="h-3 w-3 text-amber-400 shrink-0" />
                              {j.leftCol} = {j.rightCol}
                            </div>
                          ) : (
                            <div className="px-3 py-2.5 space-y-2">
                              <div className="flex items-center gap-2">
                                <Label className="text-[10px] text-muted-foreground w-16 shrink-0">{t('sql:queryBuilder.joinTable')}</Label>
                                <Select value={j.table || '_'} onValueChange={(v) => setJoins(listUpdate(joins, i, 'table', v === '_' ? '' : v) as JoinClause[])}>
                                  <SelectTrigger className="h-8 text-xs flex-1"><SelectValue placeholder="..." /></SelectTrigger>
                                  <SelectContent>{tables.filter((tbl) => tbl.table_name !== selectedTable).map((tbl) => <SelectItem key={tbl.table_name} value={tbl.table_name}><span className="font-mono">{tbl.table_name}</span></SelectItem>)}</SelectContent>
                                </Select>
                              </div>
                              <div className="flex items-center gap-2">
                                <Label className="text-[10px] text-muted-foreground w-16 shrink-0">{selectedTable}</Label>
                                <Select value={j.leftCol || '_'} onValueChange={(v) => setJoins(listUpdate(joins, i, 'leftCol', v === '_' ? '' : `${selectedTable}.${v}`) as JoinClause[])}>
                                  <SelectTrigger className="h-8 text-xs font-mono flex-1"><SelectValue placeholder={t('sql:queryBuilder.column')} /></SelectTrigger>
                                  <SelectContent>{tableCols.map((c) => <SelectItem key={c.name} value={c.name}>{c.name} <span className="text-muted-foreground text-[9px] ml-1">{c.type}</span></SelectItem>)}</SelectContent>
                                </Select>
                              </div>
                              {j.table && joinTargetCols.length > 0 && (
                                <div className="flex items-center gap-2">
                                  <Label className="text-[10px] text-muted-foreground w-16 shrink-0">{j.table}</Label>
                                  <Select value={j.rightCol || '_'} onValueChange={(v) => setJoins(listUpdate(joins, i, 'rightCol', v === '_' ? '' : `${j.table}.${v}`) as JoinClause[])}>
                                    <SelectTrigger className="h-8 text-xs font-mono flex-1"><SelectValue placeholder={t('sql:queryBuilder.column')} /></SelectTrigger>
                                    <SelectContent>{joinTargetCols.map((c) => <SelectItem key={c.name} value={c.name}>{c.name} <span className="text-muted-foreground text-[9px] ml-1">{c.type}</span></SelectItem>)}</SelectContent>
                                  </Select>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Manual join */}
                <Button variant="outline" size="sm" className="text-xs h-7 gap-1"
                  onClick={() => setJoins([...joins, { table: '', type: 'INNER', leftCol: '', rightCol: '' }])}>
                  <Plus className="h-3 w-3" />{t('sql:queryBuilder.customJoin')}
                </Button>
              </div>
            )}

            {/* FILTER panel */}
            {activeNode === 'filter' && selectedTable && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-sm font-semibold">{t('sql:queryBuilder.filters')}</h3>
                  <Button variant="outline" size="sm" className="h-7 text-xs gap-1"
                    onClick={() => {
                      const newW: WhereCondition = { column: '', operator: '=', value: '' };
                      if (queryType === 'UPDATE') setUpdateWheres((p) => [...p, newW]);
                      else if (queryType === 'DELETE') setDeleteWheres((p) => [...p, newW]);
                      else setWheres((p) => [...p, newW]);
                    }}>
                    <Plus className="h-3 w-3" />{t('common:actions.add')}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mb-3">{t('sql:queryBuilder.filtersHint')}</p>

                {queryType === 'DELETE' && (
                  <div className="flex items-center gap-2 mb-3 p-2 rounded-lg bg-red-500/10 border border-red-500/20">
                    <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0" />
                    <span className="text-[11px] text-red-400">{t('sql:queryBuilder.deleteWarning')}</span>
                  </div>
                )}

                {(() => {
                  const w = queryType === 'UPDATE' ? updateWheres : queryType === 'DELETE' ? deleteWheres : wheres;
                  const setW = queryType === 'UPDATE' ? setUpdateWheres : queryType === 'DELETE' ? setDeleteWheres : setWheres;
                  return w.length > 0 ? (
                    <div className="space-y-2">
                      {w.map((item, i) => (
                        <WhereRow key={i} w={item} idx={i} columns={tableCols}
                          onUpdate={(idx, f, v) => setW(listUpdate(w, idx, f, v) as WhereCondition[])}
                          onRemove={(idx) => setW(w.filter((_, j) => j !== idx))} t={t} />
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">{t('sql:queryBuilder.noFilters')}</p>
                  );
                })()}
              </div>
            )}

            {/* SORT panel */}
            {activeNode === 'sort' && selectedTable && (
              <div>
                <h3 className="text-sm font-semibold mb-3">{t('sql:queryBuilder.groupOrder')}</h3>
                <div className="space-y-4">
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">{t('sql:queryBuilder.orderBy')}</Label>
                    <div className="flex items-center gap-2">
                      <Select value={orderBy || '_'} onValueChange={(v) => setOrderBy(v === '_' ? '' : v)}>
                        <SelectTrigger className="h-9 text-sm font-mono flex-1"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_">—</SelectItem>
                          {tableCols.map((c) => <SelectItem key={c.name} value={c.name}>{c.name} <span className="text-muted-foreground ml-1 text-[10px]">{c.type}</span></SelectItem>)}
                        </SelectContent>
                      </Select>
                      {orderBy && (
                        <div className="flex rounded-md border overflow-hidden shrink-0">
                          <button type="button" onClick={() => setOrderDir('ASC')}
                            className={`px-3 py-1.5 text-xs transition-colors ${orderDir === 'ASC' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted/50'}`}>
                            {orderByCol ? getHumanSortLabel(orderByCol.type, 'ASC', t) : 'ASC'}
                          </button>
                          <button type="button" onClick={() => setOrderDir('DESC')}
                            className={`px-3 py-1.5 text-xs border-l transition-colors ${orderDir === 'DESC' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted/50'}`}>
                            {orderByCol ? getHumanSortLabel(orderByCol.type, 'DESC', t) : 'DESC'}
                          </button>
                        </div>
                      )}
                    </div>
                    {orderBy && sortLabel && (
                      <p className="text-[10px] text-muted-foreground mt-1 ml-1">{sortLabel}</p>
                    )}
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">{t('sql:queryBuilder.groupBy')}</Label>
                    <Select value={groupBy || '_'} onValueChange={(v) => setGroupBy(v === '_' ? '' : v)}>
                      <SelectTrigger className="h-9 text-sm font-mono"><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_">—</SelectItem>
                        {tableCols.map((c) => <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            )}

            {/* LIMIT panel */}
            {activeNode === 'limit' && (
              <div>
                <h3 className="text-sm font-semibold mb-3">{t('sql:queryBuilder.limit')}</h3>
                <div className="flex items-center gap-2">
                  {[10, 50, 100, 500, 1000].map((n) => (
                    <button key={n} type="button" onClick={() => setLimitValue(String(n))}
                      className={`px-3 py-1.5 rounded-md text-xs font-mono border transition-colors ${
                        limitValue === String(n) ? 'border-primary bg-primary/10 text-primary' : 'border-border/50 hover:border-border text-muted-foreground'
                      }`}>{n}</button>
                  ))}
                  <Input value={limitValue} onChange={(e) => setLimitValue(e.target.value)} className="h-8 w-20 text-xs font-mono" type="number" placeholder="custom" />
                </div>
              </div>
            )}

            {/* VALUES panel (INSERT) */}
            {activeNode === 'values' && selectedTable && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold">{t('sql:queryBuilder.columnValues')}</h3>
                  <Button variant="outline" size="sm" className="h-7 text-xs gap-1"
                    onClick={() => setInsertValues([...insertValues, { column: '', value: '' }])}>
                    <Plus className="h-3 w-3" />{t('common:actions.add')}
                  </Button>
                </div>
                {insertValues.length > 0 ? (
                  <div className="space-y-2">
                    {insertValues.map((cv, i) => (
                      <ValueRow key={i} cv={cv} idx={i} columns={tableCols}
                        onUpdate={(idx, f, v) => setInsertValues(listUpdate(insertValues, idx, f, v) as ColumnValue[])}
                        onRemove={(idx) => setInsertValues(insertValues.filter((_, j) => j !== idx))} t={t} />
                    ))}
                  </div>
                ) : <p className="text-xs text-muted-foreground">{t('sql:queryBuilder.addPairs')}</p>}
              </div>
            )}

            {/* SET VALUES panel (UPDATE) */}
            {activeNode === 'setValues' && selectedTable && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold">{t('sql:queryBuilder.setValues')}</h3>
                  <Button variant="outline" size="sm" className="h-7 text-xs gap-1"
                    onClick={() => setSetValues([...setValues, { column: '', value: '' }])}>
                    <Plus className="h-3 w-3" />{t('common:actions.add')}
                  </Button>
                </div>
                {setValues.length > 0 ? (
                  <div className="space-y-2">
                    {setValues.map((cv, i) => (
                      <ValueRow key={i} cv={cv} idx={i} columns={tableCols}
                        onUpdate={(idx, f, v) => setSetValues(listUpdate(setValues, idx, f, v) as ColumnValue[])}
                        onRemove={(idx) => setSetValues(setValues.filter((_, j) => j !== idx))} t={t} />
                    ))}
                  </div>
                ) : <p className="text-xs text-muted-foreground">{t('sql:queryBuilder.addPairs')}</p>}
              </div>
            )}

            {/* No table selected */}
            {!selectedTable && activeNode !== 'table' && (
              <div className="flex flex-col items-center py-10 text-center">
                <Database className="h-8 w-8 text-muted-foreground/20 mb-2" />
                <p className="text-sm text-muted-foreground">{t('sql:queryBuilder.noTable')}</p>
              </div>
            )}

            {/* Next button (not on table — it auto-advances) */}
            {hasNextNode && activeNode !== 'table' && (
              <div className="mt-5 pt-4 border-t border-border/30">
                <Button variant="outline" className="gap-2" onClick={goNextNode}>
                  {t('common:actions.next')}
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Right: SQL Preview + Results */}
        <div className="w-[360px] shrink-0 flex flex-col bg-card/20">
          {/* SQL Preview */}
          <div className="p-3 border-b">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold">{t('sql:queryBuilder.sqlPreview')}</span>
                <Badge className={`font-mono text-[9px] border ${meta.color}`} variant="outline">{queryType}</Badge>
              </div>
              {generatedSQL && (
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={copySQL}>
                  {copied ? <Check className="h-3 w-3 text-primary" /> : <Copy className="h-3 w-3 text-muted-foreground" />}
                </Button>
              )}
            </div>
            <div className="bg-background/60 rounded-lg p-3 border border-border/40 min-h-[80px] max-h-[200px] overflow-auto">
              {generatedSQL ? <SQLHighlight sql={generatedSQL} /> : (
                <p className="text-xs text-muted-foreground italic">{t('sql:queryBuilder.noTable')}</p>
              )}
            </div>
            <Button size="sm" className="w-full mt-2 h-8 text-xs gap-1.5" onClick={() => executeMutation.mutate()} disabled={!generatedSQL || executeMutation.isPending}>
              <Play className="h-3 w-3" />
              {executeMutation.isPending ? t('sql:toolbar.running') : t('sql:toolbar.run')}
            </Button>
          </div>

          {/* Results */}
          {result && (
            <div className="flex-1 overflow-auto p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold">{t('sql:tabs.results')}</span>
                <Badge variant="secondary" className="font-mono text-[10px]">{result.rowCount} rows</Badge>
                <Badge variant="outline" className="font-mono text-[9px]">{result.duration_ms}ms</Badge>
              </div>
              <div className="rounded-md border overflow-auto max-h-[calc(100vh-400px)]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {result.fields.map((f) => <TableHead key={f} className="font-mono text-[10px] whitespace-nowrap bg-muted/30 py-1.5 px-2">{f}</TableHead>)}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.rows.slice(0, 100).map((row, i) => (
                      <TableRow key={i}>
                        {result.fields.map((f) => (
                          <TableCell key={f} className="font-mono text-[10px] max-w-[120px] truncate py-1 px-2">
                            {row[f] === null ? <span className="italic text-muted-foreground">NULL</span> : String(row[f])}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </div>
      </div>

    </PageWrapper>
  );
}
