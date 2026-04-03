import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Save, Calculator, Pencil, Check, X } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { useCurrentProject } from '@/hooks/useProject';
import { schemaApi, type AlterColumnChange, type ColumnInfo, type ForeignKeyInfo, type IndexInfo } from '@/api/schema.api';
import { dataApi, type ValidationRule } from '@/api/data.api';
import { toast } from 'sonner';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useTranslation } from 'react-i18next';
import { showErrorToast } from '@/lib/show-error-toast';

const COLUMN_TYPES = [
  'text', 'integer', 'bigint', 'float', 'decimal', 'boolean',
  'date', 'timestamp', 'timestamptz', 'uuid', 'json', 'jsonb',
  'text[]', 'integer[]',
];


export function TableEditorPage() {
  const { t } = useTranslation('tables');
  usePageTitle(t('tableEditor'));
  const { slug, name: tableName } = useParams<{ slug: string; name: string }>();
  const navigate = useNavigate();
  const { data: project } = useCurrentProject();
  const queryClient = useQueryClient();
  const basePath = `/projects/${slug}`;

  const { data, isLoading } = useQuery({
    queryKey: ['table', project?.id, tableName],
    queryFn: () => schemaApi.getTable(project!.id, tableName!),
    enabled: !!project?.id && !!tableName,
  });

  const table = data?.table;

  if (isLoading) {
    return (
      <PageWrapper>
        <Skeleton className="h-8 w-64 mb-4" />
        <Skeleton className="h-96" />
      </PageWrapper>
    );
  }

  if (!table) {
    return (
      <PageWrapper>
        <p className="text-muted-foreground">{t('tableNotFound')}</p>
      </PageWrapper>
    );
  }

  return (
    <PageWrapper>
      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-2xl font-bold font-mono">{tableName}</h1>
        <div className="flex items-center gap-1 ml-2 border rounded-md p-0.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => navigate(`${basePath}/tables/${tableName}/data`)}
          >
            {t('tabs.data')}
          </Button>
          <Button variant="secondary" size="sm" className="h-7 text-xs">
            {t('tabs.columns')}
          </Button>
        </div>
        <Badge variant="secondary">{table.row_count.toLocaleString()} {t('rows')}</Badge>
      </div>

      <Tabs defaultValue="columns">
        <TabsList>
          <TabsTrigger value="columns">{t('tabs.columns')}</TabsTrigger>
          <TabsTrigger value="indexes">{t('tabs.indexes')}</TabsTrigger>
          <TabsTrigger value="fk">{t('tabs.fk')}</TabsTrigger>
          <TabsTrigger value="validation">{t('tabs.validation')}</TabsTrigger>
          <TabsTrigger value="sql">{t('tabs.sql')}</TabsTrigger>
        </TabsList>

        <TabsContent value="columns" className="mt-4">
          <ColumnsTab
            projectId={project!.id}
            tableName={tableName!}
            columns={table.columns}
          />
        </TabsContent>

        <TabsContent value="indexes" className="mt-4">
          <IndexesTab
            projectId={project!.id}
            tableName={tableName!}
            indexes={table.indexes}
            columns={table.columns}
          />
        </TabsContent>

        <TabsContent value="fk" className="mt-4">
          <ForeignKeysTab
            projectId={project!.id}
            tableName={tableName!}
            foreignKeys={table.foreign_keys}
            columns={table.columns}
          />
        </TabsContent>

        <TabsContent value="validation" className="mt-4">
          <ValidationTab
            projectId={project!.id}
            tableName={tableName!}
            columns={table.columns}
          />
        </TabsContent>

        <TabsContent value="sql" className="mt-4">
          <SQLPreviewTab columns={table.columns} tableName={tableName!} />
        </TabsContent>
      </Tabs>
    </PageWrapper>
  );
}

const COMPUTED_RETURN_TYPES = ['text', 'integer', 'float', 'boolean', 'timestamp'];

function ColumnsTab({ projectId, tableName, columns }: {
  projectId: string; tableName: string; columns: ColumnInfo[];
}) {
  const { t } = useTranslation(['tables', 'common']);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [computedDialogOpen, setComputedDialogOpen] = useState(false);
  const [newCol, setNewCol] = useState({ name: '', type: 'text', nullable: true, default_value: '', is_unique: false });
  const [computedCol, setComputedCol] = useState({ name: '', expression: '', return_type: 'text' });
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [editingCol, setEditingCol] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: '', type: '', nullable: false, default_value: '', is_unique: false });
  const queryClient = useQueryClient();

  function showAlterError(err: Error) {
    const apiErr = err as import('@/api/client').ApiError;
    const code = apiErr.errorCode;
    const col = apiErr.column;
    const target = apiErr.targetType;
    // Try column-specific error keys first (e.g. INCOMPATIBLE_TYPE, HAS_NULL_VALUES)
    if (code) {
      const key = `columns.errors.${code}`;
      const translated = t(key, { column: col, type: target, defaultValue: '' });
      if (translated) {
        toast.error(translated);
        return;
      }
    }
    // Fall back to global PG error mapping
    showErrorToast(err);
  }

  const alterMutation = useMutation({
    mutationFn: (changes: AlterColumnChange[]) =>
      schemaApi.alterColumns(projectId, tableName, changes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['table', projectId, tableName] });
      toast.success(t('columns.updated'));
      setAddDialogOpen(false);
      setNewCol({ name: '', type: 'text', nullable: true, default_value: '', is_unique: false });
    },
    onError: showAlterError,
  });

  const computedMutation = useMutation({
    mutationFn: () =>
      schemaApi.addComputedColumn(projectId, tableName, {
        name: computedCol.name,
        expression: computedCol.expression,
        return_type: computedCol.return_type,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['table', projectId, tableName] });
      toast.success(t('computed.added'));
      setComputedDialogOpen(false);
      setComputedCol({ name: '', expression: '', return_type: 'text' });
    },
    onError: (err: Error) => showErrorToast(err),
  });

  const autoFields = new Set(['id', 'created_at', 'updated_at']);

  function startEditing(col: ColumnInfo) {
    setEditingCol(col.name);
    setEditForm({
      name: col.name,
      type: col.type,
      nullable: col.nullable,
      default_value: col.default_value ?? '',
      is_unique: col.is_unique,
    });
  }

  function saveEdit(originalCol: ColumnInfo) {
    const changes: AlterColumnChange[] = [];
    if (editForm.name !== originalCol.name) {
      changes.push({ action: 'rename', name: originalCol.name, newName: editForm.name });
    }
    const nameForAlter = editForm.name !== originalCol.name ? editForm.name : originalCol.name;
    const typeChanged = editForm.type !== originalCol.type;
    const nullableChanged = editForm.nullable !== originalCol.nullable;
    const defaultChanged = (editForm.default_value || null) !== (originalCol.default_value || null);
    const uniqueChanged = editForm.is_unique !== originalCol.is_unique;
    if (typeChanged || nullableChanged || defaultChanged || uniqueChanged) {
      changes.push({
        action: 'alter',
        name: nameForAlter,
        type: typeChanged ? editForm.type : undefined,
        nullable: nullableChanged ? editForm.nullable : undefined,
        default_value: defaultChanged ? (editForm.default_value || null) : undefined,
        is_unique: uniqueChanged ? editForm.is_unique : undefined,
      });
    }
    if (changes.length > 0) {
      alterMutation.mutate(changes, { onSuccess: () => setEditingCol(null) });
    } else {
      setEditingCol(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">{t('columns.title')}</CardTitle>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setComputedDialogOpen(true)}>
            <Calculator className="h-3 w-3 mr-1" />
            {t('computed.addComputed')}
          </Button>
          <Button size="sm" onClick={() => setAddDialogOpen(true)}>
            <Plus className="h-3 w-3 mr-1" />
            {t('columns.addColumn')}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('columns.name')}</TableHead>
              <TableHead>{t('columns.type')}</TableHead>
              <TableHead>{t('columns.nullable')}</TableHead>
              <TableHead>{t('columns.default')}</TableHead>
              <TableHead>{t('columns.constraints')}</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {columns.map((col) => {
              const isEditing = editingCol === col.name;
              const isAuto = autoFields.has(col.name);
              const isLocked = isAuto || col.is_primary;

              if (isEditing) {
                return (
                  <TableRow key={col.name} className="bg-muted/30">
                    <TableCell>
                      <Input
                        value={editForm.name}
                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })}
                        className="h-8 text-xs font-mono w-36"
                        disabled={isLocked}
                      />
                    </TableCell>
                    <TableCell>
                      <Select value={editForm.type} onValueChange={(v) => setEditForm({ ...editForm, type: v })} disabled={isLocked}>
                        <SelectTrigger className="h-8 text-xs w-32"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {COLUMN_TYPES.map((ct) => <SelectItem key={ct} value={ct} className="text-xs">{ct}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      {!isLocked && (
                        <Checkbox
                          checked={editForm.nullable}
                          onCheckedChange={(v) => setEditForm({ ...editForm, nullable: !!v })}
                        />
                      )}
                      {isLocked && (col.nullable ? t('common:table.yes') : t('common:table.no'))}
                    </TableCell>
                    <TableCell>
                      <Input
                        value={editForm.default_value}
                        onChange={(e) => setEditForm({ ...editForm, default_value: e.target.value })}
                        placeholder="NULL"
                        className="h-8 text-xs font-mono w-32"
                        disabled={isLocked}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {col.is_primary && <Badge className="bg-blue-500/10 text-blue-500 border-blue-500/20">PK</Badge>}
                        {!col.is_primary && !isLocked && (
                          <label className="flex items-center gap-1 text-xs">
                            <Checkbox
                              checked={editForm.is_unique}
                              onCheckedChange={(v) => setEditForm({ ...editForm, is_unique: !!v })}
                            />
                            UQ
                          </label>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-green-500 hover:text-green-600"
                          onClick={() => saveEdit(col)}
                          disabled={alterMutation.isPending || !editForm.name.trim()}
                        >
                          <Check className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => setEditingCol(null)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              }

              return (
                <TableRow
                  key={col.name}
                  className="group cursor-pointer hover:bg-muted/30"
                  onClick={() => !isLocked && startEditing(col)}
                >
                  <TableCell className="font-mono font-medium">
                    {col.name}
                    {isAuto && (
                      <Badge variant="outline" className="ml-2 text-[10px]">auto</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{col.type}</Badge>
                  </TableCell>
                  <TableCell>{col.nullable ? t('common:table.yes') : t('common:table.no')}</TableCell>
                  <TableCell className="font-mono text-sm text-muted-foreground max-w-[200px] truncate">
                    {col.default_value ?? '—'}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {col.is_primary && <Badge className="bg-blue-500/10 text-blue-500 border-blue-500/20">PK</Badge>}
                      {col.is_unique && !col.is_primary && <Badge className="bg-purple-500/10 text-purple-500 border-purple-500/20">UQ</Badge>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {!isLocked && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 opacity-0 group-hover:opacity-100"
                          onClick={(e) => { e.stopPropagation(); startEditing(col); }}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                      )}
                      {!isAuto && !col.is_primary && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive opacity-0 group-hover:opacity-100"
                          onClick={(e) => { e.stopPropagation(); setDropTarget(col.name); }}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>

      {/* Add column dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('columns.addColumn')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t('columns.form.name')}</Label>
              <Input
                value={newCol.name}
                onChange={(e) => setNewCol({ ...newCol, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })}
                placeholder="column_name"
                className="font-mono mt-1"
              />
            </div>
            <div>
              <Label>{t('columns.form.type')}</Label>
              <Select value={newCol.type} onValueChange={(v) => setNewCol({ ...newCol, type: v })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {COLUMN_TYPES.map((ct) => <SelectItem key={ct} value={ct}>{ct}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox checked={newCol.nullable} onCheckedChange={(v) => setNewCol({ ...newCol, nullable: !!v })} />
              <Label>{t('columns.form.nullable')}</Label>
            </div>
            <div>
              <Label>{t('columns.form.defaultValue')}</Label>
              <Input
                value={newCol.default_value}
                onChange={(e) => setNewCol({ ...newCol, default_value: e.target.value })}
                placeholder={t('columns.form.defaultPlaceholder')}
                className="font-mono mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)}>{t('common:actions.cancel')}</Button>
            <Button
              onClick={() => alterMutation.mutate([{
                action: 'add',
                name: newCol.name,
                type: newCol.type,
                nullable: newCol.nullable,
                default_value: newCol.default_value || undefined,
              }])}
              disabled={!newCol.name || alterMutation.isPending}
            >
              {alterMutation.isPending ? t('columns.adding') : t('columns.addColumnBtn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add computed column dialog */}
      <Dialog open={computedDialogOpen} onOpenChange={setComputedDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('computed.addComputed')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t('computed.name')}</Label>
              <Input
                value={computedCol.name}
                onChange={(e) => setComputedCol({ ...computedCol, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })}
                placeholder="computed_column"
                className="font-mono mt-1"
              />
            </div>
            <div>
              <Label>{t('computed.expression')}</Label>
              <Textarea
                value={computedCol.expression}
                onChange={(e) => setComputedCol({ ...computedCol, expression: e.target.value })}
                placeholder={t('computed.expressionPlaceholder')}
                className="font-mono mt-1"
                rows={3}
              />
            </div>
            <div>
              <Label>{t('computed.returnType')}</Label>
              <Select value={computedCol.return_type} onValueChange={(v) => setComputedCol({ ...computedCol, return_type: v })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {COMPUTED_RETURN_TYPES.map((ct) => <SelectItem key={ct} value={ct}>{ct}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setComputedDialogOpen(false)}>{t('common:actions.cancel')}</Button>
            <Button
              onClick={() => computedMutation.mutate()}
              disabled={!computedCol.name || !computedCol.expression || computedMutation.isPending}
            >
              {computedMutation.isPending ? t('computed.adding') : t('computed.addBtn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!dropTarget}
        onOpenChange={(o) => !o && setDropTarget(null)}
        title={t('columns.dropColumn.title')}
        description={t('columns.dropColumn.desc', { name: dropTarget })}
        confirmText={t('columns.dropColumn.confirm')}
        variant="destructive"
        onConfirm={() => {
          if (dropTarget) {
            alterMutation.mutate([{ action: 'drop', name: dropTarget }]);
            setDropTarget(null);
          }
        }}
        loading={alterMutation.isPending}
      />
    </Card>
  );
}

const INDEX_TYPES = ['btree', 'hash', 'gin', 'gist'] as const;
type IndexType = typeof INDEX_TYPES[number];

function IndexesTab({ projectId, tableName, indexes, columns }: {
  projectId: string; tableName: string; indexes: IndexInfo[]; columns: ColumnInfo[];
}) {
  const { t } = useTranslation(['tables', 'common']);
  const [createOpen, setCreateOpen] = useState(false);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [newIdx, setNewIdx] = useState({ columns: [] as string[], type: 'btree' as IndexType, is_unique: false });
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: () => schemaApi.addIndex(projectId, tableName, newIdx),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['table', projectId, tableName] });
      toast.success(t('indexes.indexCreated'));
      setCreateOpen(false);
      setNewIdx({ columns: [], type: 'btree', is_unique: false });
    },
    onError: (err: Error) => showErrorToast(err),
  });

  const dropMutation = useMutation({
    mutationFn: (indexName: string) => schemaApi.dropIndex(projectId, tableName, indexName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['table', projectId, tableName] });
      toast.success(t('indexes.indexDropped'));
      setDropTarget(null);
    },
    onError: (err: Error) => showErrorToast(err),
  });

  function toggleColumn(colName: string) {
    setNewIdx((prev) => ({
      ...prev,
      columns: prev.columns.includes(colName)
        ? prev.columns.filter((c) => c !== colName)
        : [...prev.columns, colName],
    }));
  }

  const typeDescKey: Record<IndexType, string> = {
    btree: 'indexes.typeBtreeDesc',
    hash: 'indexes.typeHashDesc',
    gin: 'indexes.typeGinDesc',
    gist: 'indexes.typeGistDesc',
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">{t('indexes.title')}</CardTitle>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3 w-3 mr-1" />
          {t('indexes.createIndex')}
        </Button>
      </CardHeader>
      <CardContent>
        {indexes.length === 0 ? (
          <p className="text-muted-foreground text-sm py-4 text-center">{t('indexes.noIndexes')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('indexes.name')}</TableHead>
                <TableHead>{t('indexes.columns')}</TableHead>
                <TableHead>{t('indexes.type')}</TableHead>
                <TableHead>{t('indexes.unique')}</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {indexes.map((idx) => (
                <TableRow key={idx.name}>
                  <TableCell className="font-mono text-sm">{idx.name}</TableCell>
                  <TableCell>
                    <div className="flex gap-1 flex-wrap">
                      {(Array.isArray(idx.columns) ? idx.columns : String(idx.columns).split(',')).map((c) => (
                        <Badge key={c} variant="secondary">{c.trim()}</Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell><Badge variant="outline">{idx.type}</Badge></TableCell>
                  <TableCell>{idx.is_unique ? t('common:table.yes') : t('common:table.no')}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost" size="icon" className="h-8 w-8 text-destructive"
                      onClick={() => setDropTarget(idx.name)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {/* Drop confirm */}
      <ConfirmDialog
        open={dropTarget !== null}
        onOpenChange={(open) => { if (!open) setDropTarget(null); }}
        title={t('indexes.indexDropped')}
        description={t('indexes.dropConfirm', { name: dropTarget })}
        confirmText={t('common:actions.delete')}
        variant="destructive"
        onConfirm={() => { if (dropTarget) dropMutation.mutate(dropTarget); }}
        loading={dropMutation.isPending}
      />

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('indexes.createIndex')}</DialogTitle>
          </DialogHeader>

          <p className="text-sm text-muted-foreground">{t('indexes.description')}</p>

          <div className="space-y-5">
            {/* Columns */}
            <div>
              <Label className="text-sm font-medium">{t('indexes.columns')}</Label>
              <p className="text-xs text-muted-foreground mt-0.5 mb-2">{t('indexes.selectColumns')}</p>
              <div className="flex flex-wrap gap-2">
                {columns.map((col) => (
                  <Badge
                    key={col.name}
                    variant={newIdx.columns.includes(col.name) ? 'default' : 'outline'}
                    className="cursor-pointer select-none"
                    onClick={() => toggleColumn(col.name)}
                  >
                    {col.name}
                    <span className="ml-1 opacity-50 text-[10px]">{col.type}</span>
                  </Badge>
                ))}
              </div>
            </div>

            {/* Type selection as cards */}
            <div>
              <Label className="text-sm font-medium">{t('indexes.type')}</Label>
              <div className="grid grid-cols-2 gap-2 mt-2">
                {INDEX_TYPES.map((type) => (
                  <button
                    key={type}
                    type="button"
                    className={`text-left rounded-lg border p-3 transition-colors ${newIdx.type === type ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border hover:border-muted-foreground/30'}`}
                    onClick={() => setNewIdx({ ...newIdx, type, ...(type !== 'btree' ? { is_unique: false } : {}) })}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold">{t(`indexes.type${type.charAt(0).toUpperCase() + type.slice(1)}` as string)}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
                      {t(typeDescKey[type])}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            {/* Unique - only for btree/hash */}
            {(newIdx.type === 'btree' || newIdx.type === 'hash') && (
              <div className="flex items-start gap-2">
                <Checkbox
                  checked={newIdx.is_unique}
                  onCheckedChange={(v) => setNewIdx({ ...newIdx, is_unique: !!v })}
                  className="mt-0.5"
                />
                <div>
                  <Label className="text-sm">{t('indexes.unique')}</Label>
                  <p className="text-xs text-muted-foreground">{t('indexes.uniqueHint')}</p>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{t('common:actions.cancel')}</Button>
            <Button onClick={() => createMutation.mutate()} disabled={newIdx.columns.length === 0 || createMutation.isPending}>
              {createMutation.isPending ? t('indexes.creating') : t('indexes.createIndexBtn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

const FK_ACTIONS = [
  { value: 'CASCADE', key: 'cascade' },
  { value: 'SET NULL', key: 'setNull' },
  { value: 'RESTRICT', key: 'restrict' },
  { value: 'NO ACTION', key: 'noAction' },
  { value: 'SET DEFAULT', key: 'setDefault' },
] as const;

function ForeignKeysTab({ projectId, tableName, foreignKeys, columns }: {
  projectId: string; tableName: string; foreignKeys: ForeignKeyInfo[]; columns: ColumnInfo[];
}) {
  const { t } = useTranslation(['tables', 'common']);
  const [createOpen, setCreateOpen] = useState(false);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [newFk, setNewFk] = useState({
    source_column: '', target_table: '', target_column: '',
    on_delete: 'RESTRICT', on_update: 'CASCADE',
  });
  const queryClient = useQueryClient();

  const { data: tablesData } = useQuery({
    queryKey: ['tables', projectId],
    queryFn: () => schemaApi.listTables(projectId),
    enabled: !!projectId,
  });
  const allTables = tablesData?.tables ?? [];

  // Fetch target table columns when a target table is selected
  const { data: targetTableData } = useQuery({
    queryKey: ['table', projectId, newFk.target_table],
    queryFn: () => schemaApi.getTable(projectId, newFk.target_table),
    enabled: !!projectId && !!newFk.target_table,
  });
  const allTargetColumns = targetTableData?.table?.columns ?? [];
  // Only PK/UNIQUE columns can be FK targets
  const eligibleTargetColumns = allTargetColumns.filter(c => c.is_primary || c.is_unique);

  // Type compatibility map for FK columns
  const TYPE_COMPAT: Record<string, string[]> = {
    uuid: ['uuid'],
    integer: ['integer', 'bigint', 'smallint'],
    bigint: ['integer', 'bigint', 'smallint'],
    smallint: ['integer', 'bigint', 'smallint'],
    text: ['text', 'character varying', 'character'],
    'character varying': ['text', 'character varying', 'character'],
    character: ['text', 'character varying', 'character'],
  };

  const getCompatibleTypes = (type: string) => TYPE_COMPAT[type] ?? [type];

  // Filter target columns by source column type compatibility
  const selectedSourceCol = columns.find(c => c.name === newFk.source_column);
  const targetColumns = selectedSourceCol
    ? eligibleTargetColumns.filter(c => getCompatibleTypes(selectedSourceCol.type).includes(c.type))
    : eligibleTargetColumns;

  // Mark source columns that have at least one compatible target
  const compatibleSourceCols = new Set(
    eligibleTargetColumns.length > 0
      ? columns
          .filter(srcCol => eligibleTargetColumns.some(tgtCol => getCompatibleTypes(srcCol.type).includes(tgtCol.type)))
          .map(c => c.name)
      : columns.map(c => c.name)
  );

  const createMutation = useMutation({
    mutationFn: () => schemaApi.addForeignKey(projectId, tableName, newFk),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['table', projectId, tableName] });
      toast.success(t('fk.fkAdded'));
      setCreateOpen(false);
      setNewFk({ source_column: '', target_table: '', target_column: '', on_delete: 'RESTRICT', on_update: 'CASCADE' });
    },
    onError: (err: Error) => showErrorToast(err),
  });

  const dropMutation = useMutation({
    mutationFn: (constraintName: string) => schemaApi.dropForeignKey(projectId, tableName, constraintName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['table', projectId, tableName] });
      toast.success(t('fk.fkDropped'));
      setDropTarget(null);
    },
    onError: (err: Error) => showErrorToast(err),
  });

  // Visual connection line for existing FKs
  const actionColor = (action: string) => {
    switch (action) {
      case 'CASCADE': return 'text-red-400 bg-red-500/10 border-red-500/30';
      case 'SET NULL': return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30';
      case 'RESTRICT': return 'text-blue-400 bg-blue-500/10 border-blue-500/30';
      case 'NO ACTION': return 'text-zinc-400 bg-zinc-500/10 border-zinc-500/30';
      case 'SET DEFAULT': return 'text-purple-400 bg-purple-500/10 border-purple-500/30';
      default: return 'text-zinc-400 bg-zinc-500/10 border-zinc-500/30';
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">{t('fk.title')}</CardTitle>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3 w-3 mr-1" />
          {t('fk.addForeignKey')}
        </Button>
      </CardHeader>
      <CardContent>
        {foreignKeys.length === 0 ? (
          <div className="text-center py-8">
            <div className="text-muted-foreground text-sm">{t('fk.noForeignKeys')}</div>
            <p className="text-xs text-muted-foreground/60 mt-1">{t('fk.description')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {foreignKeys.map((fk) => (
              <div key={fk.constraint_name} className="rounded-lg border border-border p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-mono text-xs text-muted-foreground">{fk.constraint_name}</span>
                  <Button
                    variant="ghost" size="icon" className="h-7 w-7 text-destructive"
                    onClick={() => setDropTarget(fk.constraint_name)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {/* Visual connection */}
                <div className="flex items-center gap-2 text-sm">
                  <div className="flex items-center gap-1.5">
                    <Badge variant="secondary" className="font-mono">{tableName}</Badge>
                    <span className="text-muted-foreground">.</span>
                    <Badge className="font-mono">{fk.source_column}</Badge>
                  </div>
                  <div className="flex-1 flex items-center gap-1 text-muted-foreground">
                    <div className="flex-1 border-t border-dashed border-muted-foreground/30" />
                    <span className="text-xs px-1">&#8594;</span>
                    <div className="flex-1 border-t border-dashed border-muted-foreground/30" />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Badge variant="secondary" className="font-mono">{fk.target_table}</Badge>
                    <span className="text-muted-foreground">.</span>
                    <Badge className="font-mono">{fk.target_column}</Badge>
                  </div>
                </div>
                {/* Actions */}
                <div className="flex gap-3 mt-3">
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="text-muted-foreground">{t('fk.onDelete')}:</span>
                    <Badge variant="outline" className={actionColor(fk.on_delete)}>{fk.on_delete}</Badge>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="text-muted-foreground">{t('fk.onUpdate')}:</span>
                    <Badge variant="outline" className={actionColor(fk.on_update)}>{fk.on_update}</Badge>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {/* Drop confirm */}
      <ConfirmDialog
        open={dropTarget !== null}
        onOpenChange={(open) => { if (!open) setDropTarget(null); }}
        title={t('fk.dropConfirmTitle')}
        description={t('fk.dropConfirm', { name: dropTarget })}
        confirmText={t('common:actions.delete')}
        variant="destructive"
        onConfirm={() => { if (dropTarget) dropMutation.mutate(dropTarget); }}
        loading={dropMutation.isPending}
      />

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('fk.addForeignKey')}</DialogTitle>
          </DialogHeader>

          <p className="text-sm text-muted-foreground">{t('fk.description')}</p>

          <div className="space-y-5">
            {/* Step 1: Source column */}
            <div>
              <Label className="text-sm font-medium">{t('fk.form.sourceColumn')}</Label>
              <p className="text-xs text-muted-foreground mt-0.5 mb-2">{t('fk.form.sourceColumnHint')}</p>
              <div className="flex flex-wrap gap-2">
                {columns.map((col) => {
                  const isCompat = !newFk.target_table || compatibleSourceCols.has(col.name);
                  return (
                  <Badge
                    key={col.name}
                    variant={newFk.source_column === col.name ? 'default' : 'outline'}
                    className={`cursor-pointer select-none ${!isCompat ? 'opacity-30 cursor-not-allowed' : ''}`}
                    onClick={() => { if (isCompat) setNewFk({ ...newFk, source_column: col.name, target_column: '' }); }}
                  >
                    {col.name}
                    <span className="ml-1 opacity-50 text-[10px]">{col.type}</span>
                  </Badge>
                  );
                })}
              </div>
            </div>

            {/* Step 2: Target table + column */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-sm font-medium">{t('fk.form.targetTable')}</Label>
                <p className="text-xs text-muted-foreground mt-0.5 mb-2">{t('fk.form.targetTableHint')}</p>
                <Select
                  value={newFk.target_table}
                  onValueChange={(v) => setNewFk({ ...newFk, target_table: v, target_column: '' })}
                >
                  <SelectTrigger className="font-mono">
                    <SelectValue placeholder={t('fk.form.selectTable')} />
                  </SelectTrigger>
                  <SelectContent>
                    {allTables.map((tbl) => (
                      <SelectItem key={tbl.name} value={tbl.name} className="font-mono">
                        {tbl.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm font-medium">{t('fk.form.targetColumn')}</Label>
                <p className="text-xs text-muted-foreground mt-0.5 mb-2">{t('fk.form.targetColumnHint')}</p>
                <Select
                  value={newFk.target_column}
                  onValueChange={(v) => setNewFk({ ...newFk, target_column: v })}
                  disabled={!newFk.target_table}
                >
                  <SelectTrigger className="font-mono">
                    <SelectValue placeholder={newFk.target_table ? t('fk.form.selectColumn') : t('fk.form.selectTableFirst')} />
                  </SelectTrigger>
                  <SelectContent>
                    {targetColumns.length === 0 && newFk.target_table ? (
                      <div className="px-2 py-1.5 text-xs text-muted-foreground">{t('fk.form.noEligibleColumns')}</div>
                    ) : (
                      targetColumns.map((col) => (
                        <SelectItem key={col.name} value={col.name} className="font-mono">
                          {col.name} ({col.type}) {col.is_primary ? 'PK' : 'UQ'}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Visual preview */}
            {newFk.source_column && newFk.target_table && (
              <div className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/30 p-3">
                <div className="flex items-center gap-2 text-sm justify-center">
                  <Badge variant="secondary" className="font-mono">{tableName}</Badge>
                  <span className="text-muted-foreground">.</span>
                  <Badge className="font-mono">{newFk.source_column}</Badge>
                  <span className="text-muted-foreground mx-1">&#8594;</span>
                  <Badge variant="secondary" className="font-mono">{newFk.target_table}</Badge>
                  <span className="text-muted-foreground">.</span>
                  <Badge className="font-mono">{newFk.target_column || '?'}</Badge>
                </div>
              </div>
            )}

            {/* Step 3: Action cards */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium">{t('fk.form.onDelete')}</Label>
                <p className="text-xs text-muted-foreground mt-0.5 mb-2">{t('fk.form.onDeleteHint')}</p>
                <div className="space-y-1.5">
                  {FK_ACTIONS.map((a) => (
                    <button
                      key={a.value}
                      type="button"
                      className={`w-full text-left rounded-md border p-2 transition-colors ${newFk.on_delete === a.value ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border hover:border-muted-foreground/30'}`}
                      onClick={() => setNewFk({ ...newFk, on_delete: a.value })}
                    >
                      <div className="font-mono text-xs font-semibold">{a.value}</div>
                      <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug">{t(`fk.actions.${a.key}` as string)}</p>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Label className="text-sm font-medium">{t('fk.form.onUpdate')}</Label>
                <p className="text-xs text-muted-foreground mt-0.5 mb-2">{t('fk.form.onUpdateHint')}</p>
                <div className="space-y-1.5">
                  {FK_ACTIONS.map((a) => (
                    <button
                      key={a.value}
                      type="button"
                      className={`w-full text-left rounded-md border p-2 transition-colors ${newFk.on_update === a.value ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border hover:border-muted-foreground/30'}`}
                      onClick={() => setNewFk({ ...newFk, on_update: a.value })}
                    >
                      <div className="font-mono text-xs font-semibold">{a.value}</div>
                      <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug">{t(`fk.actions.${a.key}` as string)}</p>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{t('common:actions.cancel')}</Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!newFk.source_column || !newFk.target_table || !newFk.target_column || createMutation.isPending}
            >
              {createMutation.isPending ? t('fk.adding') : t('fk.addBtn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

const RULE_TYPES = [
  { value: 'unique_combo', key: 'uniqueCombo', scope: 'table' },
  { value: 'regex', key: 'regex', scope: 'column' },
  { value: 'range', key: 'range', scope: 'column' },
  { value: 'enum', key: 'enum', scope: 'column' },
  { value: 'custom_expression', key: 'customExpression', scope: 'table' },
  { value: 'state_machine', key: 'stateMachine', scope: 'column' },
] as const;

function ValidationTab({ projectId, tableName, columns }: {
  projectId: string; tableName: string; columns: ColumnInfo[];
}) {
  const { t } = useTranslation(['tables', 'common']);
  const [createOpen, setCreateOpen] = useState(false);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [newRule, setNewRule] = useState({
    rule_type: '' as string,
    column_name: '',
    config: {} as Record<string, unknown>,
    error_message: '',
  });
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['validation-rules', projectId, tableName],
    queryFn: () => dataApi.listValidationRules(projectId, tableName),
  });

  const createMutation = useMutation({
    mutationFn: () => dataApi.createValidationRule(projectId, tableName, {
      column_name: newRule.column_name || null,
      rule_type: newRule.rule_type,
      config: newRule.config,
      error_message: newRule.error_message,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['validation-rules', projectId, tableName] });
      toast.success(t('validation.ruleAdded'));
      setCreateOpen(false);
      setNewRule({ rule_type: '', column_name: '', config: {}, error_message: '' });
    },
    onError: (err: Error) => showErrorToast(err),
  });

  const deleteMutation = useMutation({
    mutationFn: (ruleId: string) => dataApi.deleteValidationRule(projectId, tableName, ruleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['validation-rules', projectId, tableName] });
      toast.success(t('validation.ruleDeleted'));
      setDropTarget(null);
    },
    onError: (err: Error) => showErrorToast(err),
  });

  const rules = data?.rules ?? [];
  const selectedType = RULE_TYPES.find(rt => rt.value === newRule.rule_type);
  const needsColumn = selectedType?.scope === 'column';

  const ruleTypeColor = (ruleType: string) => {
    switch (ruleType) {
      case 'regex': return 'text-purple-400 bg-purple-500/10 border-purple-500/30';
      case 'range': return 'text-blue-400 bg-blue-500/10 border-blue-500/30';
      case 'enum': return 'text-green-400 bg-green-500/10 border-green-500/30';
      case 'unique_combo': return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30';
      case 'custom_expression': return 'text-orange-400 bg-orange-500/10 border-orange-500/30';
      case 'state_machine': return 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30';
      default: return 'text-zinc-400 bg-zinc-500/10 border-zinc-500/30';
    }
  };

  function renderConfigFields() {
    switch (newRule.rule_type) {
      case 'unique_combo':
        return (
          <div>
            <Label className="text-sm font-medium">{t('validation.configFields.columns')}</Label>
            <p className="text-xs text-muted-foreground mt-0.5 mb-2">{t('validation.configHints.uniqueCombo')}</p>
            <div className="flex flex-wrap gap-2">
              {columns.map((col) => {
                const selected = ((newRule.config.columns as string[]) ?? []).includes(col.name);
                return (
                  <Badge
                    key={col.name}
                    variant={selected ? 'default' : 'outline'}
                    className="cursor-pointer select-none"
                    onClick={() => {
                      const current = (newRule.config.columns as string[]) ?? [];
                      const next = selected ? current.filter(c => c !== col.name) : [...current, col.name];
                      setNewRule({ ...newRule, config: { ...newRule.config, columns: next } });
                    }}
                  >
                    {col.name}
                    <span className="ml-1 opacity-50 text-[10px]">{col.type}</span>
                  </Badge>
                );
              })}
            </div>
          </div>
        );
      case 'regex':
        return (
          <div>
            <Label className="text-sm font-medium">{t('validation.configFields.pattern')}</Label>
            <p className="text-xs text-muted-foreground mt-0.5 mb-2">{t('validation.configHints.regex')}</p>
            <Input
              value={(newRule.config.pattern as string) ?? ''}
              onChange={(e) => setNewRule({ ...newRule, config: { ...newRule.config, pattern: e.target.value } })}
              placeholder="^[a-zA-Z0-9_]+$"
              className="font-mono"
            />
          </div>
        );
      case 'range':
        return (
          <div>
            <p className="text-xs text-muted-foreground mb-2">{t('validation.configHints.range')}</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-sm font-medium">{t('validation.configFields.min')}</Label>
                <Input
                  type="number"
                  value={(newRule.config.min as string) ?? ''}
                  onChange={(e) => setNewRule({ ...newRule, config: { ...newRule.config, min: Number(e.target.value) } })}
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-sm font-medium">{t('validation.configFields.max')}</Label>
                <Input
                  type="number"
                  value={(newRule.config.max as string) ?? ''}
                  onChange={(e) => setNewRule({ ...newRule, config: { ...newRule.config, max: Number(e.target.value) } })}
                  className="mt-1"
                />
              </div>
            </div>
          </div>
        );
      case 'enum':
        return (
          <div>
            <Label className="text-sm font-medium">{t('validation.configFields.values')}</Label>
            <p className="text-xs text-muted-foreground mt-0.5 mb-2">{t('validation.configHints.enum')}</p>
            <Input
              value={(newRule.config.values as string[] ?? []).join(', ')}
              onChange={(e) => setNewRule({
                ...newRule,
                config: { ...newRule.config, values: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) },
              })}
              placeholder="active, inactive, pending"
              className="font-mono"
            />
          </div>
        );
      case 'custom_expression':
        return (
          <div>
            <Label className="text-sm font-medium">{t('validation.configFields.expression')}</Label>
            <p className="text-xs text-muted-foreground mt-0.5 mb-2">{t('validation.configHints.customExpression')}</p>
            <Textarea
              value={(newRule.config.expression as string) ?? ''}
              onChange={(e) => setNewRule({ ...newRule, config: { ...newRule.config, expression: e.target.value } })}
              placeholder="price > 0 AND quantity >= 0"
              className="font-mono"
              rows={3}
            />
          </div>
        );
      case 'state_machine':
        return (
          <div>
            <Label className="text-sm font-medium">{t('validation.configFields.transitions')}</Label>
            <p className="text-xs text-muted-foreground mt-0.5 mb-2">{t('validation.configHints.stateMachine')}</p>
            <Textarea
              value={typeof newRule.config.transitions === 'object' ? JSON.stringify(newRule.config.transitions, null, 2) : ''}
              onChange={(e) => {
                try {
                  setNewRule({ ...newRule, config: { ...newRule.config, transitions: JSON.parse(e.target.value) } });
                } catch { /* ignore parse errors while typing */ }
              }}
              placeholder={'{\n  "draft": ["review"],\n  "review": ["published", "draft"],\n  "published": ["archived"]\n}'}
              className="font-mono"
              rows={5}
            />
          </div>
        );
      default:
        return null;
    }
  }

  function ruleDescription(rule: ValidationRule) {
    const cfg = rule.config as Record<string, unknown>;
    switch (rule.rule_type) {
      case 'regex': return `/${(cfg.pattern as string) ?? '...'}/`;
      case 'range': {
        const c = cfg;
        return `${c?.min ?? '-\u221e'} \u2264 x \u2264 ${c?.max ?? '+\u221e'}`;
      }
      case 'enum': return ((cfg.values as string[]) ?? []).join(', ');
      case 'unique_combo': return ((cfg.columns as string[]) ?? []).join(' + ');
      case 'custom_expression': return (cfg.expression as string) ?? '';
      case 'state_machine': {
        const t = cfg.transitions as Record<string, unknown> | undefined;
        return t ? Object.keys(t).join(' \u2192 ') : '';
      }
      default: return '';
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">{t('validation.title')}</CardTitle>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3 w-3 mr-1" />
          {t('validation.addRule')}
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : rules.length === 0 ? (
          <div className="text-center py-8">
            <div className="text-muted-foreground text-sm">{t('validation.noRules')}</div>
            <p className="text-xs text-muted-foreground/60 mt-1">{t('validation.description')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {rules.map((rule) => (
              <div key={rule.id} className="rounded-lg border border-border p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={ruleTypeColor(rule.rule_type)}>
                      {t(`validation.types.${rule.rule_type}` as string)}
                    </Badge>
                    {rule.column_name && (
                      <Badge variant="secondary" className="font-mono">{rule.column_name}</Badge>
                    )}
                    <Badge variant={rule.is_active ? 'default' : 'outline'} className="text-[10px]">
                      {rule.is_active ? t('validation.active') : t('validation.inactive')}
                    </Badge>
                  </div>
                  <Button
                    variant="ghost" size="icon" className="h-7 w-7 text-destructive"
                    onClick={() => setDropTarget(rule.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {/* Config preview */}
                <div className="text-xs font-mono text-muted-foreground bg-muted/30 rounded px-2 py-1.5 mb-2 truncate">
                  {ruleDescription(rule)}
                </div>
                {rule.error_message && (
                  <p className="text-xs text-muted-foreground">{rule.error_message}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {/* Drop confirm */}
      <ConfirmDialog
        open={dropTarget !== null}
        onOpenChange={(open) => { if (!open) setDropTarget(null); }}
        title={t('validation.dropConfirmTitle')}
        description={t('validation.dropConfirm')}
        confirmText={t('common:actions.delete')}
        variant="destructive"
        onConfirm={() => { if (dropTarget) deleteMutation.mutate(dropTarget); }}
        loading={deleteMutation.isPending}
      />

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('validation.addRule')}</DialogTitle>
          </DialogHeader>

          <p className="text-sm text-muted-foreground">{t('validation.description')}</p>

          <div className="space-y-5">
            {/* Step 1: Rule type as cards */}
            <div>
              <Label className="text-sm font-medium">{t('validation.ruleType')}</Label>
              <div className="grid grid-cols-2 gap-2 mt-2">
                {RULE_TYPES.map((rt) => (
                  <button
                    key={rt.value}
                    type="button"
                    className={`text-left rounded-lg border p-3 transition-colors ${newRule.rule_type === rt.value ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border hover:border-muted-foreground/30'}`}
                    onClick={() => setNewRule({ rule_type: rt.value, column_name: '', config: {}, error_message: '' })}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{t(`validation.types.${rt.value}` as string)}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
                      {t(`validation.typeDesc.${rt.key}` as string)}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            {/* Step 2: Column selection (for column-scoped rules) */}
            {needsColumn && (
              <div>
                <Label className="text-sm font-medium">{t('validation.configFields.columnName')}</Label>
                <p className="text-xs text-muted-foreground mt-0.5 mb-2">{t('validation.columnHint')}</p>
                <div className="flex flex-wrap gap-2">
                  {columns.map((col) => (
                    <Badge
                      key={col.name}
                      variant={newRule.column_name === col.name ? 'default' : 'outline'}
                      className="cursor-pointer select-none"
                      onClick={() => setNewRule({ ...newRule, column_name: col.name })}
                    >
                      {col.name}
                      <span className="ml-1 opacity-50 text-[10px]">{col.type}</span>
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Step 3: Config fields */}
            {newRule.rule_type && renderConfigFields()}

            {/* Step 4: Error message */}
            {newRule.rule_type && (
              <div>
                <Label className="text-sm font-medium">{t('validation.errorMessage')}</Label>
                <p className="text-xs text-muted-foreground mt-0.5 mb-2">{t('validation.errorMessageHint')}</p>
                <Input
                  value={newRule.error_message}
                  onChange={(e) => setNewRule({ ...newRule, error_message: e.target.value })}
                  placeholder={t('validation.errorMessagePlaceholder')}
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{t('common:actions.cancel')}</Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!newRule.rule_type || !newRule.error_message || (needsColumn && !newRule.column_name) || createMutation.isPending}
            >
              {createMutation.isPending ? t('validation.adding') : t('validation.addBtn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function SQLPreviewTab({ columns, tableName }: { columns: ColumnInfo[]; tableName: string }) {
  const lines = columns.map((col) => {
    let line = `  "${col.name}" ${col.type.toUpperCase()}`;
    if (col.is_primary) line += ' PRIMARY KEY';
    if (!col.nullable && !col.is_primary) line += ' NOT NULL';
    if (col.is_unique && !col.is_primary) line += ' UNIQUE';
    if (col.default_value) line += ` DEFAULT ${col.default_value}`;
    return line;
  });

  const sql = `-- Current table structure\nCREATE TABLE "${tableName}" (\n${lines.join(',\n')}\n);`;

  return (
    <Card>
      <CardContent>
        <pre className="bg-muted/50 rounded-lg p-4 overflow-x-auto text-sm font-mono text-foreground">
          {sql}
        </pre>
      </CardContent>
    </Card>
  );
}
