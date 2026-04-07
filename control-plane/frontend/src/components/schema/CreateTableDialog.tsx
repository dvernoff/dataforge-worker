import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X, Clock, Fingerprint, Plug, Copy, XCircle, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { schemaApi, type CreateTableInput } from '@/api/schema.api';
import { createCrudEndpoints } from '@/lib/schema-utils';
import { parseYamlSchema, yamlSchemaToApiPayloads, getYamlTemplate } from '@/lib/yaml-schema';
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
  const [tab, setTab] = useState('visual');
  const [tableName, setTableName] = useState('');
  const [addTimestamps, setAddTimestamps] = useState(true);
  const [addUuidPk, setAddUuidPk] = useState(true);
  const [createEndpointsOpt, setCreateEndpointsOpt] = useState(false);
  const [columns, setColumns] = useState<ColumnRow[]>([newColumn()]);
  const [yamlValue, setYamlValue] = useState('');
  const [yamlErrors, setYamlErrors] = useState<string[]>([]);
  const [yamlWarnings, setYamlWarnings] = useState<string[]>([]);
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: (data: CreateTableInput) => schemaApi.createTable(projectId, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tables', projectId] });
      toast.success(t('createDialog.tableCreated'));
      if (createEndpointsOpt && variables.name) {
        createCrudEndpoints(projectId, variables.name).then(() => {
          queryClient.invalidateQueries({ queryKey: ['endpoints', projectId] });
          toast.success(t('createDialog.endpointsCreated'));
        }).catch((err: Error) => toast.error(err.message));
      }
      resetForm();
      onOpenChange(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function resetForm() {
    setTab('visual');
    setTableName('');
    setAddTimestamps(true);
    setAddUuidPk(true);
    setCreateEndpointsOpt(false);
    setColumns([newColumn()]);
    setYamlValue('');
    setYamlErrors([]);
    setYamlWarnings([]);
  }

  function updateColumn(id: string, field: keyof ColumnRow, value: unknown) {
    setColumns((prev) =>
      prev.map((col) => (col.id === id ? { ...col, [field]: value } : col))
    );
  }

  function removeColumn(id: string) {
    setColumns((prev) => prev.filter((col) => col.id !== id));
  }

  function handleVisualSubmit() {
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

  function handleYamlSubmit() {
    const result = parseYamlSchema(yamlValue);
    setYamlErrors(result.errors);
    setYamlWarnings(result.warnings);

    if (!result.success || !result.schema) return;

    const tableNames = Object.keys(result.schema.tables);
    if (tableNames.length > 1) {
      setYamlErrors([t('tables:yamlImport.singleTableOnly')]);
      return;
    }

    const payloads = yamlSchemaToApiPayloads(result.schema);
    const table = payloads.tables[0];

    createMutation.mutate({
      name: table.name,
      columns: table.columns,
      add_timestamps: table.add_timestamps,
      add_uuid_pk: table.add_uuid_pk,
    }, {
      onSuccess: async () => {
        // Add FKs and indexes after table creation
        for (const fk of payloads.foreignKeys) {
          try {
            await schemaApi.addForeignKey(projectId, fk.tableName, {
              source_column: fk.source_column,
              target_table: fk.target_table,
              target_column: fk.target_column,
              on_delete: fk.on_delete,
              on_update: fk.on_update,
            });
          } catch (e) {
            toast.error(`FK: ${(e as Error).message}`);
          }
        }
        for (const idx of payloads.indexes) {
          try {
            await schemaApi.addIndex(projectId, idx.tableName, {
              columns: idx.columns,
              type: idx.type,
              is_unique: idx.is_unique,
            });
          } catch (e) {
            toast.error(`Index: ${(e as Error).message}`);
          }
        }
        if (payloads.endpointTables.includes(table._name)) {
          try {
            await createCrudEndpoints(projectId, table._name);
            queryClient.invalidateQueries({ queryKey: ['endpoints', projectId] });
            toast.success(t('createDialog.endpointsCreated'));
          } catch { /* best effort */ }
        }
      },
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
      <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('createDialog.title')}</DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-3">
            <TabsTrigger value="visual">{t('createDialog.tabVisual')}</TabsTrigger>
            <TabsTrigger value="yaml">YAML</TabsTrigger>
          </TabsList>

          {/* ── Visual Tab ── */}
          <TabsContent value="visual" className="space-y-4 mt-0">
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
                active={createEndpointsOpt}
                onClick={() => setCreateEndpointsOpt(!createEndpointsOpt)}
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
          </TabsContent>

          {/* ── YAML Tab ── */}
          <TabsContent value="yaml" className="space-y-3 mt-0">
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => {
                navigator.clipboard.writeText(getYamlTemplate());
                toast.success(t('tables:yamlImport.templateCopied'));
              }}>
                <Copy className="h-3.5 w-3.5 mr-1.5" />
                {t('tables:yamlImport.copyTemplate')}
              </Button>
            </div>

            <Textarea
              value={yamlValue}
              onChange={(e) => { setYamlValue(e.target.value); setYamlErrors([]); }}
              placeholder={`# Define a single table in YAML format\n# For multiple tables, use "Import Schema" on the tables page\n\ntables:\n  my_table:\n    columns:\n      name:\n        type: text\n        nullable: false\n      email:\n        type: text\n        unique: true`}
              className="font-mono text-xs min-h-[280px] resize-y leading-relaxed"
              spellCheck={false}
            />

            {yamlErrors.length > 0 && (
              <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3 space-y-1">
                {yamlErrors.map((err, i) => (
                  <p key={i} className="text-xs text-destructive flex items-start gap-1.5">
                    <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    {err}
                  </p>
                ))}
              </div>
            )}

            {yamlWarnings.length > 0 && (
              <div className="rounded-md border border-amber-500/50 bg-amber-500/5 p-3 space-y-1">
                {yamlWarnings.map((w, i) => (
                  <p key={i} className="text-xs text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    {w}
                  </p>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common:actions.cancel')}</Button>
          {tab === 'visual' ? (
            <Button onClick={handleVisualSubmit} disabled={createMutation.isPending}>
              {createMutation.isPending ? t('createDialog.creating') : t('createDialog.createBtn')}
            </Button>
          ) : (
            <Button onClick={handleYamlSubmit} disabled={createMutation.isPending || !yamlValue.trim()}>
              {createMutation.isPending ? t('createDialog.creating') : t('createDialog.createBtn')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
