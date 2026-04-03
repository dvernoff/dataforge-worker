// Worker Node request context — attached by nodeAuthMiddleware
declare module 'fastify' {
  interface FastifyRequest {
    projectId: string;
    projectSchema: string;
    userId: string;
    userRole: string;
    isSharedNode: boolean;
    quotas: {
      queryTimeout: number;
      concurrent: number;
      maxRows: number;
      maxExport: number;
    };
  }
}

// Type declarations for optional dependencies not in package.json

declare module '@fastify/websocket' {
  import type { FastifyPluginCallback } from 'fastify';
  const plugin: FastifyPluginCallback;
  export default plugin;
}

declare module 'ws' {
  export interface WebSocket {
    readyState: number;
    send(data: string | Buffer): void;
    close(code?: number, reason?: string): void;
    on(event: string, listener: (...args: unknown[]) => void): void;
  }
}

declare module 'graphql' {
  export function graphql(args: Record<string, unknown>): Promise<unknown>;
  export function buildSchema(source: string): unknown;
}

declare module 'node-cron' {
  interface ScheduledTask {
    start(): void;
    stop(): void;
  }

  function schedule(expression: string, func: () => void): ScheduledTask;
  function validate(expression: string): boolean;

  export { ScheduledTask, schedule, validate };
  export default { schedule, validate };
}

declare module 'nodemailer' {
  interface TransportOptions {
    host: string;
    port: number;
    secure: boolean;
    auth: { user: string; pass: string };
  }

  interface MailOptions {
    from: string;
    to: string;
    subject: string;
    text: string;
    html?: string;
  }

  interface SentMessageInfo {
    messageId: string;
    accepted: string[];
    rejected: string[];
  }

  interface Transporter {
    sendMail(options: MailOptions): Promise<SentMessageInfo>;
  }

  function createTransport(options: TransportOptions): Transporter;
  export default { createTransport };
}

declare module '@aws-sdk/client-s3' {
  export class S3Client {
    constructor(config: Record<string, unknown>);
    send(command: unknown): Promise<Record<string, unknown>>;
  }
  export class PutObjectCommand {
    constructor(input: Record<string, unknown>);
  }
  export class GetObjectCommand {
    constructor(input: Record<string, unknown>);
  }
  export class DeleteObjectCommand {
    constructor(input: Record<string, unknown>);
  }
}

declare module '@aws-sdk/s3-request-presigner' {
  export function getSignedUrl(
    client: unknown,
    command: unknown,
    options?: { expiresIn?: number }
  ): Promise<string>;
}

declare module '@anthropic-ai/sdk' {
  interface TextBlock {
    type: 'text';
    text: string;
  }

  interface ContentBlock {
    type: string;
    text?: string;
  }

  interface Message {
    content: ContentBlock[];
  }

  interface MessageCreateParams {
    model: string;
    max_tokens: number;
    system?: string;
    messages: Array<{ role: string; content: string }>;
  }

  interface Messages {
    create(params: MessageCreateParams): Promise<Message>;
  }

  class Anthropic {
    messages: Messages;
    constructor(config: { apiKey: string });
  }

  export default Anthropic;
}
