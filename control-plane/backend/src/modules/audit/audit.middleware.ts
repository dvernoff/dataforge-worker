import type { FastifyRequest } from 'fastify';
import { AuditService } from './audit.service.js';
import { db } from '../../config/database.js';

const auditService = new AuditService(db);

export async function logAudit(
  request: FastifyRequest,
  action: string,
  resourceType?: string,
  resourceId?: string,
  details?: Record<string, unknown>,
) {
  try {
    let projectId = (request.params as Record<string, string>)?.projectId;
    if (!projectId) {
      const match = request.url.match(/\/projects\/([0-9a-f-]{36})\//i);
      if (match) projectId = match[1];
    }

    await auditService.log({
      project_id: projectId ?? undefined,
      user_id: request.user?.id,
      user_email: request.user?.email,
      is_superadmin_action: request.user?.is_superadmin ?? false,
      action,
      resource_type: resourceType,
      resource_id: resourceId,
      details,
      ip_address: request.ip,
      user_agent: request.headers['user-agent'] ?? undefined,
    });
  } catch (error) {
    // Don't let audit logging failures break the request
    request.log.error(error, 'Audit log error');
  }
}
