import type { Knex } from 'knex';

export interface CommentInput {
  project_id: string;
  table_name: string;
  record_id: string;
  user_id: string;
  user_name: string;
  content: string;
}

export class CommentsService {
  constructor(private db: Knex) {}

  async list(projectId: string, tableName: string, recordId: string) {
    return this.db('record_comments')
      .where({ project_id: projectId, table_name: tableName, record_id: recordId })
      .orderBy('created_at', 'asc');
  }

  async create(input: CommentInput) {
    const [comment] = await this.db('record_comments')
      .insert(input)
      .returning('*');
    return comment;
  }

  async delete(id: string) {
    await this.db('record_comments').where({ id }).delete();
  }

  async getCount(projectId: string, tableName: string, recordId: string): Promise<number> {
    const result = await this.db('record_comments')
      .where({ project_id: projectId, table_name: tableName, record_id: recordId })
      .count('id as count')
      .first();
    return Number(result?.count ?? 0);
  }

  async getCounts(projectId: string, tableName: string): Promise<Record<string, number>> {
    const rows = await this.db('record_comments')
      .where({ project_id: projectId, table_name: tableName })
      .groupBy('record_id')
      .select('record_id')
      .count('id as count');
    const counts: Record<string, number> = {};
    for (const row of rows) {
      counts[row.record_id] = Number(row.count);
    }
    return counts;
  }
}
