import * as fs from 'fs';
import * as path from 'path';

interface LocalStorageConfig {
  base_path: string;
}

export class LocalStoragePlugin {
  private ensureDir(dirPath: string) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  async upload(config: LocalStorageConfig, filePath: string, body: Buffer | string) {
    const fullPath = path.resolve(config.base_path, filePath);
    const dir = path.dirname(fullPath);

    const resolvedBase = path.resolve(config.base_path);
    if (!fullPath.startsWith(resolvedBase)) {
      throw new Error('Path traversal not allowed');
    }

    this.ensureDir(dir);
    fs.writeFileSync(fullPath, typeof body === 'string' ? Buffer.from(body) : body);

    return { path: filePath, size: Buffer.byteLength(body) };
  }

  async download(config: LocalStorageConfig, filePath: string) {
    const fullPath = path.resolve(config.base_path, filePath);
    const resolvedBase = path.resolve(config.base_path);

    if (!fullPath.startsWith(resolvedBase)) {
      throw new Error('Path traversal not allowed');
    }

    if (!fs.existsSync(fullPath)) {
      throw new Error('File not found');
    }

    const body = fs.readFileSync(fullPath);
    const stats = fs.statSync(fullPath);

    return { body, size: stats.size };
  }

  async delete(config: LocalStorageConfig, filePath: string) {
    const fullPath = path.resolve(config.base_path, filePath);
    const resolvedBase = path.resolve(config.base_path);

    if (!fullPath.startsWith(resolvedBase)) {
      throw new Error('Path traversal not allowed');
    }

    if (!fs.existsSync(fullPath)) {
      throw new Error('File not found');
    }

    fs.unlinkSync(fullPath);
    return { deleted: true, path: filePath };
  }

  async list(config: LocalStorageConfig, dirPath = '') {
    const fullPath = path.resolve(config.base_path, dirPath);
    const resolvedBase = path.resolve(config.base_path);

    if (!fullPath.startsWith(resolvedBase)) {
      throw new Error('Path traversal not allowed');
    }

    if (!fs.existsSync(fullPath)) {
      return { files: [] };
    }

    const entries = fs.readdirSync(fullPath, { withFileTypes: true });
    const files = entries.map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
      path: path.join(dirPath, entry.name),
    }));

    return { files };
  }
}
