import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Search, Play, TableIcon, BarChart3 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { explorerApi } from '@/api/explorer.api';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useCurrentProject } from '@/hooks/useProject';
import { toast } from 'sonner';
import { showErrorToast } from '@/lib/show-error-toast';
import type { PivotConfig, PivotResult } from '@/api/explorer.api';

export function DataExplorerPage() {
  const { t } = useTranslation('explorer');
  usePageTitle(t('title'));
  const { data: project } = useCurrentProject();
  const projectId = project?.id;

  const [selectedTable, setSelectedTable] = useState<string>('');
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [selectedValues, setSelectedValues] = useState<string>('');
  const [aggregation, setAggregation] = useState<PivotConfig['aggregation']>('count');
  const [viewMode, setViewMode] = useState<'table' | 'chart'>('table');
  const [results, setResults] = useState<PivotResult | null>(null);

  const { data: tablesData, isLoading: tablesLoading } = useQuery({
    queryKey: ['explorer-tables', projectId],
    queryFn: () => explorerApi.getTables(projectId!),
    enabled: !!projectId,
  });

  const pivotMutation = useMutation({
    mutationFn: (config: PivotConfig) => explorerApi.executePivot(projectId!, config),
    onSuccess: (data) => setResults(data),
    onError: (err: Error) => showErrorToast(err),
  });

  const tables = tablesData?.tables ?? [];
  const currentTable = tables.find((t) => t.name === selectedTable);
  const columns = currentTable?.columns ?? [];

  const handleTableChange = (tableName: string) => {
    setSelectedTable(tableName);
    setSelectedRows([]);
    setSelectedValues('');
    setResults(null);
  };

  const toggleRow = (col: string) => {
    setSelectedRows((prev) =>
      prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]
    );
  };

  const handleRun = () => {
    if (!selectedTable || selectedRows.length === 0 || !selectedValues) return;

    pivotMutation.mutate({
      table: selectedTable,
      rows: selectedRows,
      values: selectedValues,
      aggregation,
    });
  };

  // Simple bar chart using divs
  const maxVal = results?.rows?.length
    ? Math.max(...results.rows.map((r) => Number(r.agg_value ?? 0)))
    : 0;

  return (
    <PageWrapper>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left Panel — Configuration */}
        <div className="lg:col-span-1 space-y-4">
          {/* Table Select */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{t('selectTable')}</CardTitle>
            </CardHeader>
            <CardContent>
              {tablesLoading ? (
                <Skeleton className="h-10" />
              ) : tables.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('noTables')}</p>
              ) : (
                <Select value={selectedTable} onValueChange={handleTableChange}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('selectTablePlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {tables.map((tbl) => (
                      <SelectItem key={tbl.name} value={tbl.name}>{tbl.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </CardContent>
          </Card>

          {/* Group By (Rows) */}
          {selectedTable && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">{t('rows')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {columns.map((col) => (
                    <div key={col.name} className="flex items-center gap-2">
                      <Checkbox
                        id={`row-${col.name}`}
                        checked={selectedRows.includes(col.name)}
                        onCheckedChange={() => toggleRow(col.name)}
                      />
                      <Label htmlFor={`row-${col.name}`} className="text-sm flex items-center gap-1">
                        {col.name}
                        <Badge variant="outline" className="text-[10px] px-1">{col.type}</Badge>
                      </Label>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Value Column */}
          {selectedTable && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">{t('values')}</CardTitle>
              </CardHeader>
              <CardContent>
                <Select value={selectedValues} onValueChange={setSelectedValues}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('selectValue')} />
                  </SelectTrigger>
                  <SelectContent>
                    {columns.map((col) => (
                      <SelectItem key={col.name} value={col.name}>{col.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>
          )}

          {/* Aggregation */}
          {selectedTable && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">{t('aggregation')}</CardTitle>
              </CardHeader>
              <CardContent>
                <Select value={aggregation} onValueChange={(v) => setAggregation(v as PivotConfig['aggregation'])}>
                  <SelectTrigger>
                    {t(`aggregations.${aggregation}`)}
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="count">{t('aggregations.count')}</SelectItem>
                    <SelectItem value="sum">{t('aggregations.sum')}</SelectItem>
                    <SelectItem value="avg">{t('aggregations.avg')}</SelectItem>
                    <SelectItem value="min">{t('aggregations.min')}</SelectItem>
                    <SelectItem value="max">{t('aggregations.max')}</SelectItem>
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>
          )}

          {/* Run Button */}
          {selectedTable && (
            <Button
              className="w-full"
              onClick={handleRun}
              disabled={selectedRows.length === 0 || !selectedValues || pivotMutation.isPending}
            >
              <Play className="h-4 w-4 mr-2" />
              {pivotMutation.isPending ? t('running') : t('run')}
            </Button>
          )}
        </div>

        {/* Right Panel — Results */}
        <div className="lg:col-span-3">
          {!results ? (
            <Card className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Search className="h-10 w-10 mb-4" />
              <p className="text-sm">{t('noResults')}</p>
              <p className="text-xs mt-1">{t('noResultsDesc')}</p>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">
                    {t('results')} ({t('rowCount', { count: results.rowCount })})
                  </CardTitle>
                  <div className="flex gap-1">
                    <Button
                      variant={viewMode === 'table' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setViewMode('table')}
                    >
                      <TableIcon className="h-4 w-4 mr-1" />
                      {t('tableView')}
                    </Button>
                    <Button
                      variant={viewMode === 'chart' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setViewMode('chart')}
                    >
                      <BarChart3 className="h-4 w-4 mr-1" />
                      {t('chartView')}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {viewMode === 'table' ? (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {results.columns.map((col) => (
                            <TableHead key={col}>{col}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {results.rows.map((row, i) => (
                          <TableRow key={i}>
                            {results.columns.map((col) => (
                              <TableCell key={col} className="font-mono text-sm">
                                {String(row[col] ?? '')}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {results.rows.slice(0, 20).map((row, i) => {
                      const label = selectedRows.map((r) => String(row[r] ?? '')).join(' / ');
                      const value = Number(row.agg_value ?? 0);
                      const width = maxVal > 0 ? (value / maxVal) * 100 : 0;
                      return (
                        <div key={i} className="flex items-center gap-3">
                          <span className="text-sm min-w-[120px] truncate text-right">{label}</span>
                          <div className="flex-1 bg-muted rounded-full h-6 overflow-hidden">
                            <div
                              className="bg-primary h-full rounded-full flex items-center justify-end px-2 transition-all"
                              style={{ width: `${Math.max(width, 2)}%` }}
                            >
                              <span className="text-[10px] font-medium text-primary-foreground">
                                {typeof value === 'number' ? value.toLocaleString() : value}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </PageWrapper>
  );
}
