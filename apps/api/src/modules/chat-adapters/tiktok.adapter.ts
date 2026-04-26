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
 * TikTok Business Messaging adapter.
 *
 * TikTok Business Messaging API (https://business-api.tiktok.com/portal/bm-api/education-hub)
 * is available but requires partner-level access application.
 *
 * Key constraints:
 * - 48-hour reply window — can only respond after customer initiates conversation
 * - No broadcast/proactive messaging — must be triggered by customer message
 * - Image attachments supported (in supported markets)
 * - Welcome message + suggested questions configurable
 *
 * Required env (when access is granted):
 * - TIKTOK_BM_ACCESS_TOKEN — Business Messaging access token
 * - TIKTOK_BM_BUSINESS_ID — TikTok Business Account ID
 *
 * Status: scaffold — sends will fail gracefully until access is granted and
 * endpoint details are available from TikTok's partner documentation.
 */
@Injectable()
export class TiktokAdapter implements IChannelAdapter {
  readonly channel = ChatChannel.TIKTOK;
  private readonly logger = new Logger(TiktokAdapter.name);
  private readonly accessToken?: string;
  private readonly businessId?: string;

  constructor(private configService: ConfigService) {
    this.accessToken = this.configService.get<string>('TIKTOK_BM_ACCESS_TOKEN');
    this.businessId = this.configService.get<string>('TIKTOK_BM_BUSINESS_ID');
  }

  get isConfigured(): boolean {
    return !!this.accessToken && !!this.businessId;
  }

  async sendMessage(_message: OutboundMessage): Promise<SendResult> {
    if (!this.isConfigured) {
      this.logger.debug(
        '[TikTok] Business Messaging API credentials not configured — message not sent. ' +
        'Apply for access at https://business-api.tiktok.com/portal/bm-api/education-hub',
      );
      return { success: false, error: 'TikTok Business Messaging API not configured — requires partner access application' };
    }

    // TODO: implement when partner access is granted and endpoint docs are available
    // Expected: POST https://business-api.tiktok.com/open_api/v1.3/business/message/send/
    // Headers: Access-Token: {token}
    // Body: { business_id, user_id, message_type, content }
    //
    // (Audit finding P1) Capture to Sentry too — a `success: false` return
    // from a configured-but-unimplemented adapter is a real prod gap, not
    // expected behavior. Without this the chat engine can silently drop
    // messages destined for TikTok with no observability.
    this.logger.error('[TikTok] sendMessage called but endpoint not yet implemented');
    Sentry.captureMessage('[TikTok] sendMessage called on unimplemented adapter', {
      level: 'error',
      tags: { module: 'chat-adapter-tiktok' },
    });
    return { success: false, error: 'TikTok messaging endpoint not yet implemented — awaiting partner docs' };
  }

  async sendTypingIndicator(_externalUserId: string): Promise<void> {
    // Not supported by TikTok
  }

  async getUserProfile(_externalUserId: string): Promise<UserProfile | null> {
    return null;
  }
}
