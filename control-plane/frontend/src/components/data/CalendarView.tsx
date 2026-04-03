import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface CalendarViewProps {
  rows: Record<string, unknown>[];
  columns: { name: string; type: string }[];
}

export function CalendarView({ rows, columns }: CalendarViewProps) {
  const { t } = useTranslation('data');

  const dateColumns = useMemo(
    () => columns.filter((c) =>
      ['date', 'timestamp without time zone', 'timestamp with time zone', 'timestamptz'].includes(c.type)
      || c.name.includes('date') || c.name.includes('_at'),
    ),
    [columns],
  );

  const [dateColumn, setDateColumn] = useState(dateColumns[0]?.name ?? '');
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Group rows by date
  const eventsByDate = useMemo(() => {
    if (!dateColumn) return {};
    const map: Record<number, Record<string, unknown>[]> = {};
    for (const row of rows) {
      const val = row[dateColumn];
      if (!val) continue;
      const d = new Date(String(val));
      if (isNaN(d.getTime())) continue;
      if (d.getFullYear() === year && d.getMonth() === month) {
        const day = d.getDate();
        if (!map[day]) map[day] = [];
        map[day].push(row);
      }
    }
    return map;
  }, [rows, dateColumn, year, month]);

  const labelColumn = columns.find(
    (c) => !['id', 'created_at', 'updated_at', 'deleted_at'].includes(c.name)
      && c.name !== dateColumn
      && ['text', 'character varying', 'varchar'].includes(c.type),
  );

  const prevMonth = () => setCurrentMonth(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentMonth(new Date(year, month + 1, 1));

  if (dateColumns.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p>{t('views.calendar.noDateColumn')}</p>
      </div>
    );
  }

  const weekDays = [
    t('views.calendar.sun'), t('views.calendar.mon'), t('views.calendar.tue'),
    t('views.calendar.wed'), t('views.calendar.thu'), t('views.calendar.fri'),
    t('views.calendar.sat'),
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Label>{t('views.calendar.dateField')}</Label>
          <Select value={dateColumn} onValueChange={setDateColumn}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {dateColumns.map((c) => (
                <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={prevMonth}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="font-semibold min-w-[150px] text-center">
            {currentMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
          </span>
          <Button variant="outline" size="icon" onClick={nextMonth}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden">
        {/* Day headers */}
        {weekDays.map((day) => (
          <div key={day} className="bg-muted p-2 text-center text-xs font-semibold">
            {day}
          </div>
        ))}

        {/* Empty cells before first day */}
        {Array.from({ length: firstDay }).map((_, i) => (
          <div key={`empty-${i}`} className="bg-background p-2 min-h-[80px]" />
        ))}

        {/* Day cells */}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const events = eventsByDate[day] ?? [];
          const isToday = day === new Date().getDate() && month === new Date().getMonth() && year === new Date().getFullYear();
          return (
            <div
              key={day}
              className={cn('bg-background p-1 min-h-[80px]', isToday && 'ring-2 ring-primary ring-inset')}
            >
              <div className="flex justify-between items-start">
                <span className={cn('text-xs font-medium px-1', isToday ? 'text-primary font-bold' : 'text-muted-foreground')}>
                  {day}
                </span>
                {events.length > 0 && (
                  <Badge variant="secondary" className="text-[10px] px-1">{events.length}</Badge>
                )}
              </div>
              <div className="space-y-0.5 mt-1">
                {events.slice(0, 3).map((ev) => (
                  <Popover key={String(ev.id)}>
                    <PopoverTrigger asChild>
                      <div className="text-[10px] px-1 py-0.5 bg-primary/10 rounded truncate cursor-pointer hover:bg-primary/20">
                        {labelColumn ? String(ev[labelColumn.name] ?? '') : `#${String(ev.id).slice(0, 6)}`}
                      </div>
                    </PopoverTrigger>
                    <PopoverContent className="w-64 text-xs">
                      {columns.slice(0, 6).map((col) => (
                        <div key={col.name} className="flex justify-between py-0.5">
                          <span className="text-muted-foreground">{col.name}:</span>
                          <span className="font-mono truncate ml-2 max-w-[120px]">
                            {ev[col.name] === null ? 'NULL' : String(ev[col.name])}
                          </span>
                        </div>
                      ))}
                    </PopoverContent>
                  </Popover>
                ))}
                {events.length > 3 && (
                  <div className="text-[10px] text-muted-foreground px-1">
                    +{events.length - 3} {t('views.calendar.more')}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
