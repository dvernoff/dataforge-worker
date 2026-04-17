import type { Knex } from 'knex';
import { AppError } from '../../middleware/error-handler.js';
import { validateSchema } from '../../utils/sql-guard.js';
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
        settings: manifest.settings ?? [],
        saved_settings: instance?.settings ?? {},
        is_enabled: instance?.is_enabled ?? false,
        instance_id: instance?.id ?? null,
      };
    });
  }

  async enablePlugin(projectId: string, pluginId: string, settings: Record<string, unknown>) {
    const manifest = this.manifests.get(pluginId);

    if (manifest) {
      for (const settingDef of manifest.settings) {
        if (settingDef.required && (settings[settingDef.key] === undefined || settings[settingDef.key] === '')) {
          throw new AppError(400, `Setting "${settingDef.key}" is required`);
        }
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
      await this.onPluginEnabled(projectId, pluginId);
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

    await this.onPluginEnabled(projectId, pluginId);
    return instance;
  }

  async disablePlugin(projectId: string, pluginId: string) {
    const existing = await this.db('plugin_instances')
      .where({ project_id: projectId, plugin_id: pluginId })
      .first();

    if (existing) {
      const [updated] = await this.db('plugin_instances')
        .where({ id: existing.id })
        .update({ is_enabled: false })
        .returning('*');
      await this.onPluginDisabled(projectId, pluginId);
      return updated;
    }

    const [instance] = await this.db('plugin_instances')
      .insert({
        project_id: projectId,
        plugin_id: pluginId,
        settings: JSON.stringify({}),
        is_enabled: false,
      })
      .returning('*');
    await this.onPluginDisabled(projectId, pluginId);
    return instance;
  }

  private async onPluginEnabled(projectId: string, pluginId: string) {
    if (pluginId === 'ai-rest-gateway' || pluginId === 'ai-mcp-server') {
      try {
        const exists = await this.db.raw(`SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ai_gateway_logs'`);
        if (exists.rows.length === 0) {
          await this.db.raw(`CREATE TABLE IF NOT EXISTS ai_gateway_logs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            project_id UUID NOT NULL,
            gateway_type VARCHAR(20) NOT NULL,
            tool_name VARCHAR(100) NOT NULL,
            request_summary JSONB,
            response_status INTEGER,
            duration_ms INTEGER,
            created_at TIMESTAMPTZ DEFAULT NOW()
          )`);
          await this.db.raw(`CREATE INDEX IF NOT EXISTS idx_ai_gateway_logs_project ON ai_gateway_logs (project_id, created_at)`);
        }
      } catch {}
    }
    if (pluginId === 'uptime-ping') {
      try {
        const project = await this.db('projects').where({ id: projectId }).select('db_schema').first();
        if (project?.db_schema) {
          const schema = project.db_schema;
          validateSchema(schema);
          const exists = await this.db.raw(`SELECT 1 FROM information_schema.tables WHERE table_schema = ? AND table_name = 'uptime_logs'`, [schema]);
          if (exists.rows.length === 0) {
            await this.db.raw(`CREATE TABLE "${schema}".uptime_logs (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
              monitor_id UUID NOT NULL, monitor_name VARCHAR(255), category VARCHAR(100),
              url TEXT, status_code INTEGER, response_time_ms INTEGER,
              is_up BOOLEAN DEFAULT true, error TEXT, reason TEXT,
              checked_at TIMESTAMPTZ DEFAULT NOW()
            )`);
            await this.db.raw(`CREATE INDEX idx_uptime_logs_monitor ON "${schema}".uptime_logs (monitor_id, checked_at)`);
          }
          await this.db.raw(`COMMENT ON TABLE "${schema}".uptime_logs IS 'system:uptime-ping'`).catch(() => {});
        }
      } catch {}
    }
    if (pluginId === 'ai-studio') {
      try {
        const project = await this.db('projects').where({ id: projectId }).select('db_schema').first();
        if (project?.db_schema) {
          const schema = project.db_schema;
          validateSchema(schema);
          const exists = await this.db.raw(`SELECT 1 FROM information_schema.tables WHERE table_schema = ? AND table_name = 'ai_studio_endpoints'`, [schema]);
          if (exists.rows.length === 0) {
            await this.db.raw(`CREATE TABLE "${schema}".ai_studio_endpoints (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
              name VARCHAR(255) NOT NULL,
              slug VARCHAR(255) NOT NULL,
              provider VARCHAR(50) NOT NULL,
              model VARCHAR(100) NOT NULL,
              api_key TEXT,
              system_prompt TEXT,
              response_format JSONB,
              temperature FLOAT DEFAULT 0.7,
              max_tokens INTEGER DEFAULT 1024,
              context_enabled BOOLEAN DEFAULT false,
              context_ttl_minutes INTEGER DEFAULT 60,
              max_context_messages INTEGER DEFAULT 50,
              max_tokens_per_session INTEGER DEFAULT 0,
              validation_rules JSONB,
              retry_on_invalid BOOLEAN DEFAULT false,
              max_retries INTEGER DEFAULT 3,
              is_active BOOLEAN DEFAULT true,
              created_at TIMESTAMPTZ DEFAULT NOW(),
              updated_at TIMESTAMPTZ DEFAULT NOW(),
              UNIQUE(slug)
            )`);
            await this.db.raw(`CREATE TABLE "${schema}".ai_studio_logs (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
              endpoint_id UUID NOT NULL REFERENCES "${schema}".ai_studio_endpoints(id) ON DELETE CASCADE,
              provider VARCHAR(50),
              model VARCHAR(100),
              input_messages JSONB,
              output JSONB,
              tokens_used INTEGER,
              duration_ms INTEGER,
              status VARCHAR(30),
              error TEXT,
              created_at TIMESTAMPTZ DEFAULT NOW()
            )`);
            await this.db.raw(`CREATE INDEX idx_ai_studio_logs_ep ON "${schema}".ai_studio_logs (endpoint_id, created_at)`);
            await this.db.raw(`CREATE TABLE "${schema}".ai_studio_contexts (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
              endpoint_id UUID NOT NULL REFERENCES "${schema}".ai_studio_endpoints(id) ON DELETE CASCADE,
              session_id VARCHAR(255) NOT NULL,
              messages JSONB DEFAULT '[]',
              tokens_used INTEGER DEFAULT 0,
              created_at TIMESTAMPTZ DEFAULT NOW(),
              updated_at TIMESTAMPTZ DEFAULT NOW(),
              UNIQUE(endpoint_id, session_id)
            )`);
          }
          await this.db.raw(`ALTER TABLE "${schema}".ai_studio_endpoints ADD COLUMN IF NOT EXISTS api_key TEXT`).catch(() => {});
          await this.db.raw(`COMMENT ON TABLE "${schema}".ai_studio_endpoints IS 'system:ai-studio'`).catch(() => {});
          await this.db.raw(`COMMENT ON TABLE "${schema}".ai_studio_logs IS 'system:ai-studio'`).catch(() => {});
          await this.db.raw(`COMMENT ON TABLE "${schema}".ai_studio_contexts IS 'system:ai-studio'`).catch(() => {});
        }
      } catch {}
    }
  }

  private async onPluginDisabled(projectId: string, pluginId: string) {
    if (pluginId === 'ai-studio') {
      try {
        const project = await this.db('projects').where({ id: projectId }).select('db_schema').first();
        if (project?.db_schema) {
          await this.db.raw(`DROP TABLE IF EXISTS "${project.db_schema}".ai_studio_contexts CASCADE`);
          await this.db.raw(`DROP TABLE IF EXISTS "${project.db_schema}".ai_studio_logs CASCADE`);
          await this.db.raw(`DROP TABLE IF EXISTS "${project.db_schema}".ai_studio_endpoints CASCADE`);
        }
      } catch {}
    }
    if (pluginId === 'uptime-ping') {
      try {
        const project = await this.db('projects').where({ id: projectId }).select('db_schema').first();
        if (project?.db_schema) {
          await this.db.raw(`DROP TABLE IF EXISTS "${project.db_schema}".uptime_logs CASCADE`);
        }
      } catch {}
    }
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
