import type { Knex } from 'knex';
import { AppError } from '../../middleware/error-handler.js';
import * as fs from 'fs';
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
    // Validate file extension
    const fileExt = path.extname(file.filename).toLowerCase();
    if (FilesService.BLOCKED_EXTENSIONS.includes(fileExt)) {
      throw new AppError(400, 'File type not allowed');
    }

    // Validate path parameters to prevent path traversal
    if (!/^[a-zA-Z0-9_-]+$/.test(tableName) || !/^[a-zA-Z0-9_-]+$/.test(String(recordId))) {
      throw new AppError(400, 'Invalid path parameters');
    }

    // Create directory structure
    const dir = path.join(this.baseDir, projectId, tableName, recordId);
    const resolvedDir = path.resolve(dir);
    const resolvedBase = path.resolve(this.baseDir);

    // Verify the resolved path is still under baseDir
    if (!resolvedDir.startsWith(resolvedBase)) {
      throw new AppError(400, 'Invalid path');
    }

    fs.mkdirSync(dir, { recursive: true });

    // Generate unique filename
    const ext = path.extname(file.filename);
    const storageName = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}${ext}`;
    const storagePath = path.join(dir, storageName);

    // Write file to disk
    fs.writeFileSync(storagePath, file.data);

    // Save metadata to DB
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

    if (!fs.existsSync(record.storage_path)) {
      throw new AppError(404, 'File data not found on disk');
    }

    const data = fs.readFileSync(record.storage_path);
    return { record, data };
  }

  async delete(projectId: string, fileId: string): Promise<void> {
    const record = await this.db('files')
      .where({ id: fileId, project_id: projectId })
      .first();

    if (!record) {
      throw new AppError(404, 'File not found');
    }

    // Remove from disk
    if (fs.existsSync(record.storage_path)) {
      fs.unlinkSync(record.storage_path);
    }

    // Remove from DB
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
