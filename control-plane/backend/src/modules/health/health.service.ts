import type { Knex } from 'knex';
import type Redis from 'ioredis';
import os from 'os';

export interface NodeHealthInfo {
  nodeId: string;
  nodeName: string;
  nodeUrl: string;
  status: string;
  health: Record<string, unknown> | null;
  error?: string;
}

export class HealthService {
  constructor(
    private db: Knex,
    private redis: Redis
  ) {}

  async getNodeHealth(nodeUrl: string): Promise<Record<string, unknown>> {
    const targetUrl = `${nodeUrl.replace(/\/$/, '')}/api/health`;

    const response = await fetch(targetUrl, {
      method: 'GET',
    });

    if (!response.ok) {
      throw new Error(`Worker health check failed with status ${response.status}`);
    }

    return (await response.json()) as Record<string, unknown>;
  }

  async getControlHealth(): Promise<Record<string, unknown>> {
    let dbOk = false;
    let dbLatencyMs = 0;
    try {
      const start = Date.now();
      await this.db.raw('SELECT 1');
      dbLatencyMs = Date.now() - start;
      dbOk = true;
    } catch { /* ignore */ }

    let redisOk = false;
    let redisLatencyMs = 0;
    try {
      const start = Date.now();
      await this.redis.ping();
      redisLatencyMs = Date.now() - start;
      redisOk = true;
    } catch { /* ignore */ }

    const mem = process.memoryUsage();

    return {
      status: dbOk && redisOk ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      hostname: os.hostname(),
      uptime: process.uptime(),
      database: {
        connected: dbOk,
        latency_ms: dbLatencyMs,
      },
      redis: {
        connected: redisOk,
        latency_ms: redisLatencyMs,
      },
      memory: {
        rss_mb: Math.round(mem.rss / 1024 / 1024),
        heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
        heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024),
      },
      cpu_load: os.loadavg(),
      ram_usage: Math.round((1 - os.freemem() / os.totalmem()) * 10000) / 100,
      platform: os.platform(),
      node_version: process.version,
    };
  }

  async getDetailedHealth(): Promise<{
    controlPlane: Record<string, unknown>;
    workers: NodeHealthInfo[];
  }> {
    const controlPlane = await this.getControlHealth();

    // Fetch all nodes
    const nodes = await this.db('nodes').select('*');

    const workers: NodeHealthInfo[] = await Promise.all(
      nodes.map(async (node) => {
        try {
          const health = await this.getNodeHealth(node.url);
          return {
            nodeId: node.id,
            nodeName: node.name,
            nodeUrl: node.url,
            status: node.status,
            health,
          };
        } catch (err) {
          return {
            nodeId: node.id,
            nodeName: node.name,
            nodeUrl: node.url,
            status: node.status,
            health: null,
            error: (err as Error).message,
          };
        }
      })
    );

    return { controlPlane, workers };
  }
}
