import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Copy, Download, Check, Info, ChevronDown, ChevronRight, Lock, Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { useCurrentProject } from '@/hooks/useProject';
import { usePageTitle } from '@/hooks/usePageTitle';
import { endpointsApi } from '@/api/endpoints.api';
import { toast } from 'sonner';

const METHOD_COLORS: Record<string, string> = {
  get: 'bg-green-500/15 text-green-600 border-green-500/30',
  post: 'bg-blue-500/15 text-blue-600 border-blue-500/30',
  put: 'bg-orange-500/15 text-orange-600 border-orange-500/30',
  patch: 'bg-yellow-500/15 text-yellow-600 border-yellow-500/30',
  delete: 'bg-red-500/15 text-red-600 border-red-500/30',
};

interface OpenAPIParam {
  name: string;
  in: string;
  required?: boolean;
  description?: string;
  schema?: { type?: string; format?: string; default?: unknown; enum?: string[]; maximum?: number };
}

interface OpenAPIOperation {
  summary?: string;
  description?: string;
  tags?: string[];
  deprecated?: boolean;
  security?: Record<string, unknown>[];
  parameters?: OpenAPIParam[];
  requestBody?: {
    required?: boolean;
    description?: string;
    content?: Record<string, { schema?: Record<string, unknown> }>;
  };
  responses?: Record<string, {
    description?: string;
    headers?: Record<string, { schema?: Record<string, unknown>; description?: string }>;
    content?: Record<string, { schema?: Record<string, unknown> }>;
  }>;
}

interface OpenAPISpec {
  openapi?: string;
  info?: { title?: string; version?: string; description?: string };
  servers?: { url: string }[];
  paths?: Record<string, Record<string, OpenAPIOperation>>;
}

/** Render simple markdown-like text: **bold**, `code`, newlines. Strips Base URL lines (shown separately). */
function DescriptionText({ text }: { text: string }) {
  const parts = text.split('\n\n').filter(p => !p.startsWith('Base URL:'));
  return (
    <div className="text-sm text-muted-foreground space-y-1">
      {parts.map((part, i) => (
        <p key={i} dangerouslySetInnerHTML={{
          __html: part
            .replace(/\*\*(.+?)\*\*/g, '<strong class="text-foreground">$1</strong>')
            .replace(/`(.+?)`/g, '<code class="bg-muted px-1 py-0.5 rounded text-xs font-mono">$1</code>')
        }} />
      ))}
    </div>
  );
}

function EndpointCard({ method, path, op }: {
  method: string;
  path: string;
  op: OpenAPIOperation;
}) {
  const [expanded, setExpanded] = useState(false);
  const params = op.parameters ?? [];
  const pathParams = params.filter(p => p.in === 'path');
  const queryParams = params.filter(p => p.in === 'query');
  const bodySchema = op.requestBody?.content?.['application/json']?.schema;
  const responses = op.responses ?? {};
  const isSecured = !!op.security?.length;

  return (
    <div className={`border rounded-lg overflow-hidden ${op.deprecated ? 'opacity-60' : ''}`}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
      >
        <Badge className={`font-mono text-xs border uppercase shrink-0 ${METHOD_COLORS[method] ?? ''}`} variant="outline">
          {method}
        </Badge>
        <code className="text-sm font-mono flex-1">{path}</code>
        <div className="flex items-center gap-2 shrink-0">
          {op.deprecated && <Badge variant="outline" className="text-[10px] text-yellow-600 border-yellow-500/30">deprecated</Badge>}
          {isSecured ? <Lock className="h-3.5 w-3.5 text-muted-foreground" /> : <Globe className="h-3.5 w-3.5 text-muted-foreground" />}
          {op.summary && <span className="text-sm text-muted-foreground truncate max-w-[250px]">{op.summary}</span>}
        </div>
        {expanded ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="border-t px-4 py-4 space-y-4 bg-muted/10">
          {/* Description with markdown */}
          {op.description && <DescriptionText text={op.description} />}

          {/* Auth info */}
          {isSecured && (
            <div className="flex items-center gap-2 text-xs">
              <Lock className="h-3 w-3 text-orange-500" />
              <span className="text-orange-600 font-medium">X-API-Key</span>
            </div>
          )}

          {/* Path parameters */}
          {pathParams.length > 0 && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">Path Parameters</p>
              <div className="rounded border overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="bg-muted/50">
                    <th className="text-left px-3 py-1.5 text-xs font-medium text-muted-foreground">Name</th>
                    <th className="text-left px-3 py-1.5 text-xs font-medium text-muted-foreground">Type</th>
                    <th className="text-left px-3 py-1.5 text-xs font-medium text-muted-foreground">Description</th>
                  </tr></thead>
                  <tbody>
                    {pathParams.map((p) => (
                      <tr key={p.name} className="border-t">
                        <td className="px-3 py-1.5"><code className="font-mono text-xs">{p.name}</code> <Badge variant="destructive" className="text-[9px] px-1 py-0 ml-1">required</Badge></td>
                        <td className="px-3 py-1.5 text-xs text-muted-foreground">{p.schema?.type}{p.schema?.format ? ` (${p.schema.format})` : ''}</td>
                        <td className="px-3 py-1.5 text-xs text-muted-foreground">{p.description ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Query parameters */}
          {queryParams.length > 0 && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">Query Parameters</p>
              <div className="rounded border overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="bg-muted/50">
                    <th className="text-left px-3 py-1.5 text-xs font-medium text-muted-foreground">Name</th>
                    <th className="text-left px-3 py-1.5 text-xs font-medium text-muted-foreground">Type</th>
                    <th className="text-left px-3 py-1.5 text-xs font-medium text-muted-foreground">Description</th>
                  </tr></thead>
                  <tbody>
                    {queryParams.map((p) => (
                      <tr key={p.name} className="border-t">
                        <td className="px-3 py-1.5">
                          <code className="font-mono text-xs">{p.name}</code>
                          {p.required && <Badge variant="destructive" className="text-[9px] px-1 py-0 ml-1">required</Badge>}
                        </td>
                        <td className="px-3 py-1.5 text-xs text-muted-foreground">
                          {p.schema?.type}
                          {p.schema?.default !== undefined && <span className="ml-1">(default: {String(p.schema.default)})</span>}
                          {p.schema?.enum && <span className="ml-1">[{p.schema.enum.join(', ')}]</span>}
                        </td>
                        <td className="px-3 py-1.5 text-xs text-muted-foreground">{p.description ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Request Body */}
          {bodySchema && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
                Request Body
                {op.requestBody?.required && <Badge variant="destructive" className="text-[9px] px-1 py-0 ml-2">required</Badge>}
              </p>
              {op.requestBody?.description && (
                <p className="text-xs text-muted-foreground mb-1">{op.requestBody.description}</p>
              )}
              <pre className="bg-muted/50 rounded p-3 text-xs font-mono overflow-auto max-h-[250px]">
                {JSON.stringify(bodySchema, null, 2)}
              </pre>
            </div>
          )}

          {/* Responses */}
          {Object.keys(responses).length > 0 && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">Responses</p>
              <div className="space-y-2">
                {Object.entries(responses).map(([code, res]) => {
                  const resSchema = res.content?.['application/json']?.schema;
                  return (
                    <div key={code} className="rounded border overflow-hidden">
                      <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/30">
                        <Badge variant={code.startsWith('2') ? 'default' : 'destructive'} className="font-mono text-xs">
                          {code}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{res.description}</span>
                      </div>
                      {resSchema && (
                        <pre className="px-3 py-2 text-xs font-mono overflow-auto max-h-[200px] bg-muted/10">
                          {JSON.stringify(resSchema, null, 2)}
                        </pre>
                      )}
                      {res.headers && (
                        <div className="px-3 py-1.5 border-t bg-muted/10">
                          <span className="text-[10px] font-medium text-muted-foreground uppercase">Headers: </span>
                          {Object.entries(res.headers).map(([hdr, hdrVal]) => (
                            <Badge key={hdr} variant="outline" className="text-[10px] font-mono ml-1">{hdr}: {hdrVal.description ?? ''}</Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function SwaggerPage() {
  const { t } = useTranslation(['api', 'common']);
  usePageTitle(t('api:swagger.title'));
  const { data: project } = useCurrentProject();
  const [copiedUrl, setCopiedUrl] = useState(false);

  const { data: specData, isLoading, error } = useQuery({
    queryKey: ['openapi-spec', project?.id],
    queryFn: () => endpointsApi.getOpenApiSpec(project!.id),
    enabled: !!project?.id,
    refetchOnMount: true,
  });

  const spec = specData as OpenAPISpec | undefined;
  const paths = spec?.paths ?? {};
  const hasEndpoints = Object.keys(paths).length > 0;

  const specJson = spec ? JSON.stringify(spec, null, 2) : '';

  // Group endpoints by tag
  const taggedEndpoints = useMemo(() => {
    if (!paths) return new Map<string, { method: string; path: string; op: OpenAPIOperation }[]>();
    const grouped = new Map<string, { method: string; path: string; op: OpenAPIOperation }[]>();
    for (const [path, methods] of Object.entries(paths)) {
      for (const [method, op] of Object.entries(methods)) {
        const tag = op.tags?.[0] ?? 'other';
        if (!grouped.has(tag)) grouped.set(tag, []);
        grouped.get(tag)!.push({ method, path, op });
      }
    }
    return grouped;
  }, [paths]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(specJson);
    setCopiedUrl(true);
    toast.success(t('api:swagger.copied'));
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([specJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project?.slug ?? 'api'}-openapi.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <PageWrapper>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('api:swagger.title')}</h1>
        {spec && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleCopy}>
              {copiedUrl ? <Check className="h-3.5 w-3.5 mr-1.5" /> : <Copy className="h-3.5 w-3.5 mr-1.5" />}
              {copiedUrl ? t('api:swagger.copied') : t('api:swagger.copySpec')}
            </Button>
            <Button variant="outline" size="sm" onClick={handleDownload}>
              <Download className="h-3.5 w-3.5 mr-1.5" />
              {t('api:swagger.download')}
            </Button>
          </div>
        )}
      </div>

      <Alert className="mb-4">
        <Info className="h-4 w-4" />
        <AlertDescription>{t('api:swagger.description')}</AlertDescription>
      </Alert>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
        </div>
      ) : error || !spec ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-muted-foreground text-sm">{t('api:swagger.noEndpoints')}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* API Info */}
          {spec.info && (
            <Card>
              <CardContent>
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-semibold">{spec.info.title ?? project?.slug}</h2>
                  {spec.info.version && <Badge variant="outline" className="font-mono">{spec.info.version}</Badge>}
                  <Badge variant="secondary">{t('api:swagger.openapi')} {spec.openapi ?? '3.0'}</Badge>
                </div>
                {spec.info.description && <DescriptionText text={spec.info.description} />}
                {spec.servers?.[0]?.url && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">Base URL:</span>
                    <code className="text-xs font-mono bg-muted px-2 py-0.5 rounded select-all">{spec.servers[0].url}</code>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Endpoints grouped by tag */}
          {hasEndpoints ? (
            <>
              {[...taggedEndpoints.entries()].map(([tag, endpoints]) => (
                <Card key={tag}>
                  <CardHeader>
                    <CardTitle className="text-base capitalize">
                      {tag} <span className="text-muted-foreground font-normal text-sm">({endpoints.length})</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {endpoints.map(({ method, path, op }) => (
                      <EndpointCard key={`${method}-${path}`} method={method} path={path} op={op} />
                    ))}
                  </CardContent>
                </Card>
              ))}
            </>
          ) : (
            <Card>
              <CardContent className="py-10 text-center">
                <p className="text-muted-foreground text-sm">{t('api:swagger.noEndpoints')}</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </PageWrapper>
  );
}
