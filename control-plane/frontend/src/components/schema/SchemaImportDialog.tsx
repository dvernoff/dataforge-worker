import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Copy, Download, Upload, CheckCircle, XCircle, Loader2, ArrowLeft, Table2, Key, Hash, AlertTriangle, Plus, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { schemaApi } from '@/api/schema.api';
import { createCrudEndpoints } from '@/lib/schema-utils';
import {
  parseYamlSchema, yamlSchemaToApiPayloads, tableInfoToYaml, getYamlTemplate,
  topologicalSort, detectTableConflicts,
  type YamlSchema, type ApiPayloads, type ReImportPayloads, type TableConflict,
} from '@/lib/yaml-schema';
import { toast } from 'sonner';

type Stage = 'edit' | 'preview' | 'executing' | 'done';

interface ExecutionResult {
  tablesCreated: string[];
  tablesFailed: { name: string; error: string }[];
  tablesUpdated: string[];
  fksCreated: number;
  fksFailed: { table: string; column: string; error: string }[];
  fksRemoved: number;
  indexesCreated: number;
  indexesFailed: { table: string; columns: string; error: string }[];
  indexesRemoved: number;
  endpointsCreated: string[];
  columnsAdded: number;
  columnsAltered: number;
  columnsRenamed: number;
  columnsDropped: number;
  columnsFailed: { table: string; column: string; error: string }[];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  initialYaml?: string;
}

export function SchemaImportDialog({ open, onOpenChange, projectId, initialYaml }: Props) {
  const { t } = useTranslation(['tables', 'common']);
  const queryClient = useQueryClient();
  const [stage, setStage] = useState<Stage>('edit');
  const [yaml, setYaml] = useState(initialYaml ?? '');
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [parsedSchema, setParsedSchema] = useState<YamlSchema | null>(null);
  const [payloads, setPayloads] = useState<ReImportPayloads | null>(null);
  const [executionStatus, setExecutionStatus] = useState('');
  const [result, setResult] = useState<ExecutionResult | null>(null);

  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    if (open && initialYaml) {
      setYaml(initialYaml);
      setStage('edit');
    }
  }, [open, initialYaml]);

  function handleCopyTemplate() {
    navigator.clipboard.writeText(getYamlTemplate());
    toast.success(t('tables:yamlImport.templateCopied'));
  }

  async function handleExport() {
    setIsExporting(true);
    try {
      const { tables: list } = await schemaApi.listTables(projectId);
      if (list.length === 0) {
        toast.info(t('tables:yamlImport.noTablesToExport'));
        return;
      }
      const details = await Promise.all(
        list.map((tbl) => schemaApi.getTable(projectId, tbl.name).then((r) => r.table))
      );
      const yamlStr = tableInfoToYaml(details);
      setYaml(yamlStr);
      try {
        await navigator.clipboard.writeText(yamlStr);
        toast.success(t('tables:yamlImport.exported', { count: details.length }));
      } catch {
        // Clipboard blocked after async — still loaded into textarea
        toast.success(t('tables:yamlImport.exported', { count: details.length }));
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setIsExporting(false);
    }
  }

  async function handleValidate() {
    const result = parseYamlSchema(yaml);
    setErrors(result.errors);
    setWarnings(result.warnings);

    if (result.success && result.schema) {
      const sortResult = topologicalSort(result.schema);
      if (!Array.isArray(sortResult)) {
        setErrors([`Circular foreign key dependency between: ${sortResult.cycle.join(', ')}`]);
        return;
      }
      setParsedSchema(result.schema);

      try {
        const { tables: existingList } = await schemaApi.listTables(projectId);
        const existingDetails = await Promise.all(
          existingList.map(tbl => schemaApi.getTable(projectId, tbl.name).then(r => r.table))
        );
        const reimportPayloads = detectTableConflicts(result.schema, existingDetails);

        setPayloads(reimportPayloads);
      } catch {
        setPayloads({ ...yamlSchemaToApiPayloads(result.schema), tablesToCreate: yamlSchemaToApiPayloads(result.schema).tables, tableConflicts: [] });
      }

      setStage('preview');
    }
  }

  function toggleConflictAction(idx: number) {
    if (!payloads) return;
    setPayloads({
      ...payloads,
      tableConflicts: payloads.tableConflicts.map((c, i) =>
        i === idx ? { ...c, action: c.action === 'skip' ? 'update' : 'skip' } : c
      ),
    });
  }

  async function handleImport() {
    if (!payloads) return;
    setStage('executing');

    const res: ExecutionResult = {
      tablesCreated: [],
      tablesFailed: [],
      tablesUpdated: [],
      fksCreated: 0,
      fksFailed: [],
      fksRemoved: 0,
      indexesCreated: 0,
      indexesFailed: [],
      indexesRemoved: 0,
      endpointsCreated: [],
      columnsAdded: 0,
      columnsAltered: 0,
      columnsRenamed: 0,
      columnsDropped: 0,
      columnsFailed: [],
    };

    const createdTableNames = new Set<string>();

    for (const conflict of payloads.tableConflicts) {
      if (conflict.action === 'skip') continue;
      setExecutionStatus(t('tables:yamlImport.addingColumns', { name: conflict.tableName }));
      let updated = false;

      for (const col of conflict.renamedColumns) {
        try {
          await schemaApi.alterColumns(projectId, conflict.tableName, [{ action: 'rename', name: col.oldName, newName: col.newName }]);
          res.columnsRenamed++; updated = true;
        } catch (e) { res.columnsFailed.push({ table: conflict.tableName, column: `${col.oldName}→${col.newName}`, error: (e as Error).message }); }
      }
      for (const col of conflict.newColumns) {
        try {
          await schemaApi.alterColumns(projectId, conflict.tableName, [{ action: 'add', name: col.name, type: col.type, nullable: col.nullable, default_value: col.default_value, is_unique: col.is_unique }]);
          res.columnsAdded++; updated = true;
        } catch (e) { res.columnsFailed.push({ table: conflict.tableName, column: col.name, error: (e as Error).message }); }
      }
      for (const col of conflict.alteredColumns) {
        try {
          await schemaApi.alterColumns(projectId, conflict.tableName, [{ action: 'alter', name: col.name, type: col.type, nullable: col.nullable }]);
          res.columnsAltered++; updated = true;
        } catch (e) { res.columnsFailed.push({ table: conflict.tableName, column: col.name, error: (e as Error).message }); }
      }
      for (const col of conflict.removedColumns) {
        try {
          await schemaApi.alterColumns(projectId, conflict.tableName, [{ action: 'drop', name: col }]);
          res.columnsDropped++; updated = true;
        } catch (e) { res.columnsFailed.push({ table: conflict.tableName, column: col, error: (e as Error).message }); }
      }
      for (const idx of conflict.newIndexes) {
        try {
          await schemaApi.addIndex(projectId, conflict.tableName, { columns: idx.columns, type: idx.type, is_unique: idx.is_unique });
          res.indexesCreated++; updated = true;
        } catch (e) { res.indexesFailed.push({ table: conflict.tableName, columns: idx.columns.join(', '), error: (e as Error).message }); }
      }
      for (const idx of conflict.removedIndexes) {
        try {
          await schemaApi.dropIndex(projectId, conflict.tableName, idx.name);
          res.indexesRemoved++; updated = true;
        } catch (e) { res.indexesFailed.push({ table: conflict.tableName, columns: idx.columns.join(', '), error: (e as Error).message }); }
      }
      for (const fk of conflict.newForeignKeys) {
        try {
          await schemaApi.addForeignKey(projectId, conflict.tableName, { source_column: fk.source_column, target_table: fk.target_table, target_column: fk.target_column, on_delete: fk.on_delete, on_update: fk.on_update });
          res.fksCreated++; updated = true;
        } catch (e) { res.fksFailed.push({ table: conflict.tableName, column: fk.source_column, error: (e as Error).message }); }
      }
      for (const fk of conflict.removedForeignKeys) {
        try {
          await schemaApi.dropForeignKey(projectId, conflict.tableName, fk.constraint_name);
          res.fksRemoved++; updated = true;
        } catch (e) { res.fksFailed.push({ table: conflict.tableName, column: fk.source_column, error: (e as Error).message }); }
      }

      if (updated) res.tablesUpdated.push(conflict.tableName);
    }

    // Phase 1: Create new tables only
    for (const table of payloads.tablesToCreate) {
      setExecutionStatus(t('tables:yamlImport.creatingTable', { name: table._name }));
      try {
        await schemaApi.createTable(projectId, {
          name: table.name, columns: table.columns,
          add_timestamps: table.add_timestamps, add_uuid_pk: table.add_uuid_pk,
        });
        res.tablesCreated.push(table._name);
        createdTableNames.add(table._name);
      } catch (e) {
        res.tablesFailed.push({ name: table._name, error: (e as Error).message });
      }
    }

    // Phase 2: Create endpoints for new tables
    for (const tableName of payloads.endpointTables) {
      if (createdTableNames.has(tableName)) {
        setExecutionStatus(t('tables:yamlImport.creatingEndpoints', { name: tableName }));
        try {
          await createCrudEndpoints(projectId, tableName);
          res.endpointsCreated.push(tableName);
        } catch { /* best effort */ }
      }
    }

    // Phase 3: Add foreign keys for new tables
    if (payloads.foreignKeys.length > 0) {
      setExecutionStatus(t('tables:yamlImport.addingForeignKeys'));
      for (const fk of payloads.foreignKeys) {
        if (!createdTableNames.has(fk.tableName)) continue;
        try {
          await schemaApi.addForeignKey(projectId, fk.tableName, {
            source_column: fk.source_column, target_table: fk.target_table,
            target_column: fk.target_column, on_delete: fk.on_delete, on_update: fk.on_update,
          });
          res.fksCreated++;
        } catch (e) {
          res.fksFailed.push({ table: fk.tableName, column: fk.source_column, error: (e as Error).message });
        }
      }
    }

    // Phase 4: Add indexes for new tables
    if (payloads.indexes.length > 0) {
      setExecutionStatus(t('tables:yamlImport.addingIndexes'));
      for (const idx of payloads.indexes) {
        if (!createdTableNames.has(idx.tableName)) continue;
        try {
          await schemaApi.addIndex(projectId, idx.tableName, { columns: idx.columns, type: idx.type, is_unique: idx.is_unique });
          res.indexesCreated++;
        } catch (e) {
          res.indexesFailed.push({ table: idx.tableName, columns: idx.columns.join(', '), error: (e as Error).message });
        }
      }
    }

    queryClient.invalidateQueries({ queryKey: ['tables', projectId] });
    queryClient.invalidateQueries({ queryKey: ['endpoints', projectId] });
    setResult(res);
    setStage('done');
  }

  function handleClose() {
    if (result) {
      queryClient.invalidateQueries({ queryKey: ['tables'] });
      queryClient.invalidateQueries({ queryKey: ['endpoints'] });
      queryClient.invalidateQueries({ queryKey: ['table'] });
    }
    onOpenChange(false);
    setTimeout(() => {
      setStage('edit');
      setYaml('');
      setErrors([]);
      setWarnings([]);
      setParsedSchema(null);
      setPayloads(null);
      setResult(null);
      setExecutionStatus('');
    }, 200);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{t('tables:yamlImport.title')}</DialogTitle>
        </DialogHeader>

        {/* ── EDIT STAGE ── */}
        {stage === 'edit' && (
          <div className="flex flex-col min-h-0 flex-1 gap-3">
            <div className="flex flex-wrap gap-2 shrink-0">
              <Button variant="outline" size="sm" onClick={handleCopyTemplate}>
                <Copy className="h-3.5 w-3.5 mr-1.5" />
                {t('tables:yamlImport.copyTemplate')}
              </Button>
              <Button variant="outline" size="sm" onClick={handleExport} disabled={isExporting}>
                {isExporting ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1.5" />}
                {t('tables:yamlImport.exportExisting')}
              </Button>
            </div>

            <div className="flex-1 min-h-0 overflow-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden space-y-3 pb-1">
              <Textarea
                value={yaml}
                onChange={(e) => { setYaml(e.target.value); setErrors([]); }}
                placeholder={getYamlTemplate()}
                className="font-mono text-xs min-h-[350px] resize-y leading-relaxed"
                spellCheck={false}
              />

              {errors.length > 0 && (
                <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3 space-y-1">
                  {errors.map((err, i) => (
                    <p key={i} className="text-xs text-destructive flex items-start gap-1.5">
                      <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      {err}
                    </p>
                  ))}
                </div>
              )}

              {warnings.length > 0 && (
                <div className="rounded-md border border-amber-500/50 bg-amber-500/5 p-3 space-y-1">
                  {warnings.map((w, i) => (
                    <p key={i} className="text-xs text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      {w}
                    </p>
                  ))}
                </div>
              )}
            </div>

            <DialogFooter className="shrink-0">
              <Button variant="outline" onClick={handleClose}>{t('common:actions.cancel')}</Button>
              <Button onClick={handleValidate} disabled={!yaml.trim()}>
                {t('tables:yamlImport.validatePreview')}
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* ── PREVIEW STAGE ── */}
        {stage === 'preview' && payloads && parsedSchema && (
          <div className="flex flex-col min-h-0 flex-1 gap-4">
            <p className="text-sm text-muted-foreground shrink-0">
              {t('tables:yamlImport.previewDesc', {
                tables: payloads.tablesToCreate.length,
                fks: payloads.foreignKeys.length,
                indexes: payloads.indexes.length,
              })}
              {payloads.tableConflicts.length > 0 && (
                <span className="ml-2 text-amber-500">
                  {t('tables:yamlImport.existingTables', { count: payloads.tableConflicts.length })}
                </span>
              )}
            </p>

            <div className="flex-1 min-h-0 max-h-[calc(85vh-280px)] overflow-auto">
              <div className="space-y-3 pr-3">
                {payloads.tablesToCreate.map((table, i) => {
                  const def = parsedSchema.tables[table._name];
                  const colCount = Object.keys(def.columns).length;
                  const fkCount = (def.foreign_keys ?? []).length;
                  const idxCount = (def.indexes ?? []).length;
                  return (
                    <div key={table._name} className="rounded-lg border p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px] font-mono">{i + 1}</Badge>
                        <Table2 className="h-4 w-4 text-muted-foreground" />
                        <span className="font-mono text-sm font-medium">{table._name}</span>
                        <div className="flex gap-1.5 ml-auto">
                          <Badge variant="default" className="text-[10px] bg-green-500/10 text-green-500 border-green-500/20">{t('tables:yamlImport.tableNew')}</Badge>
                          <Badge variant="secondary" className="text-[10px]">{colCount} col</Badge>
                          {table.add_uuid_pk && <Badge variant="outline" className="text-[10px]">UUID PK</Badge>}
                          {table.add_timestamps && <Badge variant="outline" className="text-[10px]">Timestamps</Badge>}
                          {payloads.endpointTables.includes(table._name) && <Badge variant="outline" className="text-[10px]">CRUD</Badge>}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 text-[11px] text-muted-foreground font-mono">
                        {Object.entries(def.columns).map(([name, col]) => (
                          <span key={name}>
                            {name} <span className="text-muted-foreground/60">{col.type}</span>
                            {col.unique && <span className="text-blue-500 ml-0.5">UQ</span>}
                            {!col.nullable && col.nullable !== undefined && <span className="text-amber-500 ml-0.5">NN</span>}
                          </span>
                        ))}
                      </div>

                      {(fkCount > 0 || idxCount > 0) && (
                        <div className="flex gap-3 text-[11px] text-muted-foreground">
                          {fkCount > 0 && (
                            <span className="flex items-center gap-1">
                              <Key className="h-3 w-3" /> {fkCount} FK
                            </span>
                          )}
                          {idxCount > 0 && (
                            <span className="flex items-center gap-1">
                              <Hash className="h-3 w-3" /> {idxCount} idx
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {payloads.tableConflicts.map((conflict, ci) => (
                  <div key={conflict.tableName} className="rounded-lg border border-amber-500/30 p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <RefreshCw className="h-4 w-4 text-amber-500" />
                      <span className="font-mono text-sm font-medium">{conflict.tableName}</span>
                      <div className="flex gap-1.5 ml-auto">
                        <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-500">{t('tables:yamlImport.tableExists')}</Badge>
                        <button
                          onClick={() => toggleConflictAction(ci)}
                          className={`text-[10px] px-2 py-0.5 rounded-full border font-medium transition-colors ${
                            conflict.action === 'update'
                              ? 'bg-blue-500/10 text-blue-500 border-blue-500/30'
                              : 'bg-muted text-muted-foreground border-border'
                          }`}
                        >
                          {conflict.action === 'update' ? t('api:yamlImport.conflictUpdate') : t('api:yamlImport.conflictSkip')}
                        </button>
                      </div>
                    </div>
                    {conflict.changes.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {conflict.changes.map((change, i) => (
                          <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                            change.startsWith('+') ? 'text-green-500 bg-green-500/10'
                              : change.startsWith('-') ? 'text-red-500 bg-red-500/10'
                              : 'text-amber-500 bg-amber-500/10'
                          }`}>
                            {change}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[10px] text-muted-foreground">No changes</p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {warnings.length > 0 && (
              <div className="rounded-md border border-amber-500/50 bg-amber-500/5 p-3 space-y-1">
                {warnings.map((w, i) => (
                  <p key={i} className="text-xs text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    {w}
                  </p>
                ))}
              </div>
            )}

            <DialogFooter className="shrink-0">
              <Button variant="outline" onClick={() => setStage('edit')}>
                <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
                {t('common:actions.back')}
              </Button>
              <Button onClick={handleImport}>
                <Upload className="h-3.5 w-3.5 mr-1.5" />
                {t('tables:yamlImport.import')}
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* ── EXECUTING STAGE ── */}
        {stage === 'executing' && (
          <div className="flex flex-col items-center gap-4 py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">{executionStatus}</p>
          </div>
        )}

        {/* ── DONE STAGE ── */}
        {stage === 'done' && result && (
          <div className="space-y-4">
            {result.tablesFailed.length === 0 && result.fksFailed.length === 0 && result.indexesFailed.length === 0 && result.columnsFailed.length === 0 ? (
              <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                <CheckCircle className="h-5 w-5" />
                <span className="font-medium">{t('tables:yamlImport.success')}</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-5 w-5" />
                <span className="font-medium">{t('tables:yamlImport.partialSuccess')}</span>
              </div>
            )}

            <div className="space-y-2 text-sm">
              {result.tablesCreated.length > 0 && (
                <p className="text-muted-foreground">
                  <CheckCircle className="h-3.5 w-3.5 inline mr-1 text-green-500" />
                  {t('tables:yamlImport.tablesCreatedCount', { count: result.tablesCreated.length })}: <span className="font-mono">{result.tablesCreated.join(', ')}</span>
                </p>
              )}
              {result.fksCreated > 0 && (
                <p className="text-muted-foreground">
                  <CheckCircle className="h-3.5 w-3.5 inline mr-1 text-green-500" />
                  {result.fksCreated} foreign keys
                </p>
              )}
              {result.indexesCreated > 0 && (
                <p className="text-muted-foreground">
                  <CheckCircle className="h-3.5 w-3.5 inline mr-1 text-green-500" />
                  {result.indexesCreated} indexes
                </p>
              )}
              {result.tablesUpdated.length > 0 && (
                <p className="text-muted-foreground">
                  <CheckCircle className="h-3.5 w-3.5 inline mr-1 text-blue-500" />
                  {result.tablesUpdated.length} table(s) updated: <span className="font-mono">{result.tablesUpdated.join(', ')}</span>
                </p>
              )}
              {(result.columnsAdded > 0 || result.columnsAltered > 0 || result.columnsDropped > 0) && (
                <p className="text-muted-foreground text-xs">
                  {result.columnsAdded > 0 && <span className="text-green-500 mr-2">+{result.columnsAdded} col</span>}
                  {result.columnsRenamed > 0 && <span className="text-blue-500 mr-2">↔{result.columnsRenamed} renamed</span>}
                  {result.columnsAltered > 0 && <span className="text-amber-500 mr-2">~{result.columnsAltered} col</span>}
                  {result.columnsDropped > 0 && <span className="text-red-500 mr-2">-{result.columnsDropped} col</span>}
                  {result.indexesRemoved > 0 && <span className="text-red-500 mr-2">-{result.indexesRemoved} idx</span>}
                  {result.fksRemoved > 0 && <span className="text-red-500 mr-2">-{result.fksRemoved} FK</span>}
                </p>
              )}
              {result.endpointsCreated.length > 0 && (
                <p className="text-muted-foreground">
                  <CheckCircle className="h-3.5 w-3.5 inline mr-1 text-green-500" />
                  CRUD endpoints: <span className="font-mono">{result.endpointsCreated.join(', ')}</span>
                </p>
              )}

              {result.columnsFailed.map((f, i) => (
                <p key={`cf-${i}`} className="text-destructive text-xs">
                  <XCircle className="h-3.5 w-3.5 inline mr-1" />
                  {f.table}.{f.column}: {f.error}
                </p>
              ))}
              {result.tablesFailed.map((f, i) => (
                <p key={i} className="text-destructive text-xs">
                  <XCircle className="h-3.5 w-3.5 inline mr-1" />
                  {f.name}: {f.error}
                </p>
              ))}
              {result.fksFailed.map((f, i) => (
                <p key={i} className="text-destructive text-xs">
                  <XCircle className="h-3.5 w-3.5 inline mr-1" />
                  FK {f.table}.{f.column}: {f.error}
                </p>
              ))}
              {result.indexesFailed.map((f, i) => (
                <p key={i} className="text-destructive text-xs">
                  <XCircle className="h-3.5 w-3.5 inline mr-1" />
                  Index {f.table}({f.columns}): {f.error}
                </p>
              ))}
            </div>

            <DialogFooter>
              <Button onClick={handleClose}>{t('common:actions.close')}</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
