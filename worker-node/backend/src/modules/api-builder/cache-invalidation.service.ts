import type { Knex } from 'knex';
import { CacheService } from './cache.service.js';

type MutationEvent = 'insert' | 'update' | 'delete';

export class CacheInvalidationService {
  constructor(
    private db: Knex,
    private cacheService: CacheService,
  ) {}

  async onDataChange(projectId: string, tableName: string, event: MutationEvent): Promise<void> {
    const eventKey = `on_${event}`;

    try {
      const endpoints = await this.db('api_endpoints')
        .where({
          project_id: projectId,
          cache_enabled: true,
          is_active: true,
        })
        .whereNotNull('cache_invalidation')
        .whereRaw(`cache_invalidation->>'${eventKey}' = 'true'`)
        .whereRaw(`source_config->>'table' = ?`, [tableName])
        .select('id');

      if (endpoints.length === 0) return;

      const project = await this.db('projects')
        .where({ id: projectId })
        .select('slug')
        .first();

      if (!project) return;

      await Promise.all(
        endpoints.map((ep) => this.cacheService.invalidateByEndpoint(project.slug, ep.id))
      );
    } catch {
    }
  }
}
