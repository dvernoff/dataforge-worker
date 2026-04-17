import type { Knex } from 'knex';
import crypto from 'crypto';
import { safeFetch } from '../../utils/safe-fetch.js';

interface WebhookDef {
  id: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  secret: string | null;
  retry_count: number;
}

export class WebhookDispatcher {
  constructor(private db: Knex) {}

  async dispatch(webhook: WebhookDef, event: string, payload: Record<string, unknown>) {
    const maxRetries = webhook.retry_count;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      const start = Date.now();
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          ...webhook.headers,
        };

        if (webhook.secret) {
          const signature = crypto
            .createHmac('sha256', webhook.secret)
            .update(JSON.stringify(payload))
            .digest('hex');
          headers['X-Webhook-Signature'] = `sha256=${signature}`;
        }

        headers['X-Webhook-Event'] = event;

        const response = await safeFetch(webhook.url, {
          method: webhook.method,
          headers,
          body: JSON.stringify(payload),
        });

        const duration = Date.now() - start;
        const responseBody = await response.text().catch(() => '');

        await this.logAttempt(webhook.id, event, payload, response.status, responseBody, attempt, duration);

        if (response.ok) return;

        if (response.status >= 400 && response.status < 500) return;

      } catch (err) {
        const duration = Date.now() - start;
        await this.logAttempt(webhook.id, event, payload, 0, (err as Error).message, attempt, duration);
      }

      if (attempt <= maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }
  }

  private async logAttempt(
    webhookId: string,
    event: string,
    payload: Record<string, unknown>,
    responseStatus: number,
    responseBody: string,
    attempt: number,
    durationMs: number,
  ) {
    await this.db('webhook_logs').insert({
      webhook_id: webhookId,
      event,
      payload: JSON.stringify(payload),
      response_status: responseStatus,
      response_body: responseBody,
      attempt,
      duration_ms: durationMs,
    });
  }
}
