import type { Knex } from 'knex';
import type Redis from 'ioredis';
import { env } from '../../config/env.js';
import { decrypt } from '../../utils/encryption.js';

interface WorkerInfo {
  url: string;
  apiKey: string;
  schema: string;
}

const NODE_MAP_TTL = 300; // 5 minutes

export class ProxyService {
  constructor(
    private db: Knex,
    private redis: Redis
  ) {}

  async getWorkerForProject(projectId: string): Promise<WorkerInfo> {
    const cacheKey = `node-map:${projectId}`;

    // Check Redis cache first
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as WorkerInfo;
    }

    // Query database — project must have an assigned node
    const row = await this.db('projects as p')
      .join('nodes as n', 'p.node_id', 'n.id')
      .where('p.id', projectId)
      .select('n.url', 'n.api_key_encrypted', 'p.db_schema')
      .first();

    if (!row) {
      const project = await this.db('projects').where('id', projectId).first();
      if (!project) {
        throw Object.assign(new Error('Project not found'), { statusCode: 404 });
      }
      throw Object.assign(new Error('Project has no assigned worker node. Add a node and assign it to this project.'), { statusCode: 503 });
    }

    // Use per-node encrypted API key if available, fall back to shared env key
    let apiKey = env.WORKER_NODE_API_KEY;
    if (row.api_key_encrypted) {
      try {
        apiKey = decrypt(row.api_key_encrypted);
      } catch {
        // Fall back to shared key if decryption fails
      }
    }

    const workerInfo: WorkerInfo = {
      url: row.url,
      apiKey,
      schema: row.db_schema,
    };

    // Cache the result
    await this.redis.set(cacheKey, JSON.stringify(workerInfo), 'EX', NODE_MAP_TTL);

    return workerInfo;
  }

  async forwardToWorker(
    workerUrl: string,
    apiKey: string,
    method: string,
    path: string,
    headers: Record<string, string>,
    body: unknown,
    projectId: string,
    schema: string
  ): Promise<{ status: number; headers: Record<string, string>; body: unknown }> {
    const targetUrl = `${workerUrl.replace(/\/$/, '')}${path}`;

    const upperMethod = method.toUpperCase();
    const hasBody = body && upperMethod !== 'GET' && upperMethod !== 'HEAD' && upperMethod !== 'DELETE';

    const outboundHeaders: Record<string, string> = {
      'x-node-api-key': apiKey,
      'x-project-id': projectId,
      'x-project-schema': schema,
    };

    // Only set content-type when there is a body to send
    if (hasBody) {
      outboundHeaders['content-type'] = headers['content-type'] ?? 'application/json';
    }

    // Forward user identity, project context, and quota headers if present
    const forwardPrefixes = ['x-user-', 'x-project-', 'x-node-', 'x-quota-'];
    for (const [key, val] of Object.entries(headers)) {
      if (forwardPrefixes.some(p => key.startsWith(p))) {
        outboundHeaders[key] = val;
      }
    }

    const fetchOptions: RequestInit = {
      method: upperMethod,
      headers: outboundHeaders,
    };

    if (hasBody) {
      fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    const response = await fetch(targetUrl, fetchOptions);

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    let responseBody: unknown;
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      responseBody = await response.json();
    } else {
      responseBody = await response.text();
    }

    return {
      status: response.status,
      headers: responseHeaders,
      body: responseBody,
    };
  }
}
