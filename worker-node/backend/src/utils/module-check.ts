import type { Knex } from 'knex';

export async function isModuleEnabled(db: Knex, projectId: string, moduleId: string): Promise<boolean> {
  const row = await db('plugin_instances')
    .where({ project_id: projectId, plugin_id: moduleId, is_enabled: true })
    .first();
  return !!row;
}

export function moduleDisabledError(moduleName: string) {
  return { error: `${moduleName} is not enabled for this project`, errorCode: 'MODULE_DISABLED' };
}
