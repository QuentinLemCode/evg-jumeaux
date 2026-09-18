/**
 * The Telegram Bot API, only the four calls the gateway makes (spec 0012).
 *
 * Long polling rather than webhooks: the agents VM publishes no inbound port
 * on purpose (docs/deployment.md), and a webhook needs one.
 */
import { truncateForTelegram, type TgUpdate } from './parse';

const API = 'https://api.telegram.org';

/** How long Telegram holds a poll open. The fetch has to outlast it. */
const POLL_SECONDS = 30;

type ApiResult<T> = { ok: true; result: T } | { ok: false; description?: string };

export class Telegram {
  constructor(private readonly token: string) {}

  private async call<T>(method: string, body: unknown, timeoutMs: number): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${API}/bot${this.token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const payload = (await response.json()) as ApiResult<T>;
      if (!payload.ok) {
        throw new Error(`telegram ${method}: ${payload.description ?? response.status}`);
      }
      return payload.result;
    } finally {
      clearTimeout(timer);
    }
  }

  async getMe(): Promise<{ id: number; username: string }> {
    const me = await this.call<{ id: number; username?: string }>('getMe', {}, 10_000);
    if (!me.username) {
      // Without a username there is no `@mention` to gate on, and rule 1 has
      // nothing to stand on.
      throw new Error('this bot has no username; mention gating cannot work');
    }
    return { id: me.id, username: me.username };
  }

  /** Blocks for up to POLL_SECONDS. Returns [] on a timeout, which is normal. */
  async getUpdates(offset: number): Promise<TgUpdate[]> {
    return this.call<TgUpdate[]>(
      'getUpdates',
      { offset, timeout: POLL_SECONDS, allowed_updates: ['message'] },
      (POLL_SECONDS + 15) * 1000,
    );
  }

  async send(chatId: number, text: string, replyTo?: number): Promise<number> {
    const message = await this.call<{ message_id: number }>(
      'sendMessage',
      {
        chat_id: chatId,
        text: truncateForTelegram(text),
        reply_to_message_id: replyTo,
        link_preview_options: { is_disabled: true },
      },
      20_000,
    );
    return message.message_id;
  }

  /**
   * Rewrites a message in place (rule 12). Failures are swallowed: Telegram
   * rejects an edit that changes nothing, and a progress update is not worth
   * killing a job over.
   */
  async edit(chatId: number, messageId: number, text: string): Promise<void> {
    try {
      await this.call(
        'editMessageText',
        {
          chat_id: chatId,
          message_id: messageId,
          text: truncateForTelegram(text),
          link_preview_options: { is_disabled: true },
        },
        20_000,
      );
    } catch {
      // Not fatal, by design.
    }
  }
}
