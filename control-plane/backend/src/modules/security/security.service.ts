import type { Knex } from 'knex';

export interface SecurityInput {
  ip_whitelist?: string[];
  ip_blacklist?: string[];
  ip_mode?: string;
  geo_countries?: string[];
  geo_mode?: string;
  apply_to_ui?: boolean;
  apply_to_api?: boolean;
}

export class SecurityService {
  constructor(private db: Knex) {}

  async getProjectSecurity(projectId: string) {
    let row = await this.db('project_security').where({ project_id: projectId }).first();
    if (!row) {
      [row] = await this.db('project_security')
        .insert({ project_id: projectId })
        .returning('*');
    }
    return row;
  }

  async updateProjectSecurity(projectId: string, input: SecurityInput) {
    const existing = await this.db('project_security').where({ project_id: projectId }).first();

    if (existing) {
      const [updated] = await this.db('project_security')
        .where({ project_id: projectId })
        .update({ ...input, updated_at: new Date() })
        .returning('*');
      return updated;
    }

    const [created] = await this.db('project_security')
      .insert({ project_id: projectId, ...input })
      .returning('*');
    return created;
  }
}
