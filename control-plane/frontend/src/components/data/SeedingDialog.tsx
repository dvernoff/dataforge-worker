import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/number-input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { dataApi } from '@/api/data.api';
import type { ColumnInfo } from '@/api/schema.api';
import { toast } from 'sonner';

const GENERATOR_TYPES = [
  'name', 'email', 'phone', 'address', 'uuid',
  'integer', 'float', 'boolean', 'date',
  'paragraph', 'sentence', 'word', 'custom_list',
] as const;

const SKIP_COLUMNS = new Set(['id', 'created_at', 'updated_at', 'deleted_at']);

interface SeedingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  tableName: string;
  columns: ColumnInfo[];
}

function getDefaultGenerator(col: ColumnInfo): string {
  const type = col.type.toLowerCase();
  const name = col.name.toLowerCase();

  // Infer from column name
  if (name.includes('email')) return 'email';
  if (name.includes('name')) return 'name';
  if (name.includes('phone')) return 'phone';
  if (name.includes('address')) return 'address';

  // Infer from column type
  if (type === 'uuid') return 'uuid';
  if (type.includes('bool')) return 'boolean';
  if (type.includes('int') || type === 'serial' || type === 'bigserial') return 'integer';
  if (type.includes('float') || type.includes('double') || type.includes('decimal')) return 'float';
  if (type.includes('date') || type.includes('timestamp')) return 'date';
  if (type.includes('text') || type.includes('char')) return 'sentence';

  return 'word';
}

export function SeedingDialog({ open, onOpenChange, projectId, tableName, columns }: SeedingDialogProps) {
  const { t } = useTranslation(['data', 'common']);
  const queryClient = useQueryClient();

  const seedableColumns = columns.filter((c) => !SKIP_COLUMNS.has(c.name));

  const [count, setCount] = useState(10);
  const [generators, setGenerators] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const col of seedableColumns) {
      initial[col.name] = getDefaultGenerator(col);
    }
    return initial;
  });

  const seedMutation = useMutation({
    mutationFn: () => dataApi.seedTable(projectId, tableName, {
      count,
      generators,
    }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['data', projectId, tableName] });
      toast.success(t('seeding.success', { count: result.inserted }));
      onOpenChange(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (seedableColumns.length === 0) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('seeding.title')}</DialogTitle></DialogHeader>
          <p className="text-muted-foreground text-sm">{t('seeding.noColumns')}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common:actions.cancel')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{t('seeding.title')}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>{t('seeding.count')}</Label>
            <NumberInput
              min={1}
              max={50}
              value={count}
              onChange={setCount}
              className="mt-1 w-40"
            />
          </div>

          <ScrollArea className="max-h-[400px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('common:table.column')}</TableHead>
                  <TableHead>{t('common:table.type')}</TableHead>
                  <TableHead>{t('seeding.generator')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {seedableColumns.map((col) => (
                  <TableRow key={col.name}>
                    <TableCell className="font-mono text-sm">{col.name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{col.type}</Badge>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={generators[col.name] ?? 'word'}
                        onValueChange={(v) => setGenerators({ ...generators, [col.name]: v })}
                      >
                        <SelectTrigger className="w-40">
                          {t(`seeding.generators.${generators[col.name] ?? 'word'}` as string)}
                        </SelectTrigger>
                        <SelectContent>
                          {GENERATOR_TYPES.map((gt) => (
                            <SelectItem key={gt} value={gt}>
                              {t(`seeding.generators.${gt}` as string)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common:actions.cancel')}</Button>
          <Button
            onClick={() => seedMutation.mutate()}
            disabled={seedMutation.isPending}
          >
            {seedMutation.isPending ? t('seeding.seeding') : t('seeding.seed')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
