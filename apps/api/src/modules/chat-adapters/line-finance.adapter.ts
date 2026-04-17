import { Injectable, Logger } from '@nestjs/common';
import { ChatChannel, MessageType } from '@prisma/client';
import {
  IChannelAdapter,
  OutboundMessage,
  SendResult,
  UserProfile,
} from '../chat-engine/interfaces/channel-adapter.interface';
import { LineFinanceClientService } from '../chatbot-finance/services/line-finance-client.service';

/**
 * LINE Finance adapter — wraps LineFinanceClientService
 * to conform to IChannelAdapter for the unified chat engine.
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

      if (message.text) {
        await this.lineClient.pushText(message.externalUserId, message.text);
      }
      // TODO: support Flex messages via templatePayload

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
