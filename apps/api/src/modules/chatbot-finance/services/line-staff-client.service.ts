import { Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { IntegrationConfigService } from '../../integrations/integration-config.service';

interface LineTextMessage {
  type: 'text';
  text: string;
}

/**
 * LINE Messaging API client สำหรับ Staff OA โดยเฉพาะ
 * ใช้ token แยกจาก Shop/Finance OA — config key: line-staff / channelToken
 *
 * Recipients: config key: line-staff / notifyTargets (comma-separated lineUserIds)
 */
@Injectable()
export class LineStaffClientService {
  private readonly logger = new Logger(LineStaffClientService.name);
  private readonly apiBase = 'https://api.line.me/v2/bot';

  constructor(private readonly integrationConfig: IntegrationConfigService) {}

  private async getAccessToken(): Promise<string> {
    return (await this.integrationConfig.getValue('line-staff', 'channelToken')) || '';
  }

  private async getRecipients(): Promise<string[]> {
    const raw = (await this.integrationConfig.getValue('line-staff', 'notifyTargets')) || '';
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  }

  async isConfigured(): Promise<boolean> {
    const token = await this.getAccessToken();
    const recipients = await this.getRecipients();
    return !!token && recipients.length > 0;
  }

  /** Broadcast text message ไปทุก staff ที่อยู่ใน recipients list */
  async broadcastText(text: string): Promise<void> {
    if (!(await this.isConfigured())) {
      this.logger.warn('[LINE Staff] broadcast skipped — not configured');
      return;
    }

    const recipients = await this.getRecipients();
    // ใช้ LINE multicast (ถ้า ≤500 users) — efficient + 1 API call
    await this.callApi(`${this.apiBase}/message/multicast`, {
      to: recipients,
      messages: [{ type: 'text', text } satisfies LineTextMessage],
    });
    this.logger.log(`[LINE Staff] broadcast → ${recipients.length} recipient(s)`);
  }

  /** Push text ไปยัง user เดียว (ใช้กรณี route ตาม role/branch ในอนาคต) */
  async pushText(to: string, text: string): Promise<void> {
    const token = await this.getAccessToken();
    if (!token) return;
    await this.callApi(`${this.apiBase}/message/push`, {
      to,
      messages: [{ type: 'text', text } satisfies LineTextMessage],
    });
  }

  private async callApi(url: string, body: unknown): Promise<void> {
    const token = await this.getAccessToken();
    if (!token) return;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
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
