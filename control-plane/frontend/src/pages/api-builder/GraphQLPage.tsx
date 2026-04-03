import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Play, ChevronRight, ChevronDown, Table2, Columns3, BookOpen, Copy, Key } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { PageWrapper } from '@/components/shared/PageWrapper';
import { useCurrentProject } from '@/hooks/useProject';
import { usePageTitle } from '@/hooks/usePageTitle';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { schemaApi, type TableInfo } from '@/api/schema.api';

const DEFAULT_QUERY = `{
  # Replace with your table name
  # users(limit: 10) {
  #   id
  #   name
  #   email
  # }
}`;

function toCamelCase(str: string): string {
  const parts = str.split(/[_\-\s]+/);
  return parts[0] + parts.slice(1).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}

function toPascalCase(str: string): string {
  return str
    .split(/[_\-\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

function generateQueryTemplate(tableName: string, columns: string[]): string {
  const fieldName = toCamelCase(tableName);
  const fields = columns.map((c) => `    ${toCamelCase(c)}`).join('\n');
  return `{\n  ${fieldName}(limit: 10) {\n${fields}\n  }\n}`;
}

function generateByIdTemplate(tableName: string, columns: string[]): string {
  const fieldName = toCamelCase(tableName);
  const fields = columns.map((c) => `    ${toCamelCase(c)}`).join('\n');
  return `{\n  ${fieldName}ById(id: "YOUR_ID_HERE") {\n${fields}\n  }\n}`;
}

function generateMutationTemplate(tableName: string, columns: string[]): string {
  const typeName = toPascalCase(tableName);
  const skipFields = new Set(['id', 'created_at', 'updated_at', 'deleted_at']);
  const inputFields = columns
    .filter((c) => !skipFields.has(c))
    .map((c) => `      ${toCamelCase(c)}: ""`)
    .join('\n');
  return `mutation {\n  create${typeName}(data: {\n${inputFields}\n  }) {\n    ${toCamelCase('id')}\n  }\n}`;
}

export function GraphQLPage() {
  const { t } = useTranslation(['api', 'common']);
  usePageTitle(t('api:graphql.title'));
  const { data: project } = useCurrentProject();
  const navigate = useNavigate();
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [result, setResult] = useState<unknown>(null);
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());
  const [showDocs, setShowDocs] = useState(false);

  // Fetch tables for DB Explorer
  const { data: tablesData } = useQuery({
    queryKey: ['tables', project?.id],
    queryFn: () => schemaApi.listTables(project!.id),
    enabled: !!project?.id,
  });

  // Fetch table details when expanded
  const [tableDetails, setTableDetails] = useState<Record<string, TableInfo>>({});

  const fetchTableDetails = async (tableName: string) => {
    if (!project?.id || tableDetails[tableName]) return;
    try {
      const res = await schemaApi.getTable(project.id, tableName);
      setTableDetails((prev) => ({ ...prev, [tableName]: res.table }));
    } catch {
      // ignore
    }
  };

  const toggleTable = (tableName: string) => {
    setExpandedTables((prev) => {
      const next = new Set(prev);
      if (next.has(tableName)) {
        next.delete(tableName);
      } else {
        next.add(tableName);
        fetchTableDetails(tableName);
      }
      return next;
    });
  };

  const handleInsertTemplate = (tableName: string, type: 'list' | 'byId' | 'mutation') => {
    const details = tableDetails[tableName];
    if (!details) return;
    const columns = details.columns.map((c) => c.name);
    let template = '';
    if (type === 'list') template = generateQueryTemplate(tableName, columns);
    else if (type === 'byId') template = generateByIdTemplate(tableName, columns);
    else template = generateMutationTemplate(tableName, columns);
    setQuery(template);
  };

  const executeMutation = useMutation({
    mutationFn: async () => {
      if (!project?.slug) throw new Error('No project');
      const response = await api.post<unknown>(
        `/projects/${project.id}/graphql`,
        { query }
      );
      return response;
    },
    onSuccess: (data) => setResult(data),
    onError: (err: Error) => {
      toast.error(err.message);
      setResult({ errors: [{ message: err.message }] });
    },
  });

  const nodeBaseUrl = project?.node_url?.replace(/\/$/, '') ?? window.location.origin;
  const graphqlUrl = project?.slug
    ? `${nodeBaseUrl}/api/v1/${project.slug}/graphql`
    : '';
  const basePath = project?.slug ? `/projects/${project.slug}` : '';

  const tables = tablesData?.tables ?? [];

  return (
    <PageWrapper>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('api:graphql.title')}</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowDocs(!showDocs)}
          >
            <BookOpen className="h-3 w-3 mr-1" />
            {t('api:graphql.docs')}
          </Button>
        </div>
      </div>

      {/* Auth info banner */}
      <Alert className="mb-4">
        <Key className="h-4 w-4" />
        <AlertDescription>
          {t('api:graphql.authBanner')}{' '}
          <button
            onClick={() => navigate(`${basePath}/settings/tokens`)}
            className="text-primary hover:underline font-medium"
          >
            {t('api:graphql.manageTokens')}
          </button>
        </AlertDescription>
      </Alert>

      {/* Endpoint URL */}
      {graphqlUrl && (
        <div className="mb-4 flex items-center gap-2">
          <code className="text-xs bg-muted px-3 py-1.5 rounded font-mono flex-1 truncate">
            POST {graphqlUrl}
          </code>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              navigator.clipboard.writeText(graphqlUrl);
              toast.success(t('api:graphql.urlCopied'));
            }}
          >
            <Copy className="h-3 w-3" />
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[240px_1fr_1fr] lg:grid-cols-[220px_1fr_1fr] gap-4">
        {/* DB Explorer Sidebar */}
        <Card className="overflow-hidden">
          <CardHeader className="pb-2 pt-3 px-3">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <Table2 className="h-3.5 w-3.5" />
              {t('api:graphql.explorer')}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 max-h-[500px] overflow-y-auto">
            {tables.length === 0 ? (
              <p className="text-xs text-muted-foreground p-3">
                {t('api:graphql.noTables')}
              </p>
            ) : (
              <div className="py-1">
                {tables.map((table) => {
                  const isExpanded = expandedTables.has(table.name);
                  const details = tableDetails[table.name];
                  return (
                    <div key={table.name}>
                      <button
                        className="w-full flex items-center gap-1 px-3 py-1.5 text-xs hover:bg-muted/50 text-left"
                        onClick={() => toggleTable(table.name)}
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-3 w-3 shrink-0" />
                        ) : (
                          <ChevronRight className="h-3 w-3 shrink-0" />
                        )}
                        <Table2 className="h-3 w-3 shrink-0 text-muted-foreground" />
                        <span className="font-mono truncate">{table.name}</span>
                        <span className="ml-auto text-muted-foreground">{table.row_count}</span>
                      </button>
                      {isExpanded && details && (
                        <div className="ml-5 border-l pl-2">
                          {details.columns.map((col) => (
                            <div
                              key={col.name}
                              className="flex items-center gap-1 px-2 py-0.5 text-xs text-muted-foreground"
                            >
                              <Columns3 className="h-2.5 w-2.5 shrink-0" />
                              <span className="font-mono truncate">{col.name}</span>
                              <span className="ml-auto text-[10px] opacity-60">{col.type}</span>
                            </div>
                          ))}
                          <div className="flex gap-1 px-2 py-1.5">
                            <button
                              className="text-[10px] text-primary hover:underline"
                              onClick={() => handleInsertTemplate(table.name, 'list')}
                            >
                              {t('api:graphql.templateList')}
                            </button>
                            <span className="text-muted-foreground text-[10px]">|</span>
                            <button
                              className="text-[10px] text-primary hover:underline"
                              onClick={() => handleInsertTemplate(table.name, 'byId')}
                            >
                              {t('api:graphql.templateById')}
                            </button>
                            <span className="text-muted-foreground text-[10px]">|</span>
                            <button
                              className="text-[10px] text-primary hover:underline"
                              onClick={() => handleInsertTemplate(table.name, 'mutation')}
                            >
                              {t('api:graphql.templateMutation')}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Query Panel */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base">{t('api:graphql.query')}</CardTitle>
            <Button
              size="sm"
              onClick={() => executeMutation.mutate()}
              disabled={executeMutation.isPending}
            >
              <Play className="h-3 w-3 mr-1" />
              {executeMutation.isPending ? t('api:graphql.running') : t('api:graphql.run')}
            </Button>
          </CardHeader>
          <CardContent>
            <Textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="font-mono min-h-[400px] text-sm"
              placeholder={t('api:graphql.placeholder')}
            />
          </CardContent>
        </Card>

        {/* Result Panel */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t('api:graphql.result')}</CardTitle>
          </CardHeader>
          <CardContent>
            {result ? (
              <pre className="bg-muted/50 rounded-lg p-4 text-sm font-mono overflow-auto min-h-[400px] max-h-[500px]">
                {JSON.stringify(result, null, 2)}
              </pre>
            ) : (
              <div className="flex items-center justify-center min-h-[400px] text-muted-foreground text-sm">
                {t('api:graphql.noResult')}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Docs Panel (collapsible) */}
      {showDocs && (
        <Card className="mt-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t('api:graphql.docsTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-3">
            <div>
              <h4 className="font-medium mb-1">{t('api:graphql.docsQueries')}</h4>
              <p className="text-muted-foreground text-xs">{t('api:graphql.docsQueriesDesc')}</p>
              <pre className="bg-muted/50 rounded p-2 mt-1 text-xs font-mono">
{`{ tableName(limit: 10, offset: 0, where: { column: "value" }) { id ... } }
{ tableNameById(id: "uuid") { id ... } }`}
              </pre>
            </div>
            <div>
              <h4 className="font-medium mb-1">{t('api:graphql.docsMutations')}</h4>
              <p className="text-muted-foreground text-xs">{t('api:graphql.docsMutationsDesc')}</p>
              <pre className="bg-muted/50 rounded p-2 mt-1 text-xs font-mono">
{`mutation { createTableName(data: { field: "value" }) { id } }
mutation { updateTableName(id: "uuid", data: { field: "new" }) { id } }
mutation { deleteTableName(id: "uuid") }`}
              </pre>
            </div>
            <div>
              <h4 className="font-medium mb-1">{t('api:graphql.docsAuth')}</h4>
              <p className="text-muted-foreground text-xs">{t('api:graphql.docsAuthDesc')}</p>
            </div>
          </CardContent>
        </Card>
      )}
    </PageWrapper>
  );
}
