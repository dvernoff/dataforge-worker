import type { ProjectRole } from '@shared/types/project.types';

export const ROLE_PERMISSIONS: Record<ProjectRole, Set<string>> = {
  admin: new Set([
    'project.update', 'project.delete', 'project.members',
    'table.create', 'table.alter', 'table.drop',
    'data.insert', 'data.update', 'data.delete', 'data.import', 'data.export',
    'data.view',
    'endpoint.create', 'endpoint.update', 'endpoint.delete', 'endpoint.view',
    'webhook.create', 'webhook.update', 'webhook.delete', 'webhook.view',
    'sql.all', 'sql.select',
    'audit.view',
    'token.create', 'token.revoke', 'token.view',
    'invite.create', 'invite.view',
  ]),
  editor: new Set([
    'table.create', 'table.alter', 'table.drop',
    'data.insert', 'data.update', 'data.delete', 'data.import', 'data.export',
    'data.view',
    'endpoint.create', 'endpoint.update', 'endpoint.delete', 'endpoint.view',
    'webhook.view',
    'sql.select',
    'audit.view',
    'token.view',
  ]),
  viewer: new Set([
    'data.view',
    'endpoint.view',
    'audit.view',
    'token.view',
  ]),
};

export function hasPermission(role: ProjectRole | undefined, permission: string): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

export const HTTP_METHOD_COLORS: Record<string, string> = {
  GET: 'bg-green-500/10 text-green-500 border-green-500/20',
  POST: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  PUT: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
  PATCH: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
  DELETE: 'bg-red-500/10 text-red-500 border-red-500/20',
};
