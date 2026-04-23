import type { Knex } from 'knex';
import { AppError } from '../../middleware/error-handler.js';
import { deriveRequiredScopes } from '../../utils/scope-matcher.js';

interface CreateEndpointInput {
  method: string;
  path: string;
  description?: string;
  tags?: string[];
  source_type: string;
  source_config: Record<string, unknown>;
  validation_schema?: Record<string, unknown>;
  response_config?: Record<string, unknown>;
  cache_enabled?: boolean;
  cache_ttl?: number;
  cache_key_template?: string;
  cache_invalidation?: Record<string, unknown> | null;
  rate_limit?: Record<string, unknown>;
  auth_type?: string;
  is_active?: boolean;
  version?: number;
  rollout?: { strategy: 'full' | 'canary'; percentage?: number; sticky_by?: 'api_token' | 'ip' };
  deprecates?: { replaces_version?: number; sunset_date?: string };
  required_scopes?: string[];
}

export class BuilderService {
  constructor(private db: Knex) {}

  async create(projectId: string, userId: string, input: CreateEndpointInput) {
    const version = input.version ?? 1;
    const existing = await this.db('api_endpoints')
      .where({ project_id: projectId, method: input.method, path: input.path, version })
      .whereNull('deprecated_at')
      .first();
    if (existing) {
      throw new AppError(409, `An endpoint with ${input.method} ${input.path} at version ${version} already exists. Use a different version number or deprecate the existing one.`);
    }

    const [endpoint] = await this.db('api_endpoints')
      .insert({
        project_id: projectId,
        method: input.method,
        path: input.path,
        description: input.description ?? null,
        tags: input.tags ?? [],
        source_type: input.source_type,
        source_config: JSON.stringify(input.source_config),
        validation_schema: input.validation_schema ? JSON.stringify(input.validation_schema) : null,
        response_config: input.response_config ? JSON.stringify(input.response_config) : null,
        cache_enabled: input.cache_enabled ?? false,
        cache_ttl: input.cache_ttl ?? 60,
        cache_key_template: input.cache_key_template ?? null,
        cache_invalidation: input.cache_invalidation ? JSON.stringify(input.cache_invalidation) : null,
        rate_limit: input.rate_limit ? JSON.stringify(input.rate_limit) : null,
        auth_type: input.auth_type ?? 'api_token',
        is_active: input.is_active ?? true,
        version: input.version ?? 1,
        rollout: input.rollout ? JSON.stringify(input.rollout) : null,
        deprecates: input.deprecates ? JSON.stringify(input.deprecates) : null,
        sunset_at: input.deprecates?.sunset_date ? new Date(input.deprecates.sunset_date) : null,
        required_scopes: JSON.stringify(
          input.required_scopes && input.required_scopes.length > 0
            ? input.required_scopes
            : deriveRequiredScopes(input.source_type, input.source_config, input.method),
        ),
        created_by: userId,
      })
      .returning('*');

    return endpoint;
  }

  async createNewVersion(endpointId: string, projectId: string) {
    const existing = await this.findById(endpointId, projectId);

    const oldVersion = existing.version ?? 1;
    await this.db('api_endpoints')
      .where({ id: endpointId, project_id: projectId })
      .update({
        deprecated_at: new Date(),
        path: `${existing.path}__v${oldVersion}`,
      });

    const [newEndpoint] = await this.db('api_endpoints')
      .insert({
        project_id: existing.project_id,
        method: existing.method,
        path: existing.path,
        description: existing.description,
        tags: existing.tags,
        source_type: existing.source_type,
        source_config: typeof existing.source_config === 'string' ? existing.source_config : JSON.stringify(existing.source_config),
        validation_schema: existing.validation_schema ? (typeof existing.validation_schema === 'string' ? existing.validation_schema : JSON.stringify(existing.validation_schema)) : null,
        response_config: existing.response_config ? (typeof existing.response_config === 'string' ? existing.response_config : JSON.stringify(existing.response_config)) : null,
        cache_enabled: existing.cache_enabled,
        cache_ttl: existing.cache_ttl,
        cache_key_template: existing.cache_key_template,
        cache_invalidation: existing.cache_invalidation ? (typeof existing.cache_invalidation === 'string' ? existing.cache_invalidation : JSON.stringify(existing.cache_invalidation)) : null,
        rate_limit: existing.rate_limit ? (typeof existing.rate_limit === 'string' ? existing.rate_limit : JSON.stringify(existing.rate_limit)) : null,
        auth_type: existing.auth_type,
        is_active: true,
        version: (existing.version ?? 1) + 1,
        created_by: existing.created_by,
      })
      .returning('*');

    return newEndpoint;
  }

  async findAll(projectId: string) {
    return this.db('api_endpoints')
      .where({ project_id: projectId })
      .orderBy('created_at', 'desc');
  }

  async findById(id: string, projectId: string) {
    const endpoint = await this.db('api_endpoints')
      .where({ id, project_id: projectId })
      .first();
    if (!endpoint) throw new AppError(404, 'Endpoint not found');
    return endpoint;
  }

  async update(id: string, projectId: string, input: Partial<CreateEndpointInput>) {
    const updateData: Record<string, unknown> = { updated_at: new Date() };

    if (input.method !== undefined) updateData.method = input.method;
    if (input.path !== undefined) updateData.path = input.path;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.tags !== undefined) updateData.tags = input.tags;
    if (input.source_type !== undefined) updateData.source_type = input.source_type;
    if (input.source_config !== undefined) updateData.source_config = JSON.stringify(input.source_config);
    if (input.validation_schema !== undefined) updateData.validation_schema = input.validation_schema ? JSON.stringify(input.validation_schema) : null;
    if (input.response_config !== undefined) updateData.response_config = input.response_config ? JSON.stringify(input.response_config) : null;
    if (input.cache_enabled !== undefined) updateData.cache_enabled = input.cache_enabled;
    if (input.cache_ttl !== undefined) updateData.cache_ttl = input.cache_ttl;
    if (input.cache_key_template !== undefined) updateData.cache_key_template = input.cache_key_template;
    if (input.cache_invalidation !== undefined) updateData.cache_invalidation = input.cache_invalidation ? JSON.stringify(input.cache_invalidation) : null;
    if (input.rate_limit !== undefined) updateData.rate_limit = input.rate_limit ? JSON.stringify(input.rate_limit) : null;
    if (input.auth_type !== undefined) updateData.auth_type = input.auth_type;
    if (input.is_active !== undefined) updateData.is_active = input.is_active;
    if (input.version !== undefined) updateData.version = input.version;
    if (input.rollout !== undefined) updateData.rollout = input.rollout ? JSON.stringify(input.rollout) : null;
    if (input.required_scopes !== undefined) updateData.required_scopes = JSON.stringify(input.required_scopes);
    else if (input.source_type !== undefined || input.source_config !== undefined || input.method !== undefined) {
      // Auto-recompute scopes if source/method changed but caller didn't override them.
      const existing = await this.findById(id, projectId);
      const method = (input.method ?? existing.method) as string;
      const sourceType = (input.source_type ?? existing.source_type) as string;
      const sourceConfig = (input.source_config ?? (typeof existing.source_config === 'string' ? JSON.parse(existing.source_config) : existing.source_config)) as Record<string, unknown>;
      updateData.required_scopes = JSON.stringify(deriveRequiredScopes(sourceType, sourceConfig, method));
    }
    if (input.deprecates !== undefined) {
      updateData.deprecates = input.deprecates ? JSON.stringify(input.deprecates) : null;
      updateData.sunset_at = input.deprecates?.sunset_date ? new Date(input.deprecates.sunset_date) : null;
    }

    const [endpoint] = await this.db('api_endpoints')
      .where({ id, project_id: projectId })
      .update(updateData)
      .returning('*');

    if (!endpoint) throw new AppError(404, 'Endpoint not found');
    return endpoint;
  }

  async delete(id: string, projectId: string) {
    const deleted = await this.db('api_endpoints')
      .where({ id, project_id: projectId })
      .delete();
    if (!deleted) throw new AppError(404, 'Endpoint not found');
    return { deleted: true, endpoint_id: id };
  }

  async toggleActive(id: string, projectId: string) {
    const endpoint = await this.findById(id, projectId);
    return this.update(id, projectId, { is_active: !endpoint.is_active });
  }
}
