import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Copy, Download, Upload, CheckCircle, XCircle, Loader2, ArrowLeft, AlertTriangle, Code, Plug } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { endpointsApi } from '@/api/endpoints.api';
import { HTTP_METHOD_COLORS } from '@/lib/constants';
import {
  parseEndpointYaml, detectEndpointConflicts, endpointsToYaml, getEndpointYamlTemplate,
  type YamlEndpointDef, type EndpointConflict, type EndpointImportPayloads,
} from '@/lib/yaml-endpoints';
import { toast } from 'sonner';

type Stage = 'edit' | 'preview' | 'executing' | 'done';

interface ExecutionResult {
  created: { method: string; path: string }[];
  updated: { method: string; path: string }[];
  skipped: number;
  failed: { method: string; path: string; error: string }[];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  initialYaml?: string;
}

export function EndpointImportDialog({ open, onOpenChange, projectId, initialYaml }: Props) {
  const { t } = useTranslation(['api', 'common']);
  const queryClient = useQueryClient();
  const [stage, setStage] = useState<Stage>('edit');
  const [yaml, setYaml] = useState(initialYaml ?? '');
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [importPayloads, setImportPayloads] = useState<EndpointImportPayloads | null>(null);
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
    navigator.clipboard.writeText(getEndpointYamlTemplate());
    toast.success(t('api:yamlImport.templateCopied'));
  }

  async function handleExport() {
    setIsExporting(true);
    try {
      const { endpoints } = await endpointsApi.list(projectId);
      if (endpoints.length === 0) {
        toast.info(t('api:yamlImport.noEndpointsToExport'));
        return;
      }
      const yamlStr = endpointsToYaml(endpoints);
      setYaml(yamlStr);
      try {
        await navigator.clipboard.writeText(yamlStr);
        toast.success(t('api:yamlImport.exported', { count: endpoints.filter(e => !e.deprecated_at).length }));
      } catch {
        toast.success(t('api:yamlImport.exported', { count: endpoints.filter(e => !e.deprecated_at).length }));
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setIsExporting(false);
    }
  }

  async function handleValidate() {
    const parsed = parseEndpointYaml(yaml);
    setErrors(parsed.errors);
    setWarnings(parsed.warnings);

    if (parsed.success && parsed.schema) {
      try {
        const { endpoints: existing } = await endpointsApi.list(projectId);
        const payloads = detectEndpointConflicts(parsed.schema.endpoints, existing);
        setImportPayloads(payloads);
        setStage('preview');
      } catch (e) {
        setErrors([(e as Error).message]);
      }
    }
  }

  function toggleConflictAction(idx: number) {
    if (!importPayloads) return;
    setImportPayloads({
      ...importPayloads,
      conflicts: importPayloads.conflicts.map((c, i) =>
        i === idx ? { ...c, action: c.action === 'skip' ? 'update' : 'skip' } : c
      ),
    });
  }

  async function handleImport() {
    if (!importPayloads) return;
    setStage('executing');

    const res: ExecutionResult = { created: [], updated: [], skipped: 0, failed: [] };

    for (const ep of importPayloads.toCreate) {
      setExecutionStatus(t('api:yamlImport.creatingEndpoint', { method: ep.method, path: ep.path }));
      try {
        await endpointsApi.create(projectId, buildPayload(ep));
        res.created.push({ method: ep.method, path: ep.path });
      } catch (e) {
        res.failed.push({ method: ep.method, path: ep.path, error: (e as Error).message });
      }
    }

    for (const conflict of importPayloads.conflicts) {
      if (conflict.action === 'skip') {
        res.skipped++;
        continue;
      }
      setExecutionStatus(t('api:yamlImport.updatingEndpoint', { method: conflict.endpoint.method, path: conflict.endpoint.path }));
      try {
        await endpointsApi.update(projectId, conflict.existingId, buildPayload(conflict.endpoint));
        res.updated.push({ method: conflict.endpoint.method, path: conflict.endpoint.path });
      } catch (e) {
        res.failed.push({ method: conflict.endpoint.method, path: conflict.endpoint.path, error: (e as Error).message });
      }
    }

    queryClient.invalidateQueries({ queryKey: ['endpoints', projectId] });
    setResult(res);
    setStage('done');
  }

  function buildPayload(ep: YamlEndpointDef): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      method: ep.method,
      path: ep.path,
      source_type: ep.source_type,
      source_config: ep.source_config,
    };
    if (ep.description) payload.description = ep.description;
    if (ep.tags) payload.tags = ep.tags;
    if (ep.auth_type) payload.auth_type = ep.auth_type;
    if (ep.cache_enabled !== undefined) payload.cache_enabled = ep.cache_enabled;
    if (ep.cache_ttl !== undefined) payload.cache_ttl = ep.cache_ttl;
    if (ep.cache_key_template) payload.cache_key_template = ep.cache_key_template;
    if (ep.cache_invalidation) payload.cache_invalidation = ep.cache_invalidation;
    if (ep.rate_limit) payload.rate_limit = ep.rate_limit;
    if (ep.validation_schema) payload.validation_schema = ep.validation_schema;
    if (ep.response_config) payload.response_config = ep.response_config;
    if (ep.is_active !== undefined) payload.is_active = ep.is_active;
    return payload;
  }

  function handleClose() {
    if (result) {
      queryClient.invalidateQueries({ queryKey: ['endpoints'] });
    }
    onOpenChange(false);
    setTimeout(() => {
      setStage('edit');
      setYaml('');
      setErrors([]);
      setWarnings([]);
      setImportPayloads(null);
      setResult(null);
      setExecutionStatus('');
    }, 200);
  }

  const toUpdateCount = importPayloads?.conflicts.filter(c => c.action === 'update').length ?? 0;
  const toSkipCount = importPayloads?.conflicts.filter(c => c.action === 'skip').length ?? 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{t('api:yamlImport.title')}</DialogTitle>
        </DialogHeader>

        {stage === 'edit' && (
          <div className="flex flex-col min-h-0 flex-1 gap-3">
            <div className="flex flex-wrap gap-2 shrink-0">
              <Button variant="outline" size="sm" onClick={handleCopyTemplate}>
                <Copy className="h-3.5 w-3.5 mr-1.5" />
                {t('api:yamlImport.copyTemplate')}
              </Button>
              <Button variant="outline" size="sm" onClick={handleExport} disabled={isExporting}>
                {isExporting ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1.5" />}
                {t('api:yamlImport.exportExisting')}
              </Button>
            </div>

            <div className="flex-1 min-h-0 overflow-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden space-y-3 pb-1">
              <Textarea
                value={yaml}
                onChange={(e) => { setYaml(e.target.value); setErrors([]); }}
                placeholder={getEndpointYamlTemplate()}
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
                {t('api:yamlImport.validatePreview')}
              </Button>
            </DialogFooter>
          </div>
        )}

        {stage === 'preview' && importPayloads && (
          <div className="flex flex-col min-h-0 flex-1 gap-4">
            <p className="text-sm text-muted-foreground shrink-0">
              {importPayloads.conflicts.length === 0
                ? t('api:yamlImport.previewDescSimple', { count: importPayloads.toCreate.length })
                : t('api:yamlImport.previewDesc', {
                    create: importPayloads.toCreate.length,
                    update: toUpdateCount,
                    skip: toSkipCount,
                  })
              }
            </p>

            <div className="flex-1 min-h-0 max-h-[calc(85vh-280px)] overflow-auto">
              <div className="space-y-2 pr-3">
                {importPayloads.toCreate.map((ep, i) => (
                  <div key={i} className="rounded-lg border p-3 flex items-center gap-2">
                    <Badge className={`text-[10px] font-mono border ${HTTP_METHOD_COLORS[ep.method] ?? ''}`}>
                      {ep.method}
                    </Badge>
                    <span className="font-mono text-sm">{ep.path}</span>
                    <div className="flex gap-1.5 ml-auto">
                      <Badge variant="default" className="text-[10px] bg-green-500/10 text-green-500 border-green-500/20">
                        {t('api:yamlImport.newEndpoint')}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {ep.source_type === 'custom_sql' ? <><Code className="h-3 w-3 mr-0.5" /> SQL</> : <><Plug className="h-3 w-3 mr-0.5" /> {(ep.source_config as Record<string, unknown>).table as string}</>}
                      </Badge>
                    </div>
                  </div>
                ))}

                {importPayloads.conflicts.map((conflict, i) => (
                  <div key={`c-${i}`} className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge className={`text-[10px] font-mono border ${HTTP_METHOD_COLORS[conflict.endpoint.method] ?? ''}`}>
                        {conflict.endpoint.method}
                      </Badge>
                      <span className="font-mono text-sm">{conflict.endpoint.path}</span>
                      <div className="flex gap-1.5 ml-auto">
                        <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-500">
                          {t('api:yamlImport.conflictDetected')}
                        </Badge>
                        <button
                          onClick={() => toggleConflictAction(i)}
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
                        {conflict.changes.map((change, ci) => (
                          <span key={ci} className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono">
                            {change}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[10px] text-muted-foreground">{t('api:yamlImport.noChanges')}</p>
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
              <Button onClick={handleImport} disabled={importPayloads.toCreate.length === 0 && toUpdateCount === 0}>
                <Upload className="h-3.5 w-3.5 mr-1.5" />
                {t('api:yamlImport.import')}
              </Button>
            </DialogFooter>
          </div>
        )}

        {stage === 'executing' && (
          <div className="flex flex-col items-center gap-4 py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">{executionStatus}</p>
          </div>
        )}

        {stage === 'done' && result && (
          <div className="space-y-4">
            {result.failed.length === 0 ? (
              <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                <CheckCircle className="h-5 w-5" />
                <span className="font-medium">{t('api:yamlImport.success')}</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-5 w-5" />
                <span className="font-medium">{t('api:yamlImport.partialSuccess')}</span>
              </div>
            )}

            <div className="space-y-2 text-sm">
              {result.created.length > 0 && (
                <p className="text-muted-foreground">
                  <CheckCircle className="h-3.5 w-3.5 inline mr-1 text-green-500" />
                  {t('api:yamlImport.endpointsCreatedCount', { count: result.created.length })}
                </p>
              )}
              {result.updated.length > 0 && (
                <p className="text-muted-foreground">
                  <CheckCircle className="h-3.5 w-3.5 inline mr-1 text-blue-500" />
                  {t('api:yamlImport.endpointsUpdatedCount', { count: result.updated.length })}
                </p>
              )}
              {result.skipped > 0 && (
                <p className="text-muted-foreground">
                  <CheckCircle className="h-3.5 w-3.5 inline mr-1 text-muted-foreground" />
                  {t('api:yamlImport.endpointsSkippedCount', { count: result.skipped })}
                </p>
              )}

              {result.failed.map((f, i) => (
                <p key={i} className="text-destructive text-xs">
                  <XCircle className="h-3.5 w-3.5 inline mr-1" />
                  {f.method} {f.path}: {f.error}
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
