import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatChannel } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
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
      const fbMessage: Record<string, unknown> = {};

      if (message.templatePayload) {
        // Check if templatePayload is a Facebook attachment (has type + payload)
        if (message.templatePayload.type && message.templatePayload.payload) {
          fbMessage.attachment = message.templatePayload;
        }

        // Quick replies can be set on templatePayload
        if (message.templatePayload.quick_replies) {
          fbMessage.quick_replies = message.templatePayload.quick_replies;
        }
      }

      if (message.text && !fbMessage.attachment) {
        fbMessage.text = message.text;
      }

      const body: Record<string, unknown> = {
        messaging_type: 'RESPONSE',
        recipient: { id: message.externalUserId },
        message: fbMessage,
      };

      const res = await fetch(this.graphApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.pageAccessToken}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
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
      const isTimeout = err instanceof Error && err.name === 'TimeoutError';
      this.logger.error(`[FB] send failed${isTimeout ? ' (timeout)' : ''}: ${errorMsg}`);
      if (isTimeout) {
        Sentry.captureException(err, {
          tags: { module: 'chat-adapter-facebook', action: 'send_message', reason: 'timeout' },
        });
      }
      return { success: false, error: errorMsg };
    }
  }

  async sendTypingIndicator(externalUserId: string): Promise<void> {
    if (!this.isConfigured) return;
    try {
      await fetch(this.graphApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.pageAccessToken}`,
        },
        body: JSON.stringify({
          recipient: { id: externalUserId },
          sender_action: 'typing_on',
        }),
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      // Best-effort, ignore errors
    }
  }

  async getUserProfile(externalUserId: string): Promise<UserProfile | null> {
    if (!this.pageAccessToken || !this.pageId) return null;

    // Try 1 — Messenger User Profile API (returns name + profile_pic).
    // Works only when pages_messaging is at Advanced Access tier (post App Review).
    // Currently returns 400/100/33 in dev mode; falls through silently.
    const direct = await this.fetchDirectProfile(externalUserId);
    if (direct) return direct;

    // Try 2 — Workaround via /me/conversations participants (returns name only,
    // no profile_pic). Always works while pages_messaging is granted.
    return this.fetchProfileViaConversations(externalUserId);
  }

  private async fetchDirectProfile(externalUserId: string): Promise<UserProfile | null> {
    try {
      const url =
        `https://graph.facebook.com/v25.0/${encodeURIComponent(externalUserId)}` +
        `?fields=name,profile_pic&access_token=${encodeURIComponent(this.pageAccessToken!)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return null;
      const json = (await res.json()) as { name?: string; profile_pic?: string };
      if (!json.name) return null;
      return { displayName: json.name, avatarUrl: json.profile_pic };
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === 'TimeoutError';
      if (isTimeout) {
        this.logger.warn(`[FB] fetchDirectProfile timeout for PSID ${externalUserId}`);
        Sentry.captureException(err, {
          tags: {
            module: 'chat-adapter-facebook',
            action: 'fetch_direct_profile',
            reason: 'timeout',
          },
        });
      }
      return null;
    }
  }

  private async fetchProfileViaConversations(
    externalUserId: string,
  ): Promise<UserProfile | null> {
    try {
      const url =
        `https://graph.facebook.com/v25.0/me/conversations?user_id=${encodeURIComponent(externalUserId)}` +
        `&fields=participants&access_token=${encodeURIComponent(this.pageAccessToken!)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return null;
      const json = (await res.json()) as {
        data?: Array<{ participants?: { data?: Array<{ id: string; name?: string }> } }>;
      };
      const conv = json.data?.[0];
      const user = conv?.participants?.data?.find((p) => p.id === externalUserId);
      if (!user?.name) return null;
      return { displayName: user.name };
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === 'TimeoutError';
      if (isTimeout) {
        this.logger.warn(
          `[FB] fetchProfileViaConversations timeout for PSID ${externalUserId}`,
        );
        Sentry.captureException(err, {
          tags: {
            module: 'chat-adapter-facebook',
            action: 'fetch_profile_via_conversations',
            reason: 'timeout',
          },
        });
      }
      return null;
    }
  }
}
