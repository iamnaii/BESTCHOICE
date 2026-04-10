import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';

interface LineTextMessage {
  type: 'text';
  text: string;
}

/**
 * LINE Messaging API client สำหรับ Staff OA โดยเฉพาะ
 * ใช้ token แยกจาก Shop/Finance OA — env: LINE_STAFF_CHANNEL_ACCESS_TOKEN
 *
 * Recipients: env LINE_STAFF_NOTIFY_TARGETS (comma-separated lineUserIds)
 */
@Injectable()
export class LineStaffClientService {
  private readonly logger = new Logger(LineStaffClientService.name);
  private readonly accessToken: string | undefined;
  private readonly recipients: string[];
  private readonly apiBase = 'https://api.line.me/v2/bot';

  constructor(private configService: ConfigService) {
    this.accessToken = this.configService.get<string>('LINE_STAFF_CHANNEL_ACCESS_TOKEN');
    const raw = this.configService.get<string>('LINE_STAFF_NOTIFY_TARGETS') ?? '';
    this.recipients = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (this.accessToken && this.recipients.length > 0) {
      this.logger.log(`[LINE Staff] Initialized with ${this.recipients.length} recipient(s)`);
    } else {
      this.logger.warn(
        '[LINE Staff] Not configured — set LINE_STAFF_CHANNEL_ACCESS_TOKEN and LINE_STAFF_NOTIFY_TARGETS',
      );
    }
  }

  get isConfigured(): boolean {
    return !!this.accessToken && this.recipients.length > 0;
  }

  /** Broadcast text message ไปทุก staff ที่อยู่ใน recipients list */
  async broadcastText(text: string): Promise<void> {
    if (!this.isConfigured) {
      this.logger.warn('[LINE Staff] broadcast skipped — not configured');
      return;
    }

    // ใช้ LINE multicast (ถ้า ≤500 users) — efficient + 1 API call
    await this.callApi(`${this.apiBase}/message/multicast`, {
      to: this.recipients,
      messages: [{ type: 'text', text } satisfies LineTextMessage],
    });
    this.logger.log(`[LINE Staff] broadcast → ${this.recipients.length} recipient(s)`);
  }

  /** Push text ไปยัง user เดียว (ใช้กรณี route ตาม role/branch ในอนาคต) */
  async pushText(to: string, text: string): Promise<void> {
    if (!this.accessToken) return;
    await this.callApi(`${this.apiBase}/message/push`, {
      to,
      messages: [{ type: 'text', text } satisfies LineTextMessage],
    });
  }

  private async callApi(url: string, body: unknown): Promise<void> {
    if (!this.accessToken) return;
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
      this.logger.error(`[LINE Staff] API error ${res.status}: ${errBody}`);
      const err = new Error(`LINE Staff API ${res.status}: ${errBody}`);
      Sentry.captureException(err, {
        tags: { module: 'chatbot-finance', action: 'line_staff_api' },
        extra: { url, status: res.status },
      });
      throw err;
    }
  }
}
