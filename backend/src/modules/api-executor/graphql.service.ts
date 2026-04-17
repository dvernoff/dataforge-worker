import type { Knex } from 'knex';

interface ColumnInfo {
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: string;
}

interface TableInfo {
  table_name: string;
}

function pgTypeToGraphQL(dataType: string, udtName: string): string {
  switch (udtName) {
    case 'int2':
    case 'int4':
    case 'int8':
      return 'Int';
    case 'float4':
    case 'float8':
    case 'numeric':
    case 'decimal':
      return 'Float';
    case 'bool':
      return 'Boolean';
    case 'uuid':
    case 'text':
    case 'varchar':
    case 'char':
    case 'bpchar':
    case 'name':
    case 'timestamptz':
    case 'timestamp':
    case 'date':
    case 'time':
    case 'timetz':
      return 'String';
    case 'json':
    case 'jsonb':
      return 'JSON';
    default:
      return 'String';
  }
}

function sanitizeName(name: string): string {
  return name
    .split(/[_\-\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

function camelCase(name: string): string {
  const parts = name.split(/[_\-\s]+/);
  return parts[0] + parts.slice(1).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}

export class GraphQLService {
  constructor(private db: Knex) {}

  async generateSchema(schema: string): Promise<string> {
    const tablesResult = await this.db.raw(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = ? AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `, [schema]);
    const tables: TableInfo[] = tablesResult.rows;

    if (tables.length === 0) {
      return `
        type Query {
          _empty: String
        }
      `;
    }

    const typeDefs: string[] = [];
    const queryFields: string[] = [];
    const mutationFields: string[] = [];
    const inputTypes: string[] = [];

    typeDefs.push('scalar JSON');

    for (const table of tables) {
      const columnsResult = await this.db.raw(`
        SELECT column_name, data_type, udt_name, is_nullable
        FROM information_schema.columns
        WHERE table_schema = ? AND table_name = ?
        ORDER BY ordinal_position
      `, [schema, table.table_name]);
      const columns: ColumnInfo[] = columnsResult.rows;

      if (columns.length === 0) continue;

      const typeName = sanitizeName(table.table_name);
      const fieldName = camelCase(table.table_name);

      const typeFields = columns.map((col) => {
        const gqlType = pgTypeToGraphQL(col.data_type, col.udt_name);
        const nullable = col.is_nullable === 'YES' ? '' : '!';
        return `    ${camelCase(col.column_name)}: ${gqlType}${nullable}`;
      });
      typeDefs.push(`  type ${typeName} {\n${typeFields.join('\n')}\n  }`);

      const skipFields = new Set(['id', 'created_at', 'updated_at', 'deleted_at']);
      const inputFields = columns
        .filter((col) => !skipFields.has(col.column_name))
        .map((col) => {
          const gqlType = pgTypeToGraphQL(col.data_type, col.udt_name);
          return `    ${camelCase(col.column_name)}: ${gqlType}`;
        });
      inputTypes.push(`  input ${typeName}Input {\n${inputFields.join('\n')}\n  }`);

      queryFields.push(`    ${fieldName}(limit: Int, offset: Int, where: JSON): [${typeName}!]!`);
      queryFields.push(`    ${fieldName}ById(id: String!): ${typeName}`);

      mutationFields.push(`    create${typeName}(data: ${typeName}Input!): ${typeName}!`);
      mutationFields.push(`    update${typeName}(id: String!, data: ${typeName}Input!): ${typeName}!`);
      mutationFields.push(`    delete${typeName}(id: String!): Boolean!`);
    }

    const schemaDef = [
      ...typeDefs,
      ...inputTypes,
      `  type Query {\n${queryFields.join('\n')}\n  }`,
      `  type Mutation {\n${mutationFields.join('\n')}\n  }`,
    ].join('\n\n');

    return schemaDef;
  }

  async generateResolvers(schema: string) {
    const tablesResult = await this.db.raw(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = ? AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `, [schema]);
    const tables: TableInfo[] = tablesResult.rows;

    const db = this.db;
    const Query: Record<string, Function> = {};
    const Mutation: Record<string, Function> = {};

    for (const table of tables) {
      const fieldName = camelCase(table.table_name);
      const typeName = sanitizeName(table.table_name);
      const fullTable = `${schema}.${table.table_name}`;

      Query[fieldName] = async (args: { limit?: number; offset?: number; where?: Record<string, unknown> }) => {
        let q = db(fullTable);
        if (args.where) {
          for (const [key, value] of Object.entries(args.where)) {
            q = q.where(key, value as string);
          }
        }
        if (args.limit) q = q.limit(Math.min(args.limit, 100));
        else q = q.limit(50);
        if (args.offset) q = q.offset(args.offset);
        const hasCreatedAt = await db.raw(`SELECT 1 FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = 'created_at'`, [schema, table.table_name]);
        if (hasCreatedAt.rows.length > 0) return q.orderBy('created_at', 'desc');
        return q;
      };

      Query[`${fieldName}ById`] = async (args: { id: string }) => {
        return db(fullTable).where({ id: args.id }).first();
      };

      Mutation[`create${typeName}`] = async (args: { data: Record<string, unknown> }) => {
        const data = camelToSnake(args.data);
        for (const [k, v] of Object.entries(data)) { if (v !== null && typeof v === 'object') data[k] = JSON.stringify(v); }
        const [row] = await db(fullTable).insert(data).returning('*');
        return row;
      };

      Mutation[`update${typeName}`] = async (args: { id: string; data: Record<string, unknown> }) => {
        const data = camelToSnake(args.data);
        for (const [k, v] of Object.entries(data)) { if (v !== null && typeof v === 'object') data[k] = JSON.stringify(v); }
        const [row] = await db(fullTable).where({ id: args.id }).update(data).returning('*');
        return row;
      };

      Mutation[`delete${typeName}`] = async (args: { id: string }) => {
        const deleted = await db(fullTable).where({ id: args.id }).delete();
        return deleted > 0;
      };
    }

    return { Query, Mutation };
  }

  async executeQuery(schema: string, query: string, variables?: Record<string, unknown>, timeoutMs = 30_000): Promise<unknown> {
    const { graphql: graphqlExec, buildSchema: buildGraphQLSchema } = await import('graphql');

    const schemaDef = await this.generateSchema(schema);
    const resolvers = await this.generateResolvers(schema);

    const gqlSchema = buildGraphQLSchema(schemaDef);


    const rootValue = {
      ...resolvers.Query,
      ...resolvers.Mutation,
    };

    const clamped = Math.max(1000, Math.min(timeoutMs, 120_000));
    const result = await this.db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL statement_timeout = ${clamped}`);

      const txQuery: Record<string, Function> = {};
      const txMutation: Record<string, Function> = {};
      for (const [k, fn] of Object.entries(resolvers.Query)) {
        txQuery[k] = (...args: unknown[]) => (fn as Function)(...args);
      }
      for (const [k, fn] of Object.entries(resolvers.Mutation)) {
        txMutation[k] = (...args: unknown[]) => (fn as Function)(...args);
      }

      return graphqlExec({
        schema: gqlSchema,
        source: query,
        rootValue: { ...txQuery, ...txMutation },
        variableValues: variables,
      });
    });

    return result;
  }
}

function camelToSnake(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const snakeKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
    result[snakeKey] = value;
  }
  return result;
}
