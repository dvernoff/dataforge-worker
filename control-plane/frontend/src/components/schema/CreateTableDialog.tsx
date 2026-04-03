import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X, Key, Clock, Fingerprint, Plug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { schemaApi, type CreateTableInput } from '@/api/schema.api';
import { endpointsApi } from '@/api/endpoints.api';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

const COLUMN_TYPES = [
  { value: 'text',        tech: 'text',        defaultHint: 'hello' },
  { value: 'integer',     tech: 'int4',        defaultHint: '0' },
  { value: 'bigint',      tech: 'int8',        defaultHint: '0' },
  { value: 'float',       tech: 'float8',      defaultHint: '0.0' },
  { value: 'decimal',     tech: 'numeric',     defaultHint: '0.00' },
  { value: 'boolean',     tech: 'bool',        defaultHint: 'true / false' },
  { value: 'date',        tech: 'date',        defaultHint: '2025-01-01' },
  { value: 'timestamp',   tech: 'timestamp',   defaultHint: 'now()' },
  { value: 'timestamptz', tech: 'timestamptz', defaultHint: 'now()' },
  { value: 'uuid',        tech: 'uuid',        defaultHint: 'auto' },
  { value: 'json',        tech: 'json',        defaultHint: '{}' },
  { value: 'jsonb',       tech: 'jsonb',       defaultHint: '{}' },
  { value: 'text[]',      tech: 'text[]',      defaultHint: 'a, b, c' },
  { value: 'integer[]',   tech: 'int4[]',      defaultHint: '1, 2, 3' },
];

interface ColumnRow {
  id: string;
  name: string;
  type: string;
  nullable: boolean;
  default_value: string;
  is_unique: boolean;
  is_primary: boolean;
}

function newColumn(): ColumnRow {
  return {
    id: crypto.randomUUID(),
    name: '',
    type: 'text',
    nullable: true,
    default_value: '',
    is_unique: false,
    is_primary: false,
  };
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
}

export function CreateTableDialog({ open, onOpenChange, projectId }: Props) {
  const { t } = useTranslation(['tables', 'common']);
  const [tableName, setTableName] = useState('');
  const [addTimestamps, setAddTimestamps] = useState(true);
  const [addUuidPk, setAddUuidPk] = useState(true);
  const [createEndpoints, setCreateEndpoints] = useState(false);
  const [columns, setColumns] = useState<ColumnRow[]>([newColumn()]);
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: (data: CreateTableInput) => schemaApi.createTable(projectId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tables', projectId] });
      toast.success(t('createDialog.tableCreated'));
      if (createEndpoints && tableName) {
        createCrudEndpoints(projectId, tableName).then(() => {
          queryClient.invalidateQueries({ queryKey: ['endpoints', projectId] });
          toast.success(t('createDialog.endpointsCreated'));
        }).catch(() => {});
      }
      resetForm();
      onOpenChange(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function resetForm() {
    setTableName('');
    setAddTimestamps(true);
    setAddUuidPk(true);
    setCreateEndpoints(false);
    setColumns([newColumn()]);
  }

  function updateColumn(id: string, field: keyof ColumnRow, value: unknown) {
    setColumns((prev) =>
      prev.map((col) => (col.id === id ? { ...col, [field]: value } : col))
    );
  }

  function removeColumn(id: string) {
    setColumns((prev) => prev.filter((col) => col.id !== id));
  }

  function handleSubmit() {
    if (!tableName.trim()) {
      toast.error(t('createDialog.nameRequired'));
      return;
    }
    const validColumns = columns.filter((c) => c.name.trim());
    if (validColumns.length === 0) {
      toast.error(t('createDialog.columnRequired'));
      return;
    }
    createMutation.mutate({
      name: tableName,
      columns: validColumns.map((c) => ({
        name: c.name,
        type: c.type,
        nullable: c.nullable,
        default_value: c.default_value || undefined,
        is_unique: c.is_unique,
        is_primary: c.is_primary,
      })),
      add_timestamps: addTimestamps,
      add_uuid_pk: addUuidPk,
    });
  }

  // Option pill component
  const OptionPill = ({ active, onClick, icon: Icon, label, hint }: {
    active: boolean;
    onClick: () => void;
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    hint: string;
  }) => (
    <Tooltip hoverable={false}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          className={cn(
            'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all border',
            active
              ? 'bg-primary/10 border-primary/40 text-primary'
              : 'bg-muted/50 border-transparent text-muted-foreground hover:text-foreground hover:bg-muted',
          )}
        >
          <Icon className="h-3 w-3" />
          {label}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[240px]">{hint}</TooltipContent>
    </Tooltip>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) resetForm(); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('createDialog.title')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Table name */}
          <Input
            value={tableName}
            onChange={(e) => setTableName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
            placeholder={t('createDialog.tableNamePlaceholder')}
            className="font-mono"
          />

          {/* Options as pill buttons */}
          <div className="flex flex-wrap gap-2">
            <OptionPill
              active={addUuidPk}
              onClick={() => setAddUuidPk(!addUuidPk)}
              icon={Fingerprint}
              label="UUID PK"
              hint={t('createDialog.uuidPkHint')}
            />
            <OptionPill
              active={addTimestamps}
              onClick={() => setAddTimestamps(!addTimestamps)}
              icon={Clock}
              label="Timestamps"
              hint={t('createDialog.timestampsHint')}
            />
            <OptionPill
              active={createEndpoints}
              onClick={() => setCreateEndpoints(!createEndpoints)}
              icon={Plug}
              label={t('createDialog.createEndpoints')}
              hint={t('createDialog.createEndpointsHint')}
            />
          </div>

          {/* Columns */}
          <div className="rounded-lg border border-border bg-muted/20 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
              <span className="text-sm font-medium">{t('createDialog.columns')}</span>
              <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => setColumns([...columns, newColumn()])}>
                <Plus className="h-3 w-3 mr-1" />
                {t('createDialog.addColumn')}
              </Button>
            </div>

            {/* Column labels */}
            <div className="grid grid-cols-[1fr_1fr_1fr_28px_28px_20px] gap-2 px-3 pt-2 pb-1 items-center">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{t('createDialog.columnHeaders.name')}</span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{t('createDialog.columnHeaders.type')}</span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{t('createDialog.columnHeaders.default')}</span>
              <Tooltip hoverable={false}>
                <TooltipTrigger asChild>
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider cursor-help text-center">N</span>
                </TooltipTrigger>
                <TooltipContent>{t('createDialog.nullHint')}</TooltipContent>
              </Tooltip>
              <Tooltip hoverable={false}>
                <TooltipTrigger asChild>
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider cursor-help text-center">UQ</span>
                </TooltipTrigger>
                <TooltipContent>{t('createDialog.uniqueHint')}</TooltipContent>
              </Tooltip>
              <span />
            </div>

            {/* Rows */}
            <div className="max-h-[246px] overflow-y-auto">
              <div className="px-3 pb-2 space-y-1">
                {columns.map((col) => {
                  const typeInfo = COLUMN_TYPES.find((ct) => ct.value === col.type);
                  return (
                    <div key={col.id} className="grid grid-cols-[1fr_1fr_1fr_28px_28px_20px] gap-2 items-center group">
                      {/* Name */}
                      <Input
                        value={col.name}
                        onChange={(e) => updateColumn(col.id, 'name', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                        placeholder="column_name"
                        className="font-mono h-8 text-sm min-w-0"
                      />
                      {/* Type */}
                      <Select value={col.type} onValueChange={(v) => updateColumn(col.id, 'type', v)}>
                        <SelectTrigger className="h-8 w-full text-sm min-w-0">
                          <span className="flex items-center gap-1 truncate overflow-hidden">
                            <span className="truncate">{t(`createDialog.types.${col.type}` as string)}</span>
                            <span className="text-[10px] text-muted-foreground font-mono shrink-0">{typeInfo?.tech}</span>
                          </span>
                        </SelectTrigger>
                        <SelectContent>
                          {COLUMN_TYPES.map((ct) => (
                            <SelectItem key={ct.value} value={ct.value}>
                              <span className="flex items-center gap-2">
                                <span>{t(`createDialog.types.${ct.value}` as string)}</span>
                                <span className="text-[10px] text-muted-foreground font-mono">{ct.tech}</span>
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {/* Default */}
                      <Input
                        value={col.default_value}
                        onChange={(e) => updateColumn(col.id, 'default_value', e.target.value)}
                        placeholder={typeInfo?.defaultHint ?? ''}
                        className="font-mono h-8 text-sm min-w-0"
                      />
                      {/* Nullable */}
                      <div className="flex justify-center">
                        <Checkbox
                          checked={col.nullable}
                          onCheckedChange={(v) => updateColumn(col.id, 'nullable', !!v)}
                        />
                      </div>
                      {/* Unique */}
                      <div className="flex justify-center">
                        <Checkbox
                          checked={col.is_unique}
                          onCheckedChange={(v) => updateColumn(col.id, 'is_unique', !!v)}
                        />
                      </div>
                      {/* Remove */}
                      <button
                        type="button"
                        onClick={() => removeColumn(col.id)}
                        disabled={columns.length <= 1}
                        className="flex justify-center text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-0"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common:actions.cancel')}</Button>
          <Button onClick={handleSubmit} disabled={createMutation.isPending}>
            {createMutation.isPending ? t('createDialog.creating') : t('createDialog.createBtn')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

async function createCrudEndpoints(projectId: string, tableName: string) {
  const endpoints = [
    { method: 'GET',    path: `/${tableName}`,     description: `List all ${tableName}`,       source_type: 'table', source_config: { table: tableName, operation: 'list' },   auth_type: 'api_token' },
    { method: 'GET',    path: `/${tableName}/:id`, description: `Get single ${tableName}`,     source_type: 'table', source_config: { table: tableName, operation: 'get' },    auth_type: 'api_token' },
    { method: 'POST',   path: `/${tableName}`,     description: `Create ${tableName} record`,  source_type: 'table', source_config: { table: tableName, operation: 'create' }, auth_type: 'api_token' },
    { method: 'PUT',    path: `/${tableName}/:id`, description: `Update ${tableName} record`,  source_type: 'table', source_config: { table: tableName, operation: 'update' }, auth_type: 'api_token' },
    { method: 'DELETE', path: `/${tableName}/:id`, description: `Delete ${tableName} record`,  source_type: 'table', source_config: { table: tableName, operation: 'delete' }, auth_type: 'api_token' },
  ];
  await Promise.allSettled(endpoints.map((ep) => endpointsApi.create(projectId, ep)));
}
