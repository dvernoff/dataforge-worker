import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

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

export class HeartbeatService {
  private intervalId: NodeJS.Timeout | null = null;

  start(cpUrl: string, nodeApiKey: string) {
    this.sendHeartbeat(cpUrl, nodeApiKey);
    this.intervalId = setInterval(() => this.sendHeartbeat(cpUrl, nodeApiKey), 30_000);
  }

  private async sendHeartbeat(cpUrl: string, nodeApiKey: string) {
    const disk = await getDiskInfoAsync();
    const payload = {
      cpu_usage: getCpuUsage(),
      ram_usage: Math.round((1 - os.freemem() / os.totalmem()) * 10000) / 100,
      disk_usage: disk.disk_usage,
      disk_total_gb: disk.disk_total_gb,
      disk_free_gb: disk.disk_free_gb,
      active_connections: 0,
      request_count: 0,
      current_version: process.env.APP_VERSION || 'dev',
    };

    try {
      await fetch(`${cpUrl}/internal/heartbeat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-node-api-key': nodeApiKey,
        },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      console.error('Heartbeat failed:', (err as Error).message);
    }
  }

  stop() {
    if (this.intervalId) clearInterval(this.intervalId);
  }
}

export { getDiskInfo };
