import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Clock, Calendar } from 'lucide-react';

interface CronBuilderProps {
  value: string;
  onChange: (value: string) => void;
}

function parseCron(expr: string): string[] {
  const parts = expr.trim().split(/\s+/);
  while (parts.length < 5) parts.push('*');
  return parts.slice(0, 5);
}

function getNextExecutions(cronExpr: string, count: number = 3): Date[] {
  const parts = parseCron(cronExpr);
  const [minPart, hourPart, domPart, monthPart, dowPart] = parts;
  const results: Date[] = [];
  const check = new Date();
  check.setSeconds(0);
  check.setMilliseconds(0);
  check.setMinutes(check.getMinutes() + 1);

  const parseField = (field: string, min: number, max: number): number[] => {
    if (field === '*') return Array.from({ length: max - min + 1 }, (_, i) => i + min);
    const values: number[] = [];
    for (const part of field.split(',')) {
      if (part.includes('/')) {
        const [range, stepStr] = part.split('/');
        const step = parseInt(stepStr);
        const start = range === '*' ? min : parseInt(range);
        for (let i = start; i <= max; i += step) values.push(i);
      } else if (part.includes('-')) {
        const [a, b] = part.split('-').map(Number);
        for (let i = a; i <= b; i++) values.push(i);
      } else {
        values.push(parseInt(part));
      }
    }
    return values.filter(v => v >= min && v <= max);
  };

  const minutes = parseField(minPart, 0, 59);
  const hours = parseField(hourPart, 0, 23);
  const doms = parseField(domPart, 1, 31);
  const months = parseField(monthPart, 1, 12);
  const dows = parseField(dowPart, 0, 6);

  let maxIter = 525600;
  while (results.length < count && maxIter-- > 0) {
    const m = check.getMinutes();
    const h = check.getHours();
    const d = check.getDate();
    const mo = check.getMonth() + 1;
    const dow = check.getDay();

    if (minutes.includes(m) && hours.includes(h) && doms.includes(d) && months.includes(mo) && dows.includes(dow)) {
      results.push(new Date(check));
    }
    check.setMinutes(check.getMinutes() + 1);
  }
  return results;
}

const PRESET_KEYS = [
  { key: 'everyMinute', value: '* * * * *' },
  { key: 'everyHour', value: '0 * * * *' },
  { key: 'everyDayMidnight', value: '0 0 * * *' },
  { key: 'everyMonday', value: '0 0 * * 1' },
  { key: 'everyMonth', value: '0 0 1 * *' },
];

const FIELD_KEYS = ['minute', 'hour', 'dayMonth', 'month', 'dayWeek'];
const HINT_KEYS = ['hintMinute', 'hintHour', 'hintDayMonth', 'hintMonth', 'hintDayWeek'];

export function CronBuilder({ value, onChange }: CronBuilderProps) {
  const { t } = useTranslation('cron');
  const parts = parseCron(value);

  const updatePart = (index: number, val: string) => {
    const newParts = [...parts];
    newParts[index] = val || '*';
    onChange(newParts.join(' '));
  };

  const nextExecutions = useMemo(() => {
    try {
      return getNextExecutions(value, 3);
    } catch {
      return [];
    }
  }, [value]);

  const formatExecution = (d: Date) => {
    return d.toLocaleString(undefined, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  };

  return (
    <div className="space-y-3">
      {/* Presets */}
      <div className="flex flex-wrap gap-1.5">
        {PRESET_KEYS.map((p) => (
          <Badge
            key={p.value}
            variant={value === p.value ? 'default' : 'outline'}
            className="cursor-pointer text-[11px] px-2 py-0.5"
            onClick={() => onChange(p.value)}
          >
            {t(`builder.${p.key}`)}
          </Badge>
        ))}
      </div>

      {/* Cron fields — compact grid */}
      <div className="grid grid-cols-5 gap-1.5">
        {parts.map((part, i) => (
          <div key={i} className="text-center">
            <div className="text-[10px] text-muted-foreground mb-0.5 font-medium">
              {t(`builder.${FIELD_KEYS[i]}`)}
            </div>
            <Input
              value={part}
              onChange={(e) => updatePart(i, e.target.value)}
              className="font-mono text-center text-sm h-8 px-1"
              placeholder="*"
            />
            <div className="text-[9px] text-muted-foreground/60 mt-0.5">
              {t(`builder.${HINT_KEYS[i]}`)}
            </div>
          </div>
        ))}
      </div>

      {/* Expression + Next executions — single row */}
      <div className="flex items-start gap-4">
        <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
          <code className="text-xs font-mono bg-muted px-2 py-0.5 rounded">{value}</code>
        </div>

        {nextExecutions.length > 0 && (
          <div className="flex-1 min-w-0">
            <div className="text-[10px] text-muted-foreground flex items-center gap-1 mb-0.5">
              <Calendar className="h-3 w-3" />
              {t('builder.nextExecutions')}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-0">
              {nextExecutions.map((d, i) => (
                <span key={i} className="text-[11px] text-muted-foreground font-mono">
                  {formatExecution(d)}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
