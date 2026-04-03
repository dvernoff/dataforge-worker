import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';

interface KanbanViewProps {
  rows: Record<string, unknown>[];
  columns: { name: string; type: string }[];
}

export function KanbanView({ rows, columns }: KanbanViewProps) {
  const { t } = useTranslation('data');

  // Find text/varchar columns as potential status columns
  const statusColumns = useMemo(
    () => columns.filter((c) => ['text', 'character varying', 'varchar'].includes(c.type)),
    [columns],
  );

  const [groupByColumn, setGroupByColumn] = useState(statusColumns[0]?.name ?? '');

  // Group rows by the selected column value
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

  const displayColumns = columns.filter(
    (c) => !['id', 'created_at', 'updated_at', 'deleted_at'].includes(c.name) && c.name !== groupByColumn,
  ).slice(0, 3);

  if (statusColumns.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p>{t('views.kanban.noStatusColumn')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Label>{t('views.kanban.groupBy')}</Label>
        <Select value={groupByColumn} onValueChange={setGroupByColumn}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {statusColumns.map((c) => (
              <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-4">
        {Object.entries(groups).map(([groupName, groupRows]) => (
          <div key={groupName} className="min-w-[280px] max-w-[320px] flex-shrink-0">
            <div className="flex items-center gap-2 mb-3 px-1">
              <h3 className="font-semibold text-sm">{groupName}</h3>
              <Badge variant="secondary" className="text-xs">{groupRows.length}</Badge>
            </div>
            <ScrollArea className="h-[500px]">
              <div className="space-y-2 pr-2">
                {groupRows.map((row) => (
                  <Card key={String(row.id)} className="cursor-pointer hover:shadow-md transition-shadow">
                    <CardContent className="p-3">
                      <p className="font-mono text-xs text-muted-foreground mb-1">
                        #{String(row.id).slice(0, 8)}
                      </p>
                      {displayColumns.map((col) => (
                        <div key={col.name} className="flex justify-between text-xs mt-1">
                          <span className="text-muted-foreground">{col.name}:</span>
                          <span className="font-mono truncate ml-2 max-w-[150px]">
                            {row[col.name] === null ? 'NULL' : String(row[col.name])}
                          </span>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </ScrollArea>
          </div>
        ))}
      </div>
    </div>
  );
}
