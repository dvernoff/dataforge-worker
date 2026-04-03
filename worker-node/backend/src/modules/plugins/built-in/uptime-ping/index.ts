interface UptimePingConfig {
  ping_url: string;
  interval_seconds: number;
}

interface PingResult {
  url: string;
  status: number | null;
  responseTime: number;
  ok: boolean;
  error?: string;
  timestamp: string;
}

export class UptimePingPlugin {
  private timers = new Map<string, ReturnType<typeof setInterval>>();

  async ping(config: UptimePingConfig): Promise<PingResult> {
    const start = Date.now();
    try {
      const response = await fetch(config.ping_url, {
        method: 'GET',
        signal: AbortSignal.timeout(10000), // 10s timeout
      });

      return {
        url: config.ping_url,
        status: response.status,
        responseTime: Date.now() - start,
        ok: response.ok,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      return {
        url: config.ping_url,
        status: null,
        responseTime: Date.now() - start,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
      };
    }
  }

  startMonitoring(projectId: string, config: UptimePingConfig, callback: (result: PingResult) => void) {
    const key = `${projectId}:${config.ping_url}`;
    this.stopMonitoring(projectId, config.ping_url);

    const intervalMs = (config.interval_seconds || 60) * 1000;
    const timer = setInterval(async () => {
      const result = await this.ping(config);
      callback(result);
    }, intervalMs);

    this.timers.set(key, timer);

    // Do an immediate first ping
    this.ping(config).then(callback);
  }

  stopMonitoring(projectId: string, pingUrl: string) {
    const key = `${projectId}:${pingUrl}`;
    const timer = this.timers.get(key);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(key);
    }
  }

  stopAll() {
    for (const timer of this.timers.values()) {
      clearInterval(timer);
    }
    this.timers.clear();
  }
}
