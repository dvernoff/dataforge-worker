import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface PluginManifest {
  id: string;
  name: string;
  version: string;
  runtime: string;
  description: string;
  icon: string;
  type?: string;
  settings?: unknown[];
}

async function loadBuiltInManifests(): Promise<PluginManifest[]> {
  const builtInDir = join(__dirname, 'built-in');
  const manifests: PluginManifest[] = [];

  try {
    const entries = await readdir(builtInDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const manifestPath = join(builtInDir, entry.name, 'manifest.json');
        const raw = await readFile(manifestPath, 'utf-8');
        const manifest = JSON.parse(raw) as PluginManifest;
        manifests.push(manifest);
      } catch {
        // Skip plugins without valid manifests
      }
    }
  } catch {
    // built-in directory may not exist
  }

  return manifests;
}

export async function cpPluginsRoutes(app: FastifyInstance) {
  // GET /api/cp-plugins — list all control-plane built-in plugins
  app.get('/', { preHandler: [authMiddleware] }, async () => {
    const manifests = await loadBuiltInManifests();
    return { plugins: manifests };
  });
}
