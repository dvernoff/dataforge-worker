interface DiscordConfig {
  webhook_url: string;
}

interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
  timestamp?: string;
}

export class DiscordWebhookPlugin {
  async sendMessage(
    config: DiscordConfig,
    content: string,
    embeds?: DiscordEmbed[],
    username?: string
  ) {
    if (!config.webhook_url) throw new Error('Webhook URL is not configured');

    const payload: Record<string, unknown> = {};
    if (content) payload.content = content;
    if (embeds?.length) payload.embeds = embeds;
    if (username) payload.username = username;

    const response = await fetch(config.webhook_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Discord webhook error (${response.status}): ${text}`);
    }

    return { success: true, status: response.status };
  }
}
