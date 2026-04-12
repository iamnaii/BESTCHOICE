import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatChannel } from '@prisma/client';
import {
  IChannelAdapter,
  OutboundMessage,
  SendResult,
  UserProfile,
} from '../chat-engine/interfaces/channel-adapter.interface';

/**
 * Facebook Messenger adapter — uses FB Graph API Send API.
 *
 * API reference: https://developers.facebook.com/docs/messenger-platform/reference/send-api/
 * Endpoint: POST https://graph.facebook.com/v25.0/{PAGE_ID}/messages
 *
 * Required env:
 * - FB_PAGE_ACCESS_TOKEN — Page access token with pages_messaging permission
 * - FB_PAGE_ID — Facebook Page ID
 * - FB_APP_SECRET — for webhook HMAC-SHA256 verification (inbound)
 *
 * Key constraints:
 * - messaging_type is required (RESPONSE within 24h window, UPDATE, or MESSAGE_TAG)
 * - text max 2,000 UTF-8 chars
 * - attachment max 25 MB
 * - As of April 27, 2026: message tags CONFIRMED_EVENT_UPDATE, ACCOUNT_UPDATE,
 *   POST_PURCHASE_UPDATE are deprecated
 */
@Injectable()
export class FacebookAdapter implements IChannelAdapter {
  readonly channel = ChatChannel.FACEBOOK;
  private readonly logger = new Logger(FacebookAdapter.name);
  private readonly pageAccessToken?: string;
  private readonly pageId?: string;

  constructor(private configService: ConfigService) {
    this.pageAccessToken = this.configService.get<string>('FB_PAGE_ACCESS_TOKEN');
    this.pageId = this.configService.get<string>('FB_PAGE_ID');
  }

  get isConfigured(): boolean {
    return !!this.pageAccessToken && !!this.pageId;
  }

  private get graphApiUrl(): string {
    return `https://graph.facebook.com/v25.0/${this.pageId}/messages`;
  }

  async sendMessage(message: OutboundMessage): Promise<SendResult> {
    if (!this.isConfigured) {
      return { success: false, error: 'Facebook page access token or page ID not configured' };
    }

    try {
      const body: Record<string, unknown> = {
        messaging_type: 'RESPONSE', // within 24h reply window
        recipient: { id: message.externalUserId },
        message: message.text
          ? { text: message.text }
          : { attachment: message.templatePayload },
      };

      const res = await fetch(`${this.graphApiUrl}?access_token=${this.pageAccessToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errBody = await res.text();
        this.logger.error(`[FB] API error ${res.status}: ${errBody}`);
        return { success: false, error: errBody };
      }

      const data = (await res.json()) as { message_id?: string };
      return { success: true, externalMessageId: data.message_id };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[FB] send failed: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  }

  async sendTypingIndicator(externalUserId: string): Promise<void> {
    if (!this.isConfigured) return;
    try {
      await fetch(`${this.graphApiUrl}?access_token=${this.pageAccessToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: { id: externalUserId },
          sender_action: 'typing_on',
        }),
      });
    } catch {
      // Best-effort, ignore errors
    }
  }

  async getUserProfile(externalUserId: string): Promise<UserProfile | null> {
    if (!this.pageAccessToken) return null;
    try {
      const res = await fetch(
        `https://graph.facebook.com/v25.0/${externalUserId}?fields=first_name,last_name,profile_pic&access_token=${this.pageAccessToken}`,
      );
      if (!res.ok) return null;
      const data = (await res.json()) as {
        first_name?: string;
        last_name?: string;
        profile_pic?: string;
      };
      return {
        displayName: `${data.first_name ?? ''} ${data.last_name ?? ''}`.trim(),
        avatarUrl: data.profile_pic,
      };
    } catch {
      return null;
    }
  }
}
