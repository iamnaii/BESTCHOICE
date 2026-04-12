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
 * TikTok adapter — scaffold for TikTok messaging integration.
 *
 * TikTok Business API for messaging is limited; this adapter
 * will be fully implemented when TikTok opens their messaging API.
 * For now, it stores inbound messages but cannot send replies.
 */
@Injectable()
export class TiktokAdapter implements IChannelAdapter {
  readonly channel = ChatChannel.TIKTOK;
  private readonly logger = new Logger(TiktokAdapter.name);

  constructor(private configService: ConfigService) {}

  async sendMessage(_message: OutboundMessage): Promise<SendResult> {
    this.logger.warn('[TikTok] Messaging API not yet available — message not sent');
    return { success: false, error: 'TikTok messaging API not yet integrated' };
  }

  async sendTypingIndicator(_externalUserId: string): Promise<void> {
    // Not supported
  }

  async getUserProfile(_externalUserId: string): Promise<UserProfile | null> {
    return null;
  }
}
