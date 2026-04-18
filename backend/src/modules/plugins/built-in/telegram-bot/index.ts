const TELEGRAM_API = 'https://api.telegram.org/bot';

interface TelegramConfig {
  bot_token: string;
  default_chat_id?: string;
}

export class TelegramBotPlugin {
  async sendMessage(config: TelegramConfig, chatId: string | undefined, text: string) {
    const targetChatId = chatId ?? config.default_chat_id;
    if (!targetChatId) throw new Error('Chat ID is required');
    if (!config.bot_token) throw new Error('Bot token is not configured');

    const url = `${TELEGRAM_API}${config.bot_token}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: targetChatId,
        text,
        parse_mode: 'HTML',
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Telegram API error: ${err}`);
    }

    return response.json();
  }
}
