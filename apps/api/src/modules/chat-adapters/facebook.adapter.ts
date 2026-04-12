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
 * Facebook Messenger adapter — scaffold for FB Graph API integration.
 *
 * Requires: FB_PAGE_ACCESS_TOKEN, FB_APP_SECRET (for webhook HMAC verification)
 * Webhook: POST /api/chat-adapters/facebook/webhook
 */
@Injectable()
export class FacebookAdapter implements IChannelAdapter {
  readonly channel = ChatChannel.FACEBOOK;
  private readonly logger = new Logger(FacebookAdapter.name);
  private readonly pageAccessToken?: string;
  private readonly graphApiUrl = 'https://graph.facebook.com/v19.0/me/messages';

  constructor(private configService: ConfigService) {
    this.pageAccessToken = this.configService.get<string>('FB_PAGE_ACCESS_TOKEN');
  }

  get isConfigured(): boolean {
    return !!this.pageAccessToken;
  }

  async sendMessage(message: OutboundMessage): Promise<SendResult> {
    if (!this.pageAccessToken) {
      return { success: false, error: 'Facebook page access token not configured' };
    }

    try {
      const body: Record<string, unknown> = {
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
    if (!this.pageAccessToken) return;
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
        `https://graph.facebook.com/v19.0/${externalUserId}?fields=first_name,last_name,profile_pic&access_token=${this.pageAccessToken}`,
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
