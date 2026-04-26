import { Injectable, Logger } from '@nestjs/common';
import { ChatChannel, MessageType } from '@prisma/client';
import {
  IChannelAdapter,
  OutboundMessage,
  SendResult,
  UserProfile,
} from '../chat-engine/interfaces/channel-adapter.interface';
import { LineFinanceClientService } from '../chatbot-finance/services/line-finance-client.service';
import { parseStickerToken } from '../chat-engine/utils/sticker-token.util';

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
        const sticker = parseStickerToken(message.text);
        if (sticker) {
          await this.lineClient.pushSticker(
            message.externalUserId,
            sticker.packageId,
            sticker.stickerId,
          );
        } else {
          await this.lineClient.pushText(message.externalUserId, message.text);
        }
      }

      // (Audit finding P1) Surface Flex / template payloads instead of
      // silently dropping them. The LINE Finance client doesn't expose a
      // pushFlex helper yet; until it does, return success:false so the
      // chat engine + caller can react rather than silently lose the
      // message.
      if (message.templatePayload && !message.text) {
        this.logger.warn(
          '[LineFinanceAdapter] templatePayload received but Flex/template send is not implemented; message dropped',
        );
        return {
          success: false,
          error: 'LINE Finance Flex/template send not implemented in adapter',
        };
      }

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
