import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { Knex } from 'knex';

const execFileAsync = promisify(execFile);

function getCpuUsage(): number {
  const cpus = os.cpus();
  let totalIdle = 0, totalTick = 0;
  for (const cpu of cpus) {
    for (const type in cpu.times) {
      totalTick += (cpu.times as Record<string, number>)[type];
    }
    totalIdle += cpu.times.idle;
  }
  return Math.round((1 - totalIdle / totalTick) * 10000) / 100;
}

let diskCache: { data: { disk_usage: number; disk_total_gb: number; disk_free_gb: number }; expiry: number } | null = null;

async function getDiskInfoAsync(): Promise<{ disk_usage: number; disk_total_gb: number; disk_free_gb: number }> {
  if (diskCache && diskCache.expiry > Date.now()) return diskCache.data;

  try {
    const { stdout } = await execFileAsync('df', ['-B1', '/']);
    const lines = stdout.trim().split('\n');
    if (lines.length < 2) return { disk_usage: 0, disk_total_gb: 0, disk_free_gb: 0 };

    const parts = lines[1].split(/\s+/);
    const total = parseInt(parts[1], 10);
    const available = parseInt(parts[3], 10);

    if (isNaN(total) || isNaN(available) || total === 0) {
      return { disk_usage: 0, disk_total_gb: 0, disk_free_gb: 0 };
    }

    const used = total - available;
    const toGb = (b: number) => Math.round(b / (1024 ** 3) * 100) / 100;

    const data = {
      disk_usage: Math.round(used / total * 10000) / 100,
      disk_total_gb: toGb(total),
      disk_free_gb: toGb(available),
    };
    diskCache = { data, expiry: Date.now() + 30_000 };
    return data;
  } catch {
    return { disk_usage: 0, disk_total_gb: 0, disk_free_gb: 0 };
  }
}

function getDiskInfo(): { disk_usage: number; disk_total_gb: number; disk_free_gb: number } {
  return diskCache?.data ?? { disk_usage: 0, disk_total_gb: 0, disk_free_gb: 0 };
}

const DB_STATS_TTL = 5 * 60 * 1000;
let dbStatsCache: { data: { db_size_mb: number; db_projects_size_mb: number; db_system_size_mb: number }; expiry: number } | null = null;

const toMb = (bytes: number) => Math.round(bytes / 1024 / 1024 * 100) / 100;

async function getDbStorageStats(db: Knex): Promise<{ db_size_mb: number; db_projects_size_mb: number; db_system_size_mb: number }> {
  if (dbStatsCache && dbStatsCache.expiry > Date.now()) return dbStatsCache.data;

  const zero = { db_size_mb: 0, db_projects_size_mb: 0, db_system_size_mb: 0 };
  try {
    const [totalRes, projectsRes, systemRes] = await Promise.all([
      db.raw(`SELECT pg_database_size(current_database())::bigint AS bytes`),
      db.raw(
        `SELECT COALESCE(SUM(pg_total_relation_size(quote_ident(t.schemaname) || '.' || quote_ident(t.tablename))), 0)::bigint AS bytes
         FROM pg_tables t
         WHERE t.schemaname IN (SELECT db_schema FROM projects)`,
      ),
      db.raw(
        `SELECT COALESCE(SUM(pg_total_relation_size(quote_ident(t.schemaname) || '.' || quote_ident(t.tablename))), 0)::bigint AS bytes
         FROM pg_tables t
         WHERE t.schemaname = 'public'`,
      ),
    ]);

    const data = {
      db_size_mb: toMb(Number(totalRes.rows[0]?.bytes ?? 0)),
      db_projects_size_mb: toMb(Number(projectsRes.rows[0]?.bytes ?? 0)),
      db_system_size_mb: toMb(Number(systemRes.rows[0]?.bytes ?? 0)),
    };
    dbStatsCache = { data, expiry: Date.now() + DB_STATS_TTL };
    return data;
  } catch {
    return zero;
  }
}

export class HeartbeatService {
  private intervalId: NodeJS.Timeout | null = null;
  private db?: Knex;

  constructor(db?: Knex) {
    this.db = db;
  }

  start(cpUrl: string, nodeApiKey: string) {
    console.log(`[Heartbeat] Starting heartbeat to ${cpUrl} every 30s`);
    this.sendHeartbeat(cpUrl, nodeApiKey).catch(() => {});
    this.intervalId = setInterval(() => {
      this.sendHeartbeat(cpUrl, nodeApiKey).catch(() => {});
    }, 30_000);
  }

  private async sendHeartbeat(cpUrl: string, nodeApiKey: string) {
    const disk = await getDiskInfoAsync();
    const dbStats = this.db ? await getDbStorageStats(this.db) : undefined;

    const payload: Record<string, unknown> = {
      cpu_usage: getCpuUsage(),
      ram_usage: Math.round((1 - os.freemem() / os.totalmem()) * 10000) / 100,
      disk_usage: disk.disk_usage,
      disk_total_gb: disk.disk_total_gb,
      disk_free_gb: disk.disk_free_gb,
      active_connections: 0,
      request_count: 0,
      current_version: (process.env.APP_VERSION || 'dev').slice(0, 20),
    };

    if (dbStats) {
      payload.db_size_mb = dbStats.db_size_mb;
      payload.db_projects_size_mb = dbStats.db_projects_size_mb;
      payload.db_system_size_mb = dbStats.db_system_size_mb;
    }

    try {
      const res = await fetch(`${cpUrl}/internal/heartbeat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-node-api-key': nodeApiKey,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        console.error(`[Heartbeat] HTTP ${res.status}: ${await res.text()}`);
      }
    } catch (err) {
      console.error('[Heartbeat] Failed:', (err as Error).message);
    }
  }

  stop() {
    if (this.intervalId) clearInterval(this.intervalId);
  }
}

export { getDiskInfo };
