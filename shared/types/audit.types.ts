export interface AuditLog {
  id: string;
  project_id: string | null;
  user_id: string | null;
  user_email: string | null;
  is_superadmin_action: boolean;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export type AuditAction =
  | 'auth.login'
  | 'auth.logout'
  | 'auth.register'
  | 'auth.refresh'
  | 'user.create'
  | 'user.update'
  | 'user.delete'
  | 'user.promote_superadmin'
  | 'user.deactivate'
  | 'project.create'
  | 'project.update'
  | 'project.delete'
  | 'project.member_add'
  | 'project.member_remove'
  | 'project.member_role_change'
  | 'table.create'
  | 'table.alter'
  | 'table.drop'
  | 'data.insert'
  | 'data.update'
  | 'data.delete'
  | 'data.bulk_delete'
  | 'data.import'
  | 'data.export'
  | 'endpoint.create'
  | 'endpoint.update'
  | 'endpoint.delete'
  | 'webhook.create'
  | 'webhook.update'
  | 'webhook.delete'
  | 'token.create'
  | 'token.revoke'
  | 'invite.create'
  | 'invite.use'
  | 'sql.execute';
