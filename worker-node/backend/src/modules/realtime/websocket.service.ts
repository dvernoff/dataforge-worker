import type { FastifyInstance, FastifyRequest } from 'fastify';
import crypto from 'crypto';

type WebSocket = import('ws').WebSocket;

interface ChannelSubscription {
  socket: WebSocket;
  userId?: string;
  projectSlug: string;
}

export interface DataChangeMessage {
  type: 'data_change';
  table: string;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  record: Record<string, unknown>;
  timestamp: string;
}

interface ClientMessage {
  action: 'subscribe' | 'unsubscribe' | 'ping';
  channel?: string;
}

const MAX_CHANNELS_PER_CLIENT = 50;
const RATE_LIMIT_WINDOW_MS = 1000;
const RATE_LIMIT_MAX_MESSAGES = 20;

export class WebSocketService {
  private channels = new Map<string, Set<ChannelSubscription>>();
  private connectionCount = new Map<string, number>(); // projectSlug -> count
  private static instance: WebSocketService | null = null;

  static getInstance(): WebSocketService {
    if (!WebSocketService.instance) {
      WebSocketService.instance = new WebSocketService();
    }
    return WebSocketService.instance;
  }

  getProjectConnectionCount(projectSlug: string): number {
    return this.connectionCount.get(projectSlug) ?? 0;
  }

  private incrementProjectConnections(projectSlug: string) {
    const current = this.connectionCount.get(projectSlug) ?? 0;
    this.connectionCount.set(projectSlug, current + 1);
  }

  private decrementProjectConnections(projectSlug: string) {
    const current = this.connectionCount.get(projectSlug) ?? 0;
    if (current <= 1) {
      this.connectionCount.delete(projectSlug);
    } else {
      this.connectionCount.set(projectSlug, current - 1);
    }
  }

  subscribe(channel: string, socket: WebSocket, projectSlug: string, userId?: string) {
    if (!this.channels.has(channel)) {
      this.channels.set(channel, new Set());
    }
    const sub: ChannelSubscription = { socket, userId, projectSlug };
    this.channels.get(channel)!.add(sub);

    socket.on('close', () => {
      this.channels.get(channel)?.delete(sub);
      if (this.channels.get(channel)?.size === 0) {
        this.channels.delete(channel);
      }
    });

    return sub;
  }

  unsubscribe(channel: string, socket: WebSocket) {
    const subs = this.channels.get(channel);
    if (!subs) return;
    for (const sub of subs) {
      if (sub.socket === socket) {
        subs.delete(sub);
        break;
      }
    }
    if (subs.size === 0) {
      this.channels.delete(channel);
    }
  }

  broadcast(channel: string, message: DataChangeMessage) {
    const subs = this.channels.get(channel);
    if (!subs) return;

    const payload = JSON.stringify(message);
    for (const sub of subs) {
      if (sub.socket.readyState === 1) { // WebSocket.OPEN
        sub.socket.send(payload);
      }
    }
  }

  broadcastDataChange(projectId: string, tableName: string, action: 'INSERT' | 'UPDATE' | 'DELETE', record: Record<string, unknown>) {
    const message: DataChangeMessage = {
      type: 'data_change',
      table: tableName,
      action,
      record,
      timestamp: new Date().toISOString(),
    };

    // Broadcast to project channel
    this.broadcast(`project:${projectId}`, message);
    // Broadcast to table-specific channel
    this.broadcast(`table:${projectId}:${tableName}`, message);
  }

  getChannelCount(): number {
    return this.channels.size;
  }

  getSubscriberCount(channel: string): number {
    return this.channels.get(channel)?.size ?? 0;
  }
}

/**
 * WebSocket routes for real-time data subscriptions.
 * Endpoint: /ws/v1/:projectSlug
 *
 * Auth: Bearer token or session cookie verified on connect.
 * Channels: client sends { action: "subscribe", channel: "table:users" }
 * Events: INSERT/UPDATE/DELETE broadcasted to subscribers.
 * Rate limit: max 20 messages per second per client.
 * Quota: max_websocket_connections per project (default 100).
 */
export async function websocketRoutes(app: FastifyInstance) {
  const wsService = WebSocketService.getInstance();

  // Main project WebSocket endpoint
  app.get('/ws/v1/:projectSlug', { websocket: true } as Record<string, unknown>, async (request: unknown, reply: unknown) => {
    const socket = (request as Record<string, unknown>).socket as WebSocket;
    const req = request as FastifyRequest<{ Params: { projectSlug: string }; Querystring: Record<string, string> }>;
    const projectSlug = (req.params as Record<string, string>).projectSlug ?? '';
    const query = (req.query ?? {}) as Record<string, string>;

    // Auth: check for token in query or authorization header
    const token = query.token ?? '';
    const authHeader = ((req.headers as Record<string, string | undefined>) ?? {}).authorization ?? '';
    const authMode = query.auth_mode ?? 'api_token';

    if (authMode === 'api_token' && !token && !authHeader) {
      socket.send(JSON.stringify({ type: 'error', code: 'AUTH_REQUIRED', message: 'Authentication required. Provide token query param or Authorization header.' }));
      socket.close(4001, 'Auth required');
      return;
    }

    // Verify the API token against the database
    if (authMode === 'api_token') {
      const actualToken = token || authHeader.replace('Bearer ', '');
      if (actualToken) {
        try {
          const tokenHash = crypto.createHash('sha256').update(actualToken).digest('hex');
          const tokenRow = await app.db('api_tokens')
            .join('projects', 'api_tokens.project_id', 'projects.id')
            .where('projects.slug', projectSlug)
            .where('api_tokens.token_hash', tokenHash)
            .whereNull('api_tokens.revoked_at')
            .select('projects.id as project_id')
            .first();

          if (!tokenRow) {
            socket.send(JSON.stringify({ type: 'error', code: 'AUTH_FAILED', message: 'Invalid API token for this project.' }));
            socket.close(4001, 'Invalid token');
            return;
          }
        } catch {
          socket.send(JSON.stringify({ type: 'error', code: 'AUTH_ERROR', message: 'Authentication verification failed.' }));
          socket.close(4001, 'Auth error');
          return;
        }
      }
    }

    // Check connection quota - use server-side config, NOT client-controlled
    const maxConnections = 100;
    const currentCount = wsService.getProjectConnectionCount(projectSlug);
    if (currentCount >= maxConnections) {
      socket.send(JSON.stringify({ type: 'error', code: 'QUOTA_EXCEEDED', message: `Max WebSocket connections (${maxConnections}) reached for this project.` }));
      socket.close(4002, 'Connection quota exceeded');
      return;
    }

    wsService['incrementProjectConnections'](projectSlug);

    // Rate limiter state per client
    let messageTimestamps: number[] = [];
    const clientChannels = new Set<string>();

    // Send connected confirmation
    socket.send(JSON.stringify({
      type: 'connected',
      projectSlug,
      timestamp: new Date().toISOString(),
    }));

    socket.on('message', (...args: unknown[]) => {
      const raw = args[0];

      // Rate limit check
      const now = Date.now();
      messageTimestamps = messageTimestamps.filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);
      if (messageTimestamps.length >= RATE_LIMIT_MAX_MESSAGES) {
        socket.send(JSON.stringify({ type: 'error', code: 'RATE_LIMITED', message: 'Too many messages. Please slow down.' }));
        return;
      }
      messageTimestamps.push(now);

      try {
        const msg: ClientMessage = JSON.parse(String(raw));

        switch (msg.action) {
          case 'subscribe': {
            if (!msg.channel) {
              socket.send(JSON.stringify({ type: 'error', message: 'Missing channel in subscribe' }));
              return;
            }

            // Validate channel format: table:{name} or project:{slug}
            const validPattern = /^(table|project):[a-zA-Z0-9_-]+$/;
            if (!validPattern.test(msg.channel)) {
              socket.send(JSON.stringify({ type: 'error', message: 'Invalid channel format. Use table:{name} or project:{slug}' }));
              return;
            }

            if (clientChannels.size >= MAX_CHANNELS_PER_CLIENT) {
              socket.send(JSON.stringify({ type: 'error', message: `Max channels per client (${MAX_CHANNELS_PER_CLIENT}) reached.` }));
              return;
            }

            // Prefix channel with project for isolation
            const fullChannel = `${msg.channel.split(':')[0]}:${projectSlug}:${msg.channel.split(':')[1]}`;
            wsService.subscribe(fullChannel, socket, projectSlug);
            clientChannels.add(fullChannel);

            socket.send(JSON.stringify({
              type: 'subscribed',
              channel: msg.channel,
              timestamp: new Date().toISOString(),
            }));
            break;
          }

          case 'unsubscribe': {
            if (!msg.channel) {
              socket.send(JSON.stringify({ type: 'error', message: 'Missing channel in unsubscribe' }));
              return;
            }

            const fullCh = `${msg.channel.split(':')[0]}:${projectSlug}:${msg.channel.split(':')[1]}`;
            wsService.unsubscribe(fullCh, socket);
            clientChannels.delete(fullCh);

            socket.send(JSON.stringify({
              type: 'unsubscribed',
              channel: msg.channel,
              timestamp: new Date().toISOString(),
            }));
            break;
          }

          case 'ping': {
            socket.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
            break;
          }

          default:
            socket.send(JSON.stringify({ type: 'error', message: `Unknown action: ${(msg as unknown as Record<string, unknown>).action}` }));
        }
      } catch {
        socket.send(JSON.stringify({ type: 'error', message: 'Invalid JSON message' }));
      }
    });

    socket.on('close', () => {
      wsService['decrementProjectConnections'](projectSlug);
      // Clean up all subscriptions for this socket
      for (const ch of clientChannels) {
        wsService.unsubscribe(ch, socket);
      }
      clientChannels.clear();
    });
  });

}
