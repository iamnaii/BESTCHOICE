import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * CHATCONE Integration Service (Scaffold)
 *
 * CHATCONE is the multi-channel chat platform used by BESTCHOICE for
 * LINE OA, Facebook Messenger, and TikTok conversations.
 *
 * API docs: https://docs.chatcone.com (request access from CHATCONE team)
 * Base URL: configurable via CHATCONE_API_URL env variable
 *
 * TODO (when credentials are available):
 *  - Implement OAuth2/API key auth against CHATCONE API
 *  - Wire sendMessage() → POST /messages
 *  - Wire getConversations() → GET /conversations
 *  - Wire getCustomerChat() → GET /contacts/{contactId}/messages
 */
@Injectable()
export class ChatconeService {
  private readonly logger = new Logger(ChatconeService.name);

  constructor(private configService: ConfigService) {}

  // ─── Configuration check ─────────────────────────────────

  /** Returns true if CHATCONE_API_KEY is set in env */
  isConfigured(): boolean {
    const apiKey = this.configService.get<string>('CHATCONE_API_KEY');
    return !!apiKey;
  }

  getStatus(): {
    configured: boolean;
    baseUrl: string;
    channels: string[];
    message: string;
  } {
    const baseUrl =
      this.configService.get<string>('CHATCONE_API_URL') ||
      'https://api.chatcone.com/v1';
    return {
      configured: this.isConfigured(),
      baseUrl,
      channels: ['LINE', 'Facebook', 'TikTok'],
      message: this.isConfigured()
        ? 'CHATCONE เชื่อมต่อแล้ว'
        : 'ยังไม่ได้ตั้งค่า — ต้องการ CHATCONE_API_KEY',
    };
  }

  private getBaseUrl(): string {
    return (
      this.configService.get<string>('CHATCONE_API_URL') ||
      'https://api.chatcone.com/v1'
    );
  }

  private buildHeaders(): Record<string, string> {
    const apiKey = this.configService.get<string>('CHATCONE_API_KEY') || '';
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };
  }

  // ─── Placeholder methods ──────────────────────────────────

  /**
   * Send a message to a customer via CHATCONE.
   * Placeholder — implement when CHATCONE_API_KEY is available.
   */
  async sendMessage(params: {
    contactId: string;
    channel: 'LINE' | 'FACEBOOK' | 'TIKTOK';
    message: string;
    templateId?: string;
  }): Promise<{ messageId: string; status: string }> {
    if (!this.isConfigured()) {
      this.logger.warn('sendMessage: CHATCONE not configured — skipped');
      return { messageId: '', status: 'NOT_CONFIGURED' };
    }

    this.logger.log(
      `sendMessage: channel=${params.channel} contactId=${params.contactId}`,
    );

    // TODO: implement actual API call
    // const res = await fetch(`${this.getBaseUrl()}/messages`, {
    //   method: 'POST',
    //   headers: this.buildHeaders(),
    //   body: JSON.stringify({
    //     contactId: params.contactId,
    //     channel: params.channel,
    //     text: params.message,
    //     templateId: params.templateId,
    //   }),
    // });
    // const data = await res.json();
    // return { messageId: data.id, status: data.status };

    return { messageId: 'placeholder', status: 'PENDING' };
  }

  /**
   * Fetch recent conversations from CHATCONE.
   * Placeholder — returns empty list until configured.
   */
  async getConversations(params: {
    page?: number;
    limit?: number;
    channel?: string;
    status?: 'OPEN' | 'RESOLVED' | 'ALL';
  }): Promise<{
    data: unknown[];
    total: number;
    page: number;
    limit: number;
  }> {
    if (!this.isConfigured()) {
      return { data: [], total: 0, page: params.page ?? 1, limit: params.limit ?? 20 };
    }

    // TODO: implement actual API call
    // const url = new URL(`${this.getBaseUrl()}/conversations`);
    // url.searchParams.set('page', String(params.page ?? 1));
    // url.searchParams.set('limit', String(params.limit ?? 20));
    // if (params.channel) url.searchParams.set('channel', params.channel);
    // if (params.status && params.status !== 'ALL') url.searchParams.set('status', params.status);
    // const res = await fetch(url.toString(), { headers: this.buildHeaders() });
    // const body = await res.json();
    // return { data: body.data, total: body.total, page: body.page, limit: body.limit };

    return { data: [], total: 0, page: params.page ?? 1, limit: params.limit ?? 20 };
  }

  /**
   * Fetch chat history for a specific customer (by CHATCONE contactId).
   * Placeholder — returns empty list until configured.
   */
  async getCustomerChat(
    contactId: string,
    page = 1,
    limit = 50,
  ): Promise<{
    contactId: string;
    messages: unknown[];
    total: number;
    page: number;
    limit: number;
  }> {
    if (!this.isConfigured()) {
      return { contactId, messages: [], total: 0, page, limit };
    }

    // TODO: implement actual API call
    // const url = new URL(`${this.getBaseUrl()}/contacts/${contactId}/messages`);
    // url.searchParams.set('page', String(page));
    // url.searchParams.set('limit', String(limit));
    // const res = await fetch(url.toString(), { headers: this.buildHeaders() });
    // const body = await res.json();
    // return { contactId, messages: body.data, total: body.total, page, limit };

    return { contactId, messages: [], total: 0, page, limit };
  }

  /**
   * Lookup CHATCONE contact by phone number (for linking BESTCHOICE customer → CHATCONE contact).
   * Placeholder.
   */
  async findContactByPhone(
    phone: string,
  ): Promise<{ found: boolean; contactId: string | null; channel: string | null }> {
    if (!this.isConfigured()) {
      return { found: false, contactId: null, channel: null };
    }

    // TODO: implement actual API call
    // const res = await fetch(`${this.getBaseUrl()}/contacts/search?phone=${phone}`, {
    //   headers: this.buildHeaders(),
    // });
    // const data = await res.json();
    // if (data.contacts && data.contacts.length > 0) {
    //   return { found: true, contactId: data.contacts[0].id, channel: data.contacts[0].channel };
    // }

    return { found: false, contactId: null, channel: null };
  }
}
