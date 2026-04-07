import type { Knex } from 'knex';

interface ColumnInfo {
  name: string;
  type: string;
  is_nullable: boolean;
  column_default: string | null;
}

const PG_TO_OPENAPI: Record<string, { type: string; format?: string }> = {
  uuid: { type: 'string', format: 'uuid' },
  text: { type: 'string' },
  varchar: { type: 'string' },
  'character varying': { type: 'string' },
  char: { type: 'string' },
  integer: { type: 'integer' },
  int4: { type: 'integer' },
  bigint: { type: 'integer', format: 'int64' },
  int8: { type: 'integer', format: 'int64' },
  smallint: { type: 'integer' },
  int2: { type: 'integer' },
  numeric: { type: 'number' },
  decimal: { type: 'number' },
  real: { type: 'number', format: 'float' },
  float4: { type: 'number', format: 'float' },
  'double precision': { type: 'number', format: 'double' },
  float8: { type: 'number', format: 'double' },
  boolean: { type: 'boolean' },
  bool: { type: 'boolean' },
  json: { type: 'object' },
  jsonb: { type: 'object' },
  date: { type: 'string', format: 'date' },
  timestamp: { type: 'string', format: 'date-time' },
  'timestamp with time zone': { type: 'string', format: 'date-time' },
  'timestamp without time zone': { type: 'string', format: 'date-time' },
  timestamptz: { type: 'string', format: 'date-time' },
};

const SYSTEM_COLUMNS = new Set(['id', 'created_at', 'updated_at', 'deleted_at']);

function pgTypeToOpenAPI(pgType: string): { type: string; format?: string } {
  const lower = pgType.toLowerCase();
  return PG_TO_OPENAPI[lower]
    ?? (lower.includes('int') ? { type: 'integer' } : { type: 'string' });
}

export class OpenAPIService {
  constructor(private db: Knex) {}

  private async getTableColumns(schema: string, table: string): Promise<ColumnInfo[]> {
    return this.db('information_schema.columns')
      .where({ table_schema: schema, table_name: table })
      .select(
        'column_name as name',
        'data_type as type',
        this.db.raw('(is_nullable = \'YES\') as is_nullable'),
        'column_default',
      )
      .orderBy('ordinal_position');
  }

  private buildRowSchema(columns: ColumnInfo[], responseConfig: any): Record<string, unknown> {
    const properties: Record<string, unknown> = {};
    const fields = responseConfig?.fields;

    for (const col of columns) {
      if (fields && typeof fields === 'object' && !Array.isArray(fields)) {
        const cfg = fields[col.name];
        if (cfg && cfg.enabled === false) continue;
        const key = cfg?.alias || col.name;
        const oaType = pgTypeToOpenAPI(col.type);
        properties[key] = { ...oaType, description: col.column_default ? `Default: ${col.column_default}` : undefined };
      } else {
        const oaType = pgTypeToOpenAPI(col.type);
        properties[col.name] = { ...oaType };
      }
    }

    return { type: 'object', properties };
  }

  private buildCreateBodySchema(columns: ColumnInfo[]): Record<string, unknown> {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const col of columns) {
      if (SYSTEM_COLUMNS.has(col.name)) continue;
      properties[col.name] = pgTypeToOpenAPI(col.type);
      if (!col.is_nullable && !col.column_default) {
        required.push(col.name);
      }
    }

    return { type: 'object', properties, ...(required.length ? { required } : {}) };
  }

  private buildUpdateBodySchema(columns: ColumnInfo[]): Record<string, unknown> {
    const properties: Record<string, unknown> = {};

    for (const col of columns) {
      if (SYSTEM_COLUMNS.has(col.name)) continue;
      properties[col.name] = pgTypeToOpenAPI(col.type);
    }

    return { type: 'object', properties };
  }

  async generateSpec(
    projectSlug: string,
    projectId: string,
    projectSchema: string,
    baseUrl: string,
  ): Promise<Record<string, unknown>> {
    const endpoints = await this.db('api_endpoints')
      .where({ project_id: projectId, is_active: true })
      .select('*');

    const columnCache = new Map<string, ColumnInfo[]>();
    const getColumns = async (table: string) => {
      if (!columnCache.has(table)) {
        columnCache.set(table, await this.getTableColumns(projectSchema, table));
      }
      return columnCache.get(table)!;
    };

    const spec: Record<string, unknown> = {
      openapi: '3.0.3',
      info: {
        title: `${projectSlug} API`,
        version: 'v1',
        description: `REST API for the **${projectSlug}** project.\n\nBase URL: \`${baseUrl}/api/v1/${projectSlug}\``,
      },
      servers: [{ url: `${baseUrl}/api/v1/${projectSlug}` }],
      components: {
        securitySchemes: {
          ApiKeyAuth: {
            type: 'apiKey',
            in: 'header',
            name: 'X-API-Key',
            description: 'API token created in project settings',
          },
        },
      },
      paths: {} as Record<string, unknown>,
    };

    const paths = spec.paths as Record<string, Record<string, unknown>>;

    for (const ep of endpoints) {
      const config = typeof ep.source_config === 'string' ? JSON.parse(ep.source_config) : ep.source_config;
      const responseConfig = typeof ep.response_config === 'string' ? JSON.parse(ep.response_config) : ep.response_config;
      const rateLimit = typeof ep.rate_limit === 'string' ? JSON.parse(ep.rate_limit) : ep.rate_limit;
      const operation = config?.operation ?? '';
      const table = config?.table ?? '';
      const pathKey = ep.path.replace(/:(\w+)/g, '{$1}');
      const method = ep.method.toLowerCase();

      let columns: ColumnInfo[] = [];
      if (ep.source_type === 'table' && table) {
        columns = await getColumns(table);
      }

      const rowSchema = columns.length > 0
        ? this.buildRowSchema(columns, responseConfig)
        : { type: 'object' };

      const summary = ep.description || `${ep.method} ${ep.path}`;
      const descParts: string[] = [];
      if (ep.source_type === 'table') {
        descParts.push(`**Table:** \`${projectSchema}.${table}\`  **Operation:** \`${operation}\``);
      } else {
        descParts.push('**Source:** Custom SQL');
      }
      if (ep.cache_enabled) {
        descParts.push(`**Cache:** ${ep.cache_ttl}s TTL`);
      }
      if (rateLimit?.max) {
        descParts.push(`**Rate limit:** ${rateLimit.max} requests / ${Math.round((rateLimit.window ?? 60000) / 1000)}s`);
      }
      if (ep.deprecated_at) {
        descParts.push(`**Deprecated:** ${ep.deprecated_at}`);
      }

      const op: Record<string, unknown> = {
        summary,
        description: descParts.join('\n\n'),
        tags: [table || 'custom'],
        deprecated: !!ep.deprecated_at,
      };

      if (ep.auth_type === 'api_token') {
        op.security = [{ ApiKeyAuth: [] }];
      }

      const parameters: Record<string, unknown>[] = [];
      const pathParamMatches = ep.path.match(/:(\w+)/g) || [];
      for (const p of pathParamMatches) {
        const name = p.slice(1);
        const col = columns.find((c) => c.name === name);
        const schema = col ? pgTypeToOpenAPI(col.type) : { type: 'string' };
        parameters.push({
          name,
          in: 'path',
          required: true,
          schema,
          description: operation === 'findOne'
            ? `Search by ${name}`
            : `Value for ${name}`,
        });
      }

      if (operation === 'find') {
        parameters.push(
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 }, description: 'Page number (starts at 1)' },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 }, description: 'Records per page (max 100)' },
          { name: 'sort', in: 'query', schema: { type: 'string' }, description: 'Column name to sort by' },
          { name: 'order', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'] }, description: 'Sort direction' },
        );
        for (const col of columns) {
          parameters.push({
            name: `filter[${col.name}]`,
            in: 'query',
            schema: { type: 'string' },
            description: `Filter by ${col.name} (exact match). Use filter[${col.name}][op] for operators: eq, neq, gt, gte, lt, lte, like, ilike, in, is_null`,
            required: false,
          });
        }
      }

      if (ep.source_type === 'custom_sql') {
        const query = config?.query ?? '';
        const sqlParams = (query.match(/\{\{(\w+)\}\}/g) || []).map((m: string) => m.replace(/\{|\}/g, ''));
        const uniqueParams = [...new Set(sqlParams)] as string[];
        const pathParamNames = pathParamMatches.map((p: string) => p.slice(1));

        for (const param of uniqueParams) {
          if (pathParamNames.includes(param)) continue;
          parameters.push({
            name: param,
            in: 'query',
            required: true,
            schema: { type: 'string' },
            description: `SQL parameter {{${param}}}`,
          });
        }
      }

      if (parameters.length) op.parameters = parameters;

      if (['POST', 'PUT', 'PATCH'].includes(ep.method) && ep.source_type === 'table' && columns.length > 0) {
        const bodySchema = operation === 'create'
          ? this.buildCreateBodySchema(columns)
          : this.buildUpdateBodySchema(columns);

        op.requestBody = {
          required: true,
          content: { 'application/json': { schema: bodySchema } },
          description: operation === 'create'
            ? 'All required fields must be provided. System fields (id, created_at, updated_at) are auto-generated.'
            : 'Only include fields you want to update. System fields are ignored.',
        };
      } else if (['POST', 'PUT', 'PATCH'].includes(ep.method)) {
        op.requestBody = {
          content: { 'application/json': { schema: { type: 'object' } } },
        };
      }

      const responses: Record<string, unknown> = {};

      if (operation === 'find') {
        responses['200'] = {
          description: 'List of records with pagination',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: { type: 'array', items: rowSchema },
                  pagination: {
                    type: 'object',
                    properties: {
                      page: { type: 'integer' },
                      limit: { type: 'integer' },
                      total: { type: 'integer' },
                      totalPages: { type: 'integer' },
                    },
                  },
                },
              },
            },
          },
        };
      } else if (operation === 'findOne') {
        responses['200'] = {
          description: 'Single record',
          content: { 'application/json': { schema: rowSchema } },
        };
        responses['404'] = { description: 'Record not found' };
      } else if (operation === 'create') {
        responses['201'] = {
          description: 'Created record',
          content: { 'application/json': { schema: rowSchema } },
        };
        responses['400'] = { description: 'Validation error — missing required fields or invalid types' };
        responses['409'] = { description: 'Duplicate key — unique constraint violated' };
      } else if (operation === 'update') {
        responses['200'] = {
          description: 'Updated record',
          content: { 'application/json': { schema: rowSchema } },
        };
        responses['400'] = { description: 'Record ID required' };
        responses['404'] = { description: 'Record not found' };
      } else if (operation === 'delete') {
        responses['204'] = { description: 'Record deleted (no content)' };
        responses['400'] = { description: 'Record ID required' };
        responses['404'] = { description: 'Record not found' };
      } else {
        responses['200'] = {
          description: 'Query result',
          content: { 'application/json': { schema: { type: 'array', items: { type: 'object' } } } },
        };
      }

      if (ep.auth_type === 'api_token') {
        responses['401'] = { description: 'API key missing, invalid, or expired' };
      }
      responses['422'] = { description: 'Database error — invalid data type or constraint violation' };
      if (rateLimit?.max) {
        responses['429'] = { description: `Rate limit exceeded (${rateLimit.max} requests / ${Math.round((rateLimit.window ?? 60000) / 1000)}s)` };
      }

      if (ep.cache_enabled) {
        const headers: Record<string, unknown> = {
          'X-Cache': { schema: { type: 'string', enum: ['HIT', 'MISS'] }, description: 'Cache hit or miss' },
        };
        if (responses['200'] && typeof responses['200'] === 'object') {
          (responses['200'] as Record<string, unknown>).headers = headers;
        }
      }

      op.responses = responses;

      if (!paths[pathKey]) paths[pathKey] = {};
      paths[pathKey][method] = op;
    }

    paths['/graphql'] = {
      post: {
        summary: 'GraphQL endpoint',
        description: 'Execute GraphQL queries and mutations against all project tables.',
        tags: ['GraphQL'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['query'],
                properties: {
                  query: { type: 'string', description: 'GraphQL query or mutation' },
                  variables: { type: 'object', description: 'Query variables' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'GraphQL response',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: { type: 'object' },
                    errors: { type: 'array', items: { type: 'object' } },
                  },
                },
              },
            },
          },
        },
      },
    };

    return spec;
  }
}
