export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const MCP_TOOLS: McpToolDef[] = [
  {
    name: 'get_project_info',
    description: 'Learn about DataForge platform capabilities and how to work with this project. Call this first if you are unfamiliar with DataForge. Returns a guide explaining the platform, available tools, data types, best practices, and workflow recommendations.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_schema_context',
    description: 'Get the complete current project schema: all tables with their columns (name, type, nullable, default, primary, unique), all indexes, all foreign key constraints, and all API endpoints with their configuration. Always call this before making changes to understand what already exists.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'create_table',
    description: 'Create a new PostgreSQL table. By default adds a UUID "id" primary key and created_at/updated_at timestamps. Define only your business columns — system columns are auto-added based on options.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Table name (lowercase, underscores)' },
        columns: {
          type: 'array', items: {
            type: 'object', properties: {
              name: { type: 'string' }, type: { type: 'string', description: 'text|integer|bigint|float|decimal|boolean|date|timestamp|timestamptz|uuid|json|jsonb' },
              nullable: { type: 'boolean', default: true }, default_value: { type: 'string' }, is_unique: { type: 'boolean', default: false }, is_primary: { type: 'boolean', default: false },
            }, required: ['name', 'type'],
          },
        },
        add_uuid_pk: { type: 'boolean', default: true, description: 'Auto-add UUID id primary key' },
        add_timestamps: { type: 'boolean', default: true, description: 'Auto-add created_at/updated_at' },
      },
      required: ['name', 'columns'],
    },
  },
  {
    name: 'alter_columns',
    description: 'Add, alter, drop, or rename columns in an existing table.',
    inputSchema: {
      type: 'object',
      properties: {
        table_name: { type: 'string' },
        changes: {
          type: 'array', items: {
            type: 'object', properties: {
              action: { type: 'string', enum: ['add', 'alter', 'drop', 'rename'] },
              name: { type: 'string' }, newName: { type: 'string' }, type: { type: 'string' },
              nullable: { type: 'boolean' }, default_value: { type: 'string' }, is_unique: { type: 'boolean' },
            }, required: ['action', 'name'],
          },
        },
      },
      required: ['table_name', 'changes'],
    },
  },
  {
    name: 'drop_table',
    description: 'Drop a table and all its data, indexes, and endpoints.',
    inputSchema: {
      type: 'object',
      properties: { table_name: { type: 'string' } },
      required: ['table_name'],
    },
  },
  {
    name: 'add_index',
    description: 'Add an index to a table for query optimization.',
    inputSchema: {
      type: 'object',
      properties: {
        table_name: { type: 'string' }, columns: { type: 'array', items: { type: 'string' } },
        type: { type: 'string', enum: ['btree', 'hash', 'gin', 'gist'], default: 'btree' },
        is_unique: { type: 'boolean', default: false },
      },
      required: ['table_name', 'columns'],
    },
  },
  {
    name: 'drop_index',
    description: 'Drop an index by name.',
    inputSchema: {
      type: 'object',
      properties: { index_name: { type: 'string' } },
      required: ['index_name'],
    },
  },
  {
    name: 'add_foreign_key',
    description: 'Add a foreign key constraint between tables.',
    inputSchema: {
      type: 'object',
      properties: {
        table_name: { type: 'string' }, source_column: { type: 'string' },
        target_table: { type: 'string' }, target_column: { type: 'string' },
        on_delete: { type: 'string', enum: ['CASCADE', 'SET NULL', 'RESTRICT', 'NO ACTION'], default: 'NO ACTION' },
        on_update: { type: 'string', enum: ['CASCADE', 'SET NULL', 'RESTRICT', 'NO ACTION'], default: 'NO ACTION' },
      },
      required: ['table_name', 'source_column', 'target_table', 'target_column'],
    },
  },
  {
    name: 'drop_foreign_key',
    description: 'Drop a foreign key constraint by name.',
    inputSchema: {
      type: 'object',
      properties: { table_name: { type: 'string' }, constraint_name: { type: 'string' } },
      required: ['table_name', 'constraint_name'],
    },
  },
  {
    name: 'create_endpoint',
    description: 'Create an API endpoint (table-based CRUD or custom SQL).',
    inputSchema: {
      type: 'object',
      properties: {
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
        path: { type: 'string', description: 'URL path starting with /' },
        description: { type: 'string' },
        source_type: { type: 'string', enum: ['table', 'custom_sql'] },
        source_config: { type: 'object', description: 'For table: {table, operation}. For custom_sql: {query}' },
        auth_type: { type: 'string', enum: ['api_token', 'public'], default: 'api_token' },
        cache_enabled: { type: 'boolean', default: false },
        cache_ttl: { type: 'number', description: 'Cache TTL in seconds (1-86400)' },
        rate_limit: { type: 'object', properties: { max: { type: 'number' }, window: { type: 'number' }, per: { type: 'string' } } },
      },
      required: ['method', 'path', 'source_type', 'source_config'],
    },
  },
  {
    name: 'update_endpoint',
    description: 'Update an existing API endpoint.',
    inputSchema: {
      type: 'object',
      properties: {
        endpoint_id: { type: 'string' },
        method: { type: 'string' }, path: { type: 'string' }, description: { type: 'string' },
        source_type: { type: 'string' }, source_config: { type: 'object' },
        auth_type: { type: 'string' }, cache_enabled: { type: 'boolean' }, cache_ttl: { type: 'number' },
        rate_limit: { type: 'object' }, is_active: { type: 'boolean' },
      },
      required: ['endpoint_id'],
    },
  },
  {
    name: 'delete_endpoint',
    description: 'Delete an API endpoint.',
    inputSchema: {
      type: 'object',
      properties: { endpoint_id: { type: 'string' } },
      required: ['endpoint_id'],
    },
  },
  {
    name: 'execute_sql',
    description: 'Execute a read-only SQL query (SELECT/EXPLAIN/WITH only).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'SQL query (SELECT only)' },
        timeout: { type: 'number', description: 'Timeout in ms (default 30000, max 120000)' },
      },
      required: ['query'],
    },
  },
];
