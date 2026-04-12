import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';

interface LineTextMessage {
  type: 'text';
  text: string;
  quickReply?: LineQuickReply;
}

type LineMessage = LineTextMessage;

export interface LineQuickReplyItem {
  type: 'action';
  action:
    | { type: 'postback'; label: string; data: string; displayText?: string }
    | { type: 'message'; label: string; text: string };
}

export interface LineQuickReply {
  items: LineQuickReplyItem[];
}

/**
 * LINE Messaging API client สำหรับ Finance OA โดยเฉพาะ
 * ใช้ token แยกจาก Shop OA — env: LINE_FINANCE_CHANNEL_ACCESS_TOKEN
 */
@Injectable()
export class LineFinanceClientService {
  private readonly logger = new Logger(LineFinanceClientService.name);
  private readonly accessToken: string | undefined;
  private readonly apiBase = 'https://api.line.me/v2/bot';
  private readonly dataApiBase = 'https://api-data.line.me/v2/bot';

  constructor(private configService: ConfigService) {
    this.accessToken = this.configService.get<string>('LINE_FINANCE_CHANNEL_ACCESS_TOKEN');
  }

  get isConfigured(): boolean {
    return !!this.accessToken;
  }

  async pushText(to: string, text: string): Promise<void> {
    return this.pushMessage(to, [{ type: 'text', text }]);
  }

  async pushMessage(to: string, messages: LineMessage[]): Promise<void> {
    await this.callApi(`${this.apiBase}/message/push`, { to, messages });
    this.logger.log(`[LINE Finance] push → ${to}`);
  }

  async replyText(replyToken: string, text: string): Promise<void> {
    return this.replyMessage(replyToken, [{ type: 'text', text }]);
  }

  async replyWithQuickReply(
    replyToken: string,
    text: string,
    quickReply: LineQuickReply,
  ): Promise<void> {
    return this.replyMessage(replyToken, [{ type: 'text', text, quickReply }]);
  }

  async replyMessage(replyToken: string, messages: LineMessage[]): Promise<void> {
    await this.callApi(`${this.apiBase}/message/reply`, { replyToken, messages });
    this.logger.log(`[LINE Finance] reply sent`);
  }

  /** ดาวน์โหลด media (รูป/เสียง) จาก LINE Content API */
  async getMessageContent(messageId: string): Promise<Buffer> {
    if (!this.accessToken) throw new Error('LINE Finance access token not configured');
    const res = await fetch(`${this.dataApiBase}/message/${messageId}/content`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`LINE content API error ${res.status}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  private async callApi(url: string, body: unknown): Promise<void> {
    if (!this.accessToken) {
      this.logger.warn('[LINE Finance] access token not configured — skipping send');
      return;
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.accessToken}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.text();
      this.logger.error(`[LINE Finance] API error ${res.status}: ${errBody}`);
      const err = new Error(`LINE API ${res.status}: ${errBody}`);
      Sentry.captureException(err, {
        tags: { module: 'chatbot-finance', action: 'line_finance_api' },
        extra: { url, status: res.status },
      });
      throw err;
    }
  }
}
