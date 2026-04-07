import { endpointsApi } from '@/api/endpoints.api';

export async function createCrudEndpoints(projectId: string, tableName: string) {
  const endpoints = [
    { method: 'GET',    path: `/${tableName}`,     description: `List all ${tableName}`,       source_type: 'table', source_config: { table: tableName, operation: 'list' },   auth_type: 'api_token' },
    { method: 'GET',    path: `/${tableName}/:id`, description: `Get single ${tableName}`,     source_type: 'table', source_config: { table: tableName, operation: 'get' },    auth_type: 'api_token' },
    { method: 'POST',   path: `/${tableName}`,     description: `Create ${tableName} record`,  source_type: 'table', source_config: { table: tableName, operation: 'create' }, auth_type: 'api_token' },
    { method: 'PUT',    path: `/${tableName}/:id`, description: `Update ${tableName} record`,  source_type: 'table', source_config: { table: tableName, operation: 'update' }, auth_type: 'api_token' },
    { method: 'DELETE', path: `/${tableName}/:id`, description: `Delete ${tableName} record`,  source_type: 'table', source_config: { table: tableName, operation: 'delete' }, auth_type: 'api_token' },
  ];
  await Promise.allSettled(endpoints.map((ep) => endpointsApi.create(projectId, ep)));
}
