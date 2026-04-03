import { useState, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Clock, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { api } from '@/api/client';

interface TimeTravelPanelProps {
  projectId: string;
  tableName: string;
  columns: { name: string; type: string }[];
  onClose: () => void;
}

export function TimeTravelPanel({ projectId, tableName, columns, onClose }: TimeTravelPanelProps) {
  const { t } = useTranslation('data');

  // Fetch retention days from system settings
  const { data: publicSettings } = useQuery({
    queryKey: ['system-settings-public'],
    queryFn: () => api.get<{ settings: Record<string, string> }>('/system/settings/public'),
    staleTime: 60_000,
  });

  const retentionDays = Number(publicSettings?.settings?.time_travel_days ?? '7');

  const now = useRef(Date.now()).current;
  const minTime = now - retentionDays * 24 * 60 * 60 * 1000;

  const [sliderValue, setSliderValue] = useState([now]);
  const [dateInput, setDateInput] = useState('');
  const [activeTimestamp, setActiveTimestamp] = useState<string | null>(null);

  const selectedTime = useMemo(() => {
    if (dateInput) {
      const d = new Date(dateInput);
      if (!isNaN(d.getTime())) return d.toISOString();
    }
    return new Date(sliderValue[0]).toISOString();
  }, [sliderValue, dateInput]);

  const { data: timeTravelData, isFetching } = useQuery({
    queryKey: ['time-travel', projectId, tableName, activeTimestamp],
    queryFn: () => api.get<{
      data: Record<string, unknown>[];
      timestamp: string;
      total: number;
      changedFields: Record<string, string[]>;
    }>(`/projects/${projectId}/tables/${tableName}/time-travel?timestamp=${encodeURIComponent(activeTimestamp!)}&retention_days=${retentionDays}`),
    enabled: !!activeTimestamp,
  });

  const handleTravel = () => {
    setActiveTimestamp(selectedTime);
  };

  const formatSliderDate = (ms: number) => {
    return new Date(ms).toLocaleString();
  };

  return (
    <Card className="border-dashed border-2 border-muted-foreground/30 bg-muted/10">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Clock className="h-5 w-5" />
            {t('timeTravel.title')}
          </CardTitle>
          <Button variant="outline" size="sm" onClick={onClose}>
            <RotateCcw className="h-4 w-4 mr-1" />
            {t('timeTravel.returnToPresent')}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          {/* Slider */}
          <div className="md:col-span-2 space-y-2">
            <Label>{t('timeTravel.slider', { days: retentionDays })}</Label>
            <Slider
              value={sliderValue}
              onValueChange={setSliderValue}
              min={minTime}
              max={now}
              step={60000}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">
              {formatSliderDate(sliderValue[0])}
            </p>
          </div>

          {/* Date picker */}
          <div className="space-y-2">
            <Label>{t('timeTravel.datePicker')}</Label>
            <Input
              type="datetime-local"
              value={dateInput}
              onChange={(e) => setDateInput(e.target.value)}
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={handleTravel} disabled={isFetching}>
            {isFetching ? t('timeTravel.loading') : t('timeTravel.viewSnapshot')}
          </Button>
          {activeTimestamp && (
            <Badge variant="outline">
              {t('timeTravel.viewingAt', { time: new Date(activeTimestamp).toLocaleString() })}
            </Badge>
          )}
        </div>

        {/* Ghost-style data table */}
        {timeTravelData && (
          <div className="border rounded-lg overflow-auto opacity-80">
            <div className="flex items-center gap-2 px-4 py-2 bg-muted/50 border-b">
              <Badge variant="secondary">{t('timeTravel.recordCount', { count: timeTravelData.total })}</Badge>
              <span className="text-xs text-muted-foreground">
                {t('timeTravel.snapshotAt', { time: new Date(timeTravelData.timestamp).toLocaleString() })}
              </span>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((col) => (
                    <TableHead key={col.name} className="whitespace-nowrap font-mono text-xs">
                      {col.name}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {timeTravelData.data.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={columns.length} className="text-center py-8 text-muted-foreground">
                      {t('timeTravel.noRecords')}
                    </TableCell>
                  </TableRow>
                ) : (
                  timeTravelData.data.map((row) => {
                    const rowId = String(row.id);
                    const changed = timeTravelData.changedFields[rowId] ?? [];
                    return (
                      <TableRow key={rowId} className="bg-muted/20">
                        {columns.map((col) => {
                          const isChanged = changed.includes(col.name);
                          const value = row[col.name];
                          return (
                            <TableCell
                              key={col.name}
                              className={cn(
                                'max-w-[250px] truncate font-mono text-xs',
                                isChanged
                                  ? 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-300 font-semibold'
                                  : 'text-muted-foreground',
                              )}
                            >
                              {value === null || value === undefined
                                ? 'NULL'
                                : typeof value === 'object'
                                  ? JSON.stringify(value)
                                  : String(value)}
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
        )}
      </CardContent>
    </Card>
  );
}
