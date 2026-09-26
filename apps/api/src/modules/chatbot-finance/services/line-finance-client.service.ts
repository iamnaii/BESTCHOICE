import { Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { IntegrationConfigService } from '../../integrations/integration-config.service';

interface LineTextMessage {
  type: 'text';
  text: string;
  quickReply?: LineQuickReply;
}

/** LINE Flex Message — see https://developers.line.biz/en/docs/messaging-api/using-flex-messages/ */
export type FlexContainer = Record<string, unknown>;

interface LineFlexMessage {
  type: 'flex';
  altText: string;
  contents: FlexContainer;
  quickReply?: LineQuickReply;
}

interface LineStickerMessage {
  type: 'sticker';
  packageId: string;
  stickerId: string;
  quickReply?: LineQuickReply;
}

/** รูปภาพ — LINE ต้องการ URL สาธารณะ HTTPS เท่านั้น (Product.gallery[]; ห้ามใช้ photos[] ที่เป็น base64) */
interface LineImageMessage {
  type: 'image';
  originalContentUrl: string;
  previewImageUrl: string;
  quickReply?: LineQuickReply;
}

export type LineMessage = LineTextMessage | LineFlexMessage | LineStickerMessage | LineImageMessage;

export interface LineQuickReplyItem {
  type: 'action';
  action:
    | { type: 'postback'; label: string; data: string; displayText?: string }
    | { type: 'message'; label: string; text: string };
}

export interface LineQuickReply {
  items: LineQuickReplyItem[];
}

/** โยนเมื่อไม่มี Channel Access Token ของ OA ไฟแนนซ์ — ทางเข้มงวด (ยื่น GFIN) ต้องรู้ ไม่ใช่ข้ามเงียบแบบ callApi */
export class LineFinanceNotConfiguredError extends Error {
  constructor() {
    super('LINE Finance access token not configured');
    this.name = 'LineFinanceNotConfiguredError';
  }
}

/**
 * LINE Messaging API client สำหรับ Finance OA โดยเฉพาะ
 * ใช้ token แยกจาก Shop OA — config key: line-finance / channelToken
 */
@Injectable()
export class LineFinanceClientService {
  private readonly logger = new Logger(LineFinanceClientService.name);
  private readonly apiBase = 'https://api.line.me/v2/bot';
  private readonly dataApiBase = 'https://api-data.line.me/v2/bot';

  constructor(private readonly integrationConfig: IntegrationConfigService) {}

  private async getAccessToken(): Promise<string> {
    return (await this.integrationConfig.getValue('line-finance', 'channelToken')) || '';
  }

  async isConfigured(): Promise<boolean> {
    return !!(await this.getAccessToken());
  }

  async pushText(to: string, text: string): Promise<void> {
    return this.pushMessage(to, [{ type: 'text', text }]);
  }

  async pushSticker(to: string, packageId: string, stickerId: string): Promise<void> {
    return this.pushMessage(to, [{ type: 'sticker', packageId, stickerId }]);
  }

  async pushMessage(to: string, messages: LineMessage[]): Promise<void> {
    await this.callApi(`${this.apiBase}/message/push`, { to, messages });
    this.logger.log(`[LINE Finance] push → ${to}`);
  }

  async replyText(replyToken: string, text: string): Promise<void> {
    return this.replyMessage(replyToken, [{ type: 'text', text }]);
  }

  async replyFlex(
    replyToken: string,
    altText: string,
    contents: FlexContainer,
  ): Promise<void> {
    return this.replyMessage(replyToken, [{ type: 'flex', altText, contents }]);
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

  /**
   * Fetch LINE user profile (displayName + pictureUrl). Best-effort — returns null on failure
   * so webhook handling is never blocked by a profile API issue.
   */
  async getUserProfile(
    userId: string,
  ): Promise<{ displayName: string; pictureUrl?: string; statusMessage?: string } | null> {
    const token = await this.getAccessToken();
    if (!token) return null;
    try {
      const res = await fetch(`${this.apiBase}/profile/${userId}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        this.logger.warn(`[LINE Finance] profile API ${res.status} for ${userId.slice(0, 8)}...`);
        return null;
      }
      return (await res.json()) as {
        displayName: string;
        pictureUrl?: string;
        statusMessage?: string;
      };
    } catch (err) {
      this.logger.warn(
        `[LINE Finance] profile fetch failed: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
  }

  /** push แบบเข้มงวด (ยื่น GFIN PR 2): ไม่มี token = โยน · LINE error = โยน · คืน x-line-request-id ไว้เก็บเป็นหลักฐานการส่ง */
  async pushMessageStrict(to: string, messages: LineMessage[]): Promise<{ requestId: string | null }> {
    const token = await this.getAccessToken();
    if (!token) throw new LineFinanceNotConfiguredError();
    const res = await this.postJson(token, `${this.apiBase}/message/push`, { to, messages });
    this.logger.log(`[LINE Finance] push(strict) → ${to.slice(0, 8)}…`);
    return { requestId: res.headers.get('x-line-request-id') };
  }

  /** ชื่อ/รูปกลุ่ม — https://developers.line.biz/en/reference/messaging-api/#get-group-summary · ดึงไม่ได้ = null (ไม่บล็อก webhook) */
  async getGroupSummary(groupId: string): Promise<{ groupId: string; groupName: string; pictureUrl?: string } | null> {
    return this.getJson(`${this.apiBase}/group/${groupId}/summary`, 'group summary');
  }

  async getGroupMemberCount(groupId: string): Promise<number | null> {
    const r = await this.getJson<{ count: number }>(`${this.apiBase}/group/${groupId}/members/count`, 'group member count');
    return typeof r?.count === 'number' ? r.count : null;
  }

  private async getJson<T>(url: string, what: string): Promise<T | null> {
    const token = await this.getAccessToken();
    if (!token) return null;
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) { this.logger.warn(`[LINE Finance] ${what} API ${res.status}`); return null; }
      return (await res.json()) as T;
    } catch (err) {
      this.logger.warn(`[LINE Finance] ${what} fetch failed: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  /** ดาวน์โหลด media (รูป/เสียง) จาก LINE Content API */
  async getMessageContent(messageId: string): Promise<Buffer> {
    const token = await this.getAccessToken();
    if (!token) throw new Error('LINE Finance access token not configured');
    const res = await fetch(`${this.dataApiBase}/message/${messageId}/content`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      throw new Error(`LINE content API error ${res.status}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  private async callApi(url: string, body: unknown): Promise<void> {
    const token = await this.getAccessToken();
    if (!token) {
      this.logger.warn('[LINE Finance] access token not configured — skipping send');
      return;
    }
    await this.postJson(token, url, body);
  }

  /** POST JSON → คืน Response เมื่อสำเร็จ · ไม่สำเร็จ = log + Sentry + throw (semantics เดิมของ callApi) */
  private async postJson(token: string, url: string, body: unknown): Promise<Response> {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
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
      return res;
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        this.logger.error(`[LINE Finance] API timeout after 10s: ${url}`);
        Sentry.captureException(err, {
          tags: { module: 'chatbot-finance', action: 'line_finance_api', reason: 'timeout' },
          extra: { url },
        });
        throw new Error('LINE Finance API timeout');
      }
      throw err;
    }
  }
}
