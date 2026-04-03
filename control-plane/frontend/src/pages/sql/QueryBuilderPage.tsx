import { useState, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Play, Save, Plus, Trash2, Plug, ArrowDownUp, Filter, TableProperties, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { useCurrentProject } from '@/hooks/useProject';
import { usePageTitle } from '@/hooks/usePageTitle';
import { api } from '@/api/client';
import { endpointsApi } from '@/api/endpoints.api';
import { toast } from 'sonner';

type QueryType = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';

interface JoinClause { table: string; type: 'INNER' | 'LEFT' | 'RIGHT' | 'FULL'; leftCol: string; rightCol: string; }
interface WhereCondition { column: string; operator: string; value: string; }
interface ColumnValue { column: string; value: string; }
interface SQLResult { rows: Record<string, unknown>[]; fields: string[]; rowCount: number; duration_ms: number; }

const METHOD_MAP: Record<QueryType, string> = { SELECT: 'GET', INSERT: 'POST', UPDATE: 'PUT', DELETE: 'DELETE' };
const OPERATORS = ['=', '!=', '>', '<', '>=', '<=', 'LIKE', 'ILIKE', 'IN', 'IS NULL', 'IS NOT NULL'];
const JOIN_TYPES = ['INNER', 'LEFT', 'RIGHT', 'FULL'] as const;

const TYPE_COLORS: Record<QueryType, string> = {
  SELECT: 'bg-green-500/15 text-green-600 border-green-500/30',
  INSERT: 'bg-blue-500/15 text-blue-600 border-blue-500/30',
  UPDATE: 'bg-orange-500/15 text-orange-600 border-orange-500/30',
  DELETE: 'bg-red-500/15 text-red-600 border-red-500/30',
};

export function QueryBuilderPage() {
  const { t } = useTranslation(['sql', 'common']);
  usePageTitle(t('sql:queryBuilder.title'));
  const { data: project } = useCurrentProject();
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();

  const [queryType, setQueryType] = useState<QueryType>('SELECT');
  const [selectedTable, setSelectedTable] = useState('');
  const [result, setResult] = useState<SQLResult | null>(null);

  // SELECT
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [joins, setJoins] = useState<JoinClause[]>([]);
  const [wheres, setWheres] = useState<WhereCondition[]>([]);
  const [groupBy, setGroupBy] = useState('');
  const [orderBy, setOrderBy] = useState('');
  const [orderDir, setOrderDir] = useState<'ASC' | 'DESC'>('ASC');
  const [limitValue, setLimitValue] = useState('100');

  // INSERT
  const [insertValues, setInsertValues] = useState<ColumnValue[]>([]);

  // UPDATE
  const [setValues, setSetValues] = useState<ColumnValue[]>([]);
  const [updateWheres, setUpdateWheres] = useState<WhereCondition[]>([]);

  // DELETE
  const [deleteWheres, setDeleteWheres] = useState<WhereCondition[]>([]);

  // Endpoint dialog
  const [epDialogOpen, setEpDialogOpen] = useState(false);
  const [epName, setEpName] = useState('');
  const [epPath, setEpPath] = useState('');

  const { data: explorerData } = useQuery({
    queryKey: ['sql-explorer', project?.id],
    queryFn: () => api.get<{ tables: { table_name: string; columns: { name: string; type: string; nullable: boolean }[] }[] }>(
      `/projects/${project!.id}/sql/explorer`
    ),
    enabled: !!project?.id,
  });

  const tables = explorerData?.tables ?? [];
  const tableCols = tables.find((t) => t.table_name === selectedTable)?.columns ?? [];

  // SQL generation
  const generatedSQL = useMemo(() => {
    if (!selectedTable) return '';
    switch (queryType) {
      case 'SELECT': {
        const cols = selectedColumns.length > 0 ? selectedColumns.join(', ') : '*';
        let sql = `SELECT ${cols}\nFROM ${selectedTable}`;
        for (const j of joins) {
          if (j.table) sql += `\n${j.type} JOIN ${j.table} ON ${j.leftCol} = ${j.rightCol}`;
        }
        if (wheres.length > 0) {
          const conds = wheres.filter(w => w.column).map((w) =>
            (w.operator === 'IS NULL' || w.operator === 'IS NOT NULL') ? `${w.column} ${w.operator}` : `${w.column} ${w.operator} '${w.value}'`
          );
          if (conds.length) sql += `\nWHERE ${conds.join(' AND ')}`;
        }
        if (groupBy.trim()) sql += `\nGROUP BY ${groupBy}`;
        if (orderBy.trim()) sql += `\nORDER BY ${orderBy} ${orderDir}`;
        if (limitValue) sql += `\nLIMIT ${limitValue}`;
        return sql + ';';
      }
      case 'INSERT': {
        if (insertValues.length === 0) return '';
        const validValues = insertValues.filter(v => v.column);
        if (!validValues.length) return '';
        return `INSERT INTO ${selectedTable} (${validValues.map(v => v.column).join(', ')})\nVALUES (${validValues.map(v => `'${v.value}'`).join(', ')});`;
      }
      case 'UPDATE': {
        const validSets = setValues.filter(v => v.column);
        if (!validSets.length) return '';
        let sql = `UPDATE ${selectedTable}\nSET ${validSets.map(v => `${v.column} = '${v.value}'`).join(', ')}`;
        const conds = updateWheres.filter(w => w.column).map((w) =>
          (w.operator === 'IS NULL' || w.operator === 'IS NOT NULL') ? `${w.column} ${w.operator}` : `${w.column} ${w.operator} '${w.value}'`
        );
        if (conds.length) sql += `\nWHERE ${conds.join(' AND ')}`;
        return sql + ';';
      }
      case 'DELETE': {
        let sql = `DELETE FROM ${selectedTable}`;
        const conds = deleteWheres.filter(w => w.column).map((w) =>
          (w.operator === 'IS NULL' || w.operator === 'IS NOT NULL') ? `${w.column} ${w.operator}` : `${w.column} ${w.operator} '${w.value}'`
        );
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

  const saveMutation = useMutation({
    mutationFn: () => api.post(`/projects/${project!.id}/sql/saved`, { name: `${queryType} ${selectedTable}`, query: generatedSQL, description: 'Query Builder' }),
    onSuccess: () => toast.success(t('sql:queryBuilder.saved')),
    onError: (err: Error) => toast.error(err.message),
  });

  const createEndpointMutation = useMutation({
    mutationFn: () => endpointsApi.create(project!.id, { name: epName, method: METHOD_MAP[queryType], path: epPath, query: generatedSQL, table_name: selectedTable }),
    onSuccess: (data) => { toast.success(t('sql:queryBuilder.endpointCreated')); setEpDialogOpen(false); const ep = data?.endpoint; if (ep?.id) navigate(`/projects/${slug}/endpoints/${ep.id}`); },
    onError: (err: Error) => toast.error(err.message),
  });

  // Helpers
  const listUpdate = <T,>(list: T[], idx: number, field: string, value: string) =>
    list.map((item, i) => i === idx ? { ...item, [field]: value } : item);

  const toggleColumn = (col: string) => setSelectedColumns((prev) => prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]);

  const handleTypeChange = (val: QueryType) => { setQueryType(val); setResult(null); };

  const openEndpointDialog = () => { setEpName(`${queryType} ${selectedTable}`); setEpPath(`/${selectedTable.toLowerCase()}`); setEpDialogOpen(true); };

  // Reusable WHERE row
  function WhereRow({ w, idx, onUpdate, onRemove }: { w: WhereCondition; idx: number; onUpdate: (i: number, f: string, v: string) => void; onRemove: (i: number) => void }) {
    return (
      <div className="grid grid-cols-[1fr_auto_1fr_auto] gap-2 items-center">
        <Select value={w.column || '_'} onValueChange={(v) => onUpdate(idx, 'column', v === '_' ? '' : v)}>
          <SelectTrigger className="h-9 text-sm"><SelectValue placeholder={t('sql:queryBuilder.column')} /></SelectTrigger>
          <SelectContent>
            {tableCols.map((c) => <SelectItem key={c.name} value={c.name}><span className="font-mono">{c.name}</span></SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={w.operator} onValueChange={(v) => onUpdate(idx, 'operator', v)}>
          <SelectTrigger className="h-9 w-[110px] text-sm font-mono"><SelectValue /></SelectTrigger>
          <SelectContent>{OPERATORS.map((op) => <SelectItem key={op} value={op}>{op}</SelectItem>)}</SelectContent>
        </Select>
        {w.operator !== 'IS NULL' && w.operator !== 'IS NOT NULL' ? (
          <Input className="h-9 text-sm font-mono" placeholder={t('sql:queryBuilder.value')} value={w.value} onChange={(e) => onUpdate(idx, 'value', e.target.value)} />
        ) : <div />}
        <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-destructive" onClick={() => onRemove(idx)}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  // Reusable column = value row
  function ValueRow({ cv, idx, onUpdate, onRemove }: { cv: ColumnValue; idx: number; onUpdate: (i: number, f: string, v: string) => void; onRemove: (i: number) => void }) {
    return (
      <div className="grid grid-cols-[1fr_auto_1fr_auto] gap-2 items-center">
        <Select value={cv.column || '_'} onValueChange={(v) => onUpdate(idx, 'column', v === '_' ? '' : v)}>
          <SelectTrigger className="h-9 text-sm"><SelectValue placeholder={t('sql:queryBuilder.column')} /></SelectTrigger>
          <SelectContent>
            {tableCols.map((c) => <SelectItem key={c.name} value={c.name}><span className="font-mono">{c.name}</span></SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">=</span>
        <Input className="h-9 text-sm font-mono" placeholder={t('sql:queryBuilder.value')} value={cv.value} onChange={(e) => onUpdate(idx, 'value', e.target.value)} />
        <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-destructive" onClick={() => onRemove(idx)}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  // Section header helper
  function SectionHeader({ icon: Icon, title, onAdd }: { icon: React.ElementType; title: string; onAdd?: () => void }) {
    return (
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</span>
        </div>
        {onAdd && (
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onAdd}>
            <Plus className="h-3 w-3 mr-1" /> {t('common:actions.add')}
          </Button>
        )}
      </div>
    );
  }

  return (
    <PageWrapper>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('sql:queryBuilder.title')}</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => saveMutation.mutate()} disabled={!generatedSQL || saveMutation.isPending}>
            <Save className="h-3.5 w-3.5 mr-1.5" />
            {t('sql:queryBuilder.saveQuery')}
          </Button>
          <Button variant="outline" size="sm" onClick={openEndpointDialog} disabled={!generatedSQL}>
            <Plug className="h-3.5 w-3.5 mr-1.5" />
            {t('sql:queryBuilder.createEndpoint')}
          </Button>
          <Button size="sm" onClick={() => executeMutation.mutate()} disabled={!generatedSQL || executeMutation.isPending}>
            <Play className="h-3.5 w-3.5 mr-1.5" />
            {executeMutation.isPending ? t('sql:toolbar.running') : t('sql:toolbar.run')}
          </Button>
        </div>
      </div>

      {/* Type selector + Table — top bar */}
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block">{t('sql:queryBuilder.queryType')}</Label>
          <div className="flex rounded-md border overflow-hidden">
            {(['SELECT', 'INSERT', 'UPDATE', 'DELETE'] as QueryType[]).map((qt) => (
              <button
                key={qt}
                type="button"
                onClick={() => handleTypeChange(qt)}
                className={`px-3 py-1.5 text-xs font-mono font-bold transition-colors border-r last:border-r-0 ${
                  queryType === qt ? TYPE_COLORS[qt] : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                {qt}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 min-w-[200px]">
          <Label className="text-xs text-muted-foreground mb-1.5 block">{t('sql:queryBuilder.selectTable')}</Label>
          <Select value={selectedTable} onValueChange={(v) => { setSelectedTable(v); setSelectedColumns([]); }}>
            <SelectTrigger><SelectValue placeholder={t('sql:queryBuilder.selectTable')} /></SelectTrigger>
            <SelectContent>
              {tables.map((tbl) => <SelectItem key={tbl.table_name} value={tbl.table_name}>{tbl.table_name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Two-panel layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-4">
        {/* Left: Builder */}
        <Card>
          <CardContent className="space-y-5">
            {!selectedTable ? (
              <div className="py-10 text-center">
                <TableProperties className="h-8 w-8 mx-auto text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground">{t('sql:queryBuilder.selectTable')}</p>
              </div>
            ) : queryType === 'SELECT' ? (
              <>
                {/* Columns */}
                <div>
                  <SectionHeader icon={TableProperties} title={t('sql:queryBuilder.columns')} />
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    <Badge
                      variant={selectedColumns.length === 0 ? 'default' : 'outline'}
                      className="cursor-pointer text-xs"
                      onClick={() => setSelectedColumns([])}
                    >
                      *
                    </Badge>
                    {tableCols.map((col) => (
                      <Badge
                        key={col.name}
                        variant={selectedColumns.includes(col.name) ? 'default' : 'outline'}
                        className="cursor-pointer text-xs font-mono"
                        onClick={() => toggleColumn(col.name)}
                      >
                        {col.name}
                      </Badge>
                    ))}
                  </div>
                </div>

                <Separator />

                {/* Joins */}
                <div className="space-y-2">
                  <SectionHeader icon={Link2} title={t('sql:queryBuilder.joins')} onAdd={() => setJoins([...joins, { table: '', type: 'INNER', leftCol: '', rightCol: '' }])} />
                  {joins.map((j, i) => (
                    <div key={i} className="grid grid-cols-[90px_1fr_1fr_auto_1fr_auto] gap-2 items-center">
                      <Select value={j.type} onValueChange={(v) => setJoins(listUpdate(joins, i, 'type', v) as JoinClause[])}>
                        <SelectTrigger className="h-9 text-xs font-mono"><SelectValue /></SelectTrigger>
                        <SelectContent>{JOIN_TYPES.map((jt) => <SelectItem key={jt} value={jt}>{jt}</SelectItem>)}</SelectContent>
                      </Select>
                      <Select value={j.table || '_'} onValueChange={(v) => setJoins(listUpdate(joins, i, 'table', v === '_' ? '' : v) as JoinClause[])}>
                        <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="table" /></SelectTrigger>
                        <SelectContent>{tables.map((tbl) => <SelectItem key={tbl.table_name} value={tbl.table_name}>{tbl.table_name}</SelectItem>)}</SelectContent>
                      </Select>
                      <Input className="h-9 text-sm font-mono" placeholder="t1.col" value={j.leftCol} onChange={(e) => setJoins(listUpdate(joins, i, 'leftCol', e.target.value) as JoinClause[])} />
                      <span className="text-sm text-muted-foreground">=</span>
                      <Input className="h-9 text-sm font-mono" placeholder="t2.col" value={j.rightCol} onChange={(e) => setJoins(listUpdate(joins, i, 'rightCol', e.target.value) as JoinClause[])} />
                      <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-destructive" onClick={() => setJoins(joins.filter((_, idx) => idx !== i))}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                  {joins.length === 0 && <p className="text-xs text-muted-foreground pl-5">{t('sql:queryBuilder.noJoins')}</p>}
                </div>

                <Separator />

                {/* WHERE */}
                <div className="space-y-2">
                  <SectionHeader icon={Filter} title={t('sql:queryBuilder.filters')} onAdd={() => setWheres([...wheres, { column: '', operator: '=', value: '' }])} />
                  {wheres.map((w, i) => <WhereRow key={i} w={w} idx={i} onUpdate={(idx, f, v) => setWheres(listUpdate(wheres, idx, f, v) as WhereCondition[])} onRemove={(idx) => setWheres(wheres.filter((_, j) => j !== idx))} />)}
                  {wheres.length === 0 && <p className="text-xs text-muted-foreground pl-5">{t('sql:queryBuilder.noFilters')}</p>}
                </div>

                <Separator />

                {/* Group/Order/Limit */}
                <div className="space-y-3">
                  <SectionHeader icon={ArrowDownUp} title={t('sql:queryBuilder.groupOrder')} />
                  <div className="grid grid-cols-[1fr_1fr_100px_80px] gap-2 items-end">
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1 block">GROUP BY</Label>
                      <Input value={groupBy} onChange={(e) => setGroupBy(e.target.value)} placeholder="col1, col2" className="h-9 text-sm font-mono" />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1 block">ORDER BY</Label>
                      <Input value={orderBy} onChange={(e) => setOrderBy(e.target.value)} placeholder="column" className="h-9 text-sm font-mono" />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1 block">{t('sql:queryBuilder.direction')}</Label>
                      <Select value={orderDir} onValueChange={(v) => setOrderDir(v as 'ASC' | 'DESC')}>
                        <SelectTrigger className="h-9 text-sm font-mono"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ASC">ASC</SelectItem>
                          <SelectItem value="DESC">DESC</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1 block">LIMIT</Label>
                      <Input value={limitValue} onChange={(e) => setLimitValue(e.target.value)} className="h-9 text-sm font-mono" type="number" />
                    </div>
                  </div>
                </div>
              </>
            ) : queryType === 'INSERT' ? (
              <div className="space-y-2">
                <SectionHeader icon={TableProperties} title={t('sql:queryBuilder.columnValues')} onAdd={() => setInsertValues([...insertValues, { column: '', value: '' }])} />
                {insertValues.map((cv, i) => <ValueRow key={i} cv={cv} idx={i} onUpdate={(idx, f, v) => setInsertValues(listUpdate(insertValues, idx, f, v) as ColumnValue[])} onRemove={(idx) => setInsertValues(insertValues.filter((_, j) => j !== idx))} />)}
                {insertValues.length === 0 && <p className="text-xs text-muted-foreground pl-5">{t('sql:queryBuilder.addPairs')}</p>}
              </div>
            ) : queryType === 'UPDATE' ? (
              <>
                <div className="space-y-2">
                  <SectionHeader icon={TableProperties} title={t('sql:queryBuilder.setValues')} onAdd={() => setSetValues([...setValues, { column: '', value: '' }])} />
                  {setValues.map((cv, i) => <ValueRow key={i} cv={cv} idx={i} onUpdate={(idx, f, v) => setSetValues(listUpdate(setValues, idx, f, v) as ColumnValue[])} onRemove={(idx) => setSetValues(setValues.filter((_, j) => j !== idx))} />)}
                  {setValues.length === 0 && <p className="text-xs text-muted-foreground pl-5">{t('sql:queryBuilder.addPairs')}</p>}
                </div>
                <Separator />
                <div className="space-y-2">
                  <SectionHeader icon={Filter} title={t('sql:queryBuilder.filters')} onAdd={() => setUpdateWheres([...updateWheres, { column: '', operator: '=', value: '' }])} />
                  {updateWheres.map((w, i) => <WhereRow key={i} w={w} idx={i} onUpdate={(idx, f, v) => setUpdateWheres(listUpdate(updateWheres, idx, f, v) as WhereCondition[])} onRemove={(idx) => setUpdateWheres(updateWheres.filter((_, j) => j !== idx))} />)}
                  {updateWheres.length === 0 && <p className="text-xs text-muted-foreground pl-5">{t('sql:queryBuilder.noFilters')}</p>}
                </div>
              </>
            ) : (
              <div className="space-y-2">
                <SectionHeader icon={Filter} title={t('sql:queryBuilder.filters')} onAdd={() => setDeleteWheres([...deleteWheres, { column: '', operator: '=', value: '' }])} />
                {deleteWheres.map((w, i) => <WhereRow key={i} w={w} idx={i} onUpdate={(idx, f, v) => setDeleteWheres(listUpdate(deleteWheres, idx, f, v) as WhereCondition[])} onRemove={(idx) => setDeleteWheres(deleteWheres.filter((_, j) => j !== idx))} />)}
                {deleteWheres.length === 0 && <p className="text-xs text-muted-foreground pl-5">{t('sql:queryBuilder.noFilters')}</p>}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right: SQL Preview */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{t('sql:queryBuilder.sqlPreview')}</CardTitle>
                <Badge className={`font-mono text-xs border ${TYPE_COLORS[queryType]}`} variant="outline">{queryType}</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted/30 rounded-lg p-4 text-sm font-mono overflow-auto min-h-[120px] max-h-[300px] whitespace-pre-wrap border">
                {generatedSQL || <span className="text-muted-foreground italic">{t('sql:queryBuilder.selectTable')}</span>}
              </pre>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Results */}
      {result && (
        <Card className="mt-4">
          <CardHeader>
            <div className="flex items-center gap-3">
              <CardTitle className="text-base">{t('sql:tabs.results')}</CardTitle>
              <Badge variant="secondary" className="font-mono">{result.rowCount} rows</Badge>
              <Badge variant="outline" className="font-mono text-xs">{result.duration_ms}ms</Badge>
            </div>
          </CardHeader>
          <CardContent className="overflow-auto max-h-[400px]">
            <Table>
              <TableHeader>
                <TableRow>
                  {result.fields.map((f) => <TableHead key={f} className="font-mono text-xs whitespace-nowrap">{f}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.rows.slice(0, 100).map((row, i) => (
                  <TableRow key={i}>
                    {result.fields.map((f) => (
                      <TableCell key={f} className="font-mono text-xs max-w-[200px] truncate">
                        {row[f] === null ? <span className="italic text-muted-foreground">NULL</span> : String(row[f])}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Create Endpoint Dialog */}
      <Dialog open={epDialogOpen} onOpenChange={setEpDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('sql:queryBuilder.createEndpointDialog.title')}</DialogTitle>
            <DialogDescription>{t('sql:queryBuilder.createEndpointDialog.description')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">{t('sql:queryBuilder.createEndpointDialog.name')}</Label>
              <Input value={epName} onChange={(e) => setEpName(e.target.value)} placeholder={t('sql:queryBuilder.createEndpointDialog.namePlaceholder')} />
            </div>
            <div className="grid grid-cols-[100px_1fr] gap-2">
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">{t('sql:queryBuilder.createEndpointDialog.method')}</Label>
                <Input value={METHOD_MAP[queryType]} readOnly className="font-mono bg-muted/30" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">{t('sql:queryBuilder.createEndpointDialog.path')}</Label>
                <Input value={epPath} onChange={(e) => setEpPath(e.target.value)} className="font-mono" placeholder="/api/resource" />
              </div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">SQL</Label>
              <pre className="bg-muted/30 rounded-lg p-3 text-xs font-mono overflow-auto max-h-[120px] border">{generatedSQL}</pre>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEpDialogOpen(false)}>{t('common:actions.cancel')}</Button>
            <Button onClick={() => createEndpointMutation.mutate()} disabled={!epName || !epPath || createEndpointMutation.isPending}>
              {createEndpointMutation.isPending ? t('common:actions.saving') : t('sql:queryBuilder.createEndpoint')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageWrapper>
  );
}
