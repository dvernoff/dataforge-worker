import type { Knex } from 'knex';
import { AppError } from '../../middleware/error-handler.js';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface PluginManifest {
  id: string;
  name: string;
  description: string;
  version: string;
  runtime: 'worker' | 'control';
  icon: string;
  settings: PluginSettingDef[];
  hooks?: string[];
  auth_types?: string[];
}

export interface PluginSettingDef {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'password' | 'select';
  required?: boolean;
  default?: unknown;
  placeholder?: string;
  options?: { value: string; label: string }[];
}

export interface PluginInstance {
  id: string;
  project_id: string;
  plugin_id: string;
  settings: Record<string, unknown>;
  is_enabled: boolean;
  created_at: string;
}

export class PluginManager {
  private manifests = new Map<string, PluginManifest>();
  private pluginModules = new Map<string, unknown>();

  constructor(private db: Knex) {}

  async loadPlugins() {
    const builtInDir = path.join(__dirname, 'built-in');

    if (!fs.existsSync(builtInDir)) {
      console.log('[PluginManager] No built-in plugins directory found');
      return;
    }

    const dirs = fs.readdirSync(builtInDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    for (const dir of dirs) {
      const manifestPath = path.join(builtInDir, dir, 'manifest.json');
      if (fs.existsSync(manifestPath)) {
        try {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as PluginManifest;
          this.manifests.set(manifest.id, manifest);
        } catch (err) {
          console.error(`[PluginManager] Failed to load manifest for ${dir}:`, err);
        }
      }
    }

    console.log(`[PluginManager] Loaded ${this.manifests.size} plugin manifests`);
  }

  getPlugin(id: string): PluginManifest | undefined {
    return this.manifests.get(id);
  }

  listPlugins(): PluginManifest[] {
    return Array.from(this.manifests.values());
  }

  async listPluginsWithStatus(projectId: string) {
    const manifests = this.listPlugins();
    const instances = await this.db('plugin_instances')
      .where({ project_id: projectId });

    const instanceMap = new Map<string, PluginInstance>();
    for (const inst of instances) {
      instanceMap.set(inst.plugin_id, inst);
    }

    return manifests.map((manifest) => {
      const instance = instanceMap.get(manifest.id);
      return {
        ...manifest,
        // settings = manifest setting definitions (array)
        // saved_settings = instance saved values (object)
        settings: manifest.settings ?? [],
        saved_settings: instance?.settings ?? {},
        is_enabled: instance?.is_enabled ?? false,
        instance_id: instance?.id ?? null,
      };
    });
  }

  async enablePlugin(projectId: string, pluginId: string, settings: Record<string, unknown>) {
    const manifest = this.manifests.get(pluginId);
    if (!manifest) throw new AppError(404, 'Plugin not found');

    // Validate required settings
    for (const settingDef of manifest.settings) {
      if (settingDef.required && (settings[settingDef.key] === undefined || settings[settingDef.key] === '')) {
        throw new AppError(400, `Setting "${settingDef.key}" is required`);
      }
    }

    const existing = await this.db('plugin_instances')
      .where({ project_id: projectId, plugin_id: pluginId })
      .first();

    if (existing) {
      const [updated] = await this.db('plugin_instances')
        .where({ id: existing.id })
        .update({ is_enabled: true, settings: JSON.stringify(settings) })
        .returning('*');
      return updated;
    }

    const [instance] = await this.db('plugin_instances')
      .insert({
        project_id: projectId,
        plugin_id: pluginId,
        settings: JSON.stringify(settings),
        is_enabled: true,
      })
      .returning('*');
    return instance;
  }

  async disablePlugin(projectId: string, pluginId: string) {
    const [instance] = await this.db('plugin_instances')
      .where({ project_id: projectId, plugin_id: pluginId })
      .update({ is_enabled: false })
      .returning('*');
    if (!instance) throw new AppError(404, 'Plugin instance not found');
    return instance;
  }

  async getPluginSettings(projectId: string, pluginId: string) {
    const instance = await this.db('plugin_instances')
      .where({ project_id: projectId, plugin_id: pluginId })
      .first();
    return {
      settings: instance?.settings ?? {},
      is_enabled: instance?.is_enabled ?? false,
    };
  }

  async updatePluginSettings(projectId: string, pluginId: string, settings: Record<string, unknown>) {
    const existing = await this.db('plugin_instances')
      .where({ project_id: projectId, plugin_id: pluginId })
      .first();

    if (!existing) throw new AppError(404, 'Plugin instance not found. Enable the plugin first.');

    const [updated] = await this.db('plugin_instances')
      .where({ id: existing.id })
      .update({ settings: JSON.stringify(settings) })
      .returning('*');
    return updated;
  }

  async getEnabledPluginInstance(projectId: string, pluginId: string): Promise<PluginInstance | null> {
    const instance = await this.db('plugin_instances')
      .where({ project_id: projectId, plugin_id: pluginId, is_enabled: true })
      .first();
    return instance ?? null;
  }
}
