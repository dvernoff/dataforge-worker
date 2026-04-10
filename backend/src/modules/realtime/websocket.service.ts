import type { FastifyInstance, FastifyRequest } from 'fastify';
import crypto from 'crypto';
import { isModuleEnabled } from '../../utils/module-check.js';

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
  private connectionCount = new Map<string, number>();
  private messagesSent = new Map<string, number>();
  private messagesReceived = new Map<string, number>();
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

  incrementMessagesSent(projectId: string) {
    this.messagesSent.set(projectId, (this.messagesSent.get(projectId) ?? 0) + 1);
  }

  incrementMessagesReceived(projectId: string) {
    this.messagesReceived.set(projectId, (this.messagesReceived.get(projectId) ?? 0) + 1);
  }

  getStats(projectId: string) {
    let connections = 0;
    for (const subs of this.channels.values()) {
      for (const sub of subs) {
        if (sub.socket.readyState === 1) {
          const channelKey = [...this.channels.entries()].find(([, s]) => s === subs)?.[0] ?? '';
          if (channelKey.includes(projectId)) { connections++; break; }
        }
      }
    }
    return {
      connectedClients: this.connectionCount.get(projectId) ?? connections,
      messagesSent: this.messagesSent.get(projectId) ?? 0,
      messagesReceived: this.messagesReceived.get(projectId) ?? 0,
    };
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
      if (sub.socket.readyState === 1) {
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

    this.broadcast(`project:${projectId}`, message);
    this.broadcast(`table:${projectId}:${tableName}`, message);
    this.incrementMessagesSent(projectId);
  }

  getChannelCount(): number {
    return this.channels.size;
  }

  getSubscriberCount(channel: string): number {
    return this.channels.get(channel)?.size ?? 0;
  }
}

export async function websocketRoutes(app: FastifyInstance) {
  const wsService = WebSocketService.getInstance();

  app.get('/api/projects/:projectId/ws-stats', async (request) => {
    const { projectId } = request.params as { projectId: string };
    return wsService.getStats(projectId);
  });

  app.get('/ws/v1/:projectSlug', { websocket: true } as Record<string, unknown>, async (socket: WebSocket, req: FastifyRequest) => {
    const projectSlug = (req.params as Record<string, string>).projectSlug ?? '';
    const query = (req.query ?? {}) as Record<string, string>;

    const token = query.token ?? '';
    const authHeader = ((req.headers as Record<string, string | undefined>) ?? {}).authorization ?? '';
    const authMode = query.auth_mode ?? 'api_token';

    if (authMode === 'api_token' && !token && !authHeader) {
      socket.send(JSON.stringify({ type: 'error', code: 'AUTH_REQUIRED', message: 'Authentication required. Provide token query param or Authorization header.' }));
      socket.close(4001, 'Auth required');
      return;
    }

    if (authMode === 'api_token') {
      const actualToken = token || authHeader.replace('Bearer ', '');
      if (actualToken) {
        try {
          const tokenHash = crypto.createHash('sha256').update(actualToken).digest('hex');
          const cached = await app.redis.get(`api_token:${tokenHash}`);
          if (!cached) {
            socket.send(JSON.stringify({ type: 'error', code: 'AUTH_FAILED', message: 'Invalid API token for this project.' }));
            socket.close(4001, 'Invalid token');
            return;
          }
          const tokenData = JSON.parse(cached);
          const project = await app.db('projects').where({ slug: projectSlug }).select('id').first();
          if (!project || tokenData.project_id !== project.id) {
            socket.send(JSON.stringify({ type: 'error', code: 'AUTH_FAILED', message: 'API token does not belong to this project.' }));
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

    let projectId = '';
    const project = await app.db('projects').where({ slug: projectSlug }).select('id').first();
    if (project) {
      projectId = project.id;
      const wsEnabled = await isModuleEnabled(app.db, project.id, 'feature-websocket');
      if (!wsEnabled) {
        socket.send(JSON.stringify({ type: 'error', code: 'MODULE_DISABLED', message: 'WebSocket is not enabled for this project.' }));
        socket.close(4003, 'Module disabled');
        return;
      }
    }

    const maxConnections = 100;
    const currentCount = wsService.getProjectConnectionCount(projectSlug);
    if (currentCount >= maxConnections) {
      socket.send(JSON.stringify({ type: 'error', code: 'QUOTA_EXCEEDED', message: `Max WebSocket connections (${maxConnections}) reached for this project.` }));
      socket.close(4002, 'Connection quota exceeded');
      return;
    }

    wsService['incrementProjectConnections'](projectSlug);

    let messageTimestamps: number[] = [];
    const clientChannels = new Set<string>();

    socket.send(JSON.stringify({
      type: 'connected',
      projectSlug,
      timestamp: new Date().toISOString(),
    }));

    socket.on('message', (...args: unknown[]) => {
      const raw = args[0];
      wsService.incrementMessagesReceived(projectId);

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

            const validPattern = /^(table|project):[a-zA-Z0-9_-]+$/;
            if (!validPattern.test(msg.channel)) {
              socket.send(JSON.stringify({ type: 'error', message: 'Invalid channel format. Use table:{name} or project:{slug}' }));
              return;
            }

            if (clientChannels.size >= MAX_CHANNELS_PER_CLIENT) {
              socket.send(JSON.stringify({ type: 'error', message: `Max channels per client (${MAX_CHANNELS_PER_CLIENT}) reached.` }));
              return;
            }

            const fullChannel = `${msg.channel.split(':')[0]}:${projectId}:${msg.channel.split(':')[1]}`;
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

            const fullCh = `${msg.channel.split(':')[0]}:${projectId}:${msg.channel.split(':')[1]}`;
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
      for (const ch of clientChannels) {
        wsService.unsubscribe(ch, socket);
      }
      clientChannels.clear();
    });
  });

}
