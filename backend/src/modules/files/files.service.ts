import type { Knex } from 'knex';
import { AppError } from '../../middleware/error-handler.js';
import * as fs from 'fs';
import { promises as fsPromises } from 'fs';
import * as path from 'path';

export interface FileRecord {
  id: string;
  project_id: string;
  table_name: string;
  record_id: string;
  column_name: string;
  original_name: string;
  mime_type: string;
  size: number;
  storage_path: string;
  created_at: string;
}

export class FilesService {
  private baseDir: string;

  constructor(private db: Knex, baseDir?: string) {
    this.baseDir = baseDir ?? path.resolve('./uploads');
  }

  private static BLOCKED_EXTENSIONS = ['.exe', '.sh', '.bat', '.cmd', '.php', '.jsp', '.asp', '.cgi', '.pl'];

  async upload(
    projectId: string,
    tableName: string,
    recordId: string,
    columnName: string,
    file: { filename: string; mimetype: string; data: Buffer }
  ): Promise<FileRecord> {
    const fileExt = path.extname(file.filename).toLowerCase();
    if (FilesService.BLOCKED_EXTENSIONS.includes(fileExt)) {
      throw new AppError(400, 'File type not allowed');
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(tableName) || !/^[a-zA-Z0-9_-]+$/.test(String(recordId))) {
      throw new AppError(400, 'Invalid path parameters');
    }

    const dir = path.join(this.baseDir, projectId, tableName, recordId);
    const resolvedDir = path.resolve(dir);
    const resolvedBase = path.resolve(this.baseDir);

    if (!resolvedDir.startsWith(resolvedBase)) {
      throw new AppError(400, 'Invalid path');
    }

    await fsPromises.mkdir(dir, { recursive: true });

    const ext = path.extname(file.filename);
    const storageName = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}${ext}`;
    const storagePath = path.join(dir, storageName);

    await fsPromises.writeFile(storagePath, file.data);

    const [record] = await this.db('files')
      .insert({
        project_id: projectId,
        table_name: tableName,
        record_id: recordId,
        column_name: columnName,
        original_name: file.filename,
        mime_type: file.mimetype,
        size: file.data.length,
        storage_path: storagePath,
      })
      .returning('*');

    return record;
  }

  async download(projectId: string, fileId: string): Promise<{ record: FileRecord; data: Buffer }> {
    const record = await this.db('files')
      .where({ id: fileId, project_id: projectId })
      .first();

    if (!record) {
      throw new AppError(404, 'File not found');
    }

    try {
      await fsPromises.access(record.storage_path);
    } catch {
      throw new AppError(404, 'File data not found on disk');
    }

    const data = await fsPromises.readFile(record.storage_path);
    return { record, data };
  }

  async delete(projectId: string, fileId: string): Promise<void> {
    const record = await this.db('files')
      .where({ id: fileId, project_id: projectId })
      .first();

    if (!record) {
      throw new AppError(404, 'File not found');
    }

    try { await fsPromises.unlink(record.storage_path); } catch {}

    await this.db('files').where({ id: fileId }).delete();
  }

  async listForRecord(
    projectId: string,
    tableName: string,
    recordId: string
  ): Promise<FileRecord[]> {
    return this.db('files')
      .where({ project_id: projectId, table_name: tableName, record_id: recordId })
      .orderBy('created_at', 'desc');
  }
}
