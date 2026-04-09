import type { Knex } from 'knex';

const DEFAULT_FEATURES = new Set(['feature-cron', 'feature-backups', 'feature-analytics']);

export async function isModuleEnabled(db: Knex, projectId: string, moduleId: string): Promise<boolean> {
  const row = await db('plugin_instances')
    .where({ project_id: projectId, plugin_id: moduleId })
    .first();
  if (row) return !!row.is_enabled;
  return DEFAULT_FEATURES.has(moduleId);
}

export function moduleDisabledError(moduleName: string) {
  return { error: `${moduleName} is not enabled for this project`, errorCode: 'MODULE_DISABLED' };
}
