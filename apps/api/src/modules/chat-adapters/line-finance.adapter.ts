import { Injectable, Logger } from '@nestjs/common';
import { ChatChannel } from '@prisma/client';
import {
  IChannelAdapter,
  OutboundMessage,
  SendResult,
  UserProfile,
} from '../chat-engine/interfaces/channel-adapter.interface';
import { LineFinanceClientService } from '../chatbot-finance/services/line-finance-client.service';
import { buildLinePayload } from './line-payload';

/**
 * LINE Finance adapter — wraps LineFinanceClientService to conform to
 * IChannelAdapter for the unified chat engine.
 *
 * Phase 4 multi-bubble: handles image/sticker/location/video/flex/json
 * in addition to text, with quick replies attached to any of them.
 */
@Injectable()
export class LineFinanceAdapter implements IChannelAdapter {
  readonly channel = ChatChannel.LINE_FINANCE;
  private readonly logger = new Logger(LineFinanceAdapter.name);

  constructor(private lineClient: LineFinanceClientService) {}

  async sendMessage(message: OutboundMessage): Promise<SendResult> {
    try {
      if (!(await this.lineClient.isConfigured())) {
        return { success: false, error: 'LINE Finance token not configured' };
      }

      const payload = buildLinePayload(message);
      if (!payload) {
        return { success: false, error: 'no message content' };
      }

      // LineFinanceClientService.pushMessage is typed for the legacy
      // text/flex/sticker union; the new payload shapes (image/video/location)
      // are valid LINE API types but not in that local union — cast to any.
      await this.lineClient.pushMessage(message.externalUserId, [payload] as any);
      return { success: true };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[LineFinanceAdapter] send failed: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  }

  async sendTypingIndicator(_externalUserId: string): Promise<void> {
    // LINE doesn't have a typing indicator API for bots
  }

  async getUserProfile(externalUserId: string): Promise<UserProfile | null> {
    const profile = await this.lineClient.getUserProfile(externalUserId);
    if (!profile) return null;
    return {
      displayName: profile.displayName,
      avatarUrl: profile.pictureUrl,
    };
  }
}
