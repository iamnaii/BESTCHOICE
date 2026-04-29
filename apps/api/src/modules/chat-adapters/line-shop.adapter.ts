import { Injectable, Logger } from '@nestjs/common';
import { ChatChannel, MessageType } from '@prisma/client';
import {
  IChannelAdapter,
  OutboundMessage,
  SendResult,
  UserProfile,
} from '../chat-engine/interfaces/channel-adapter.interface';
import { parseStickerToken } from '../chat-engine/utils/sticker-token.util';
import { LineOaService } from '../line-oa/line-oa.service';
import type { LineMessagePayload } from '../line-oa/dto/webhook-event.dto';

/**
 * LINE Shop adapter — wraps LineOaService (Shop OA)
 * to conform to IChannelAdapter for the unified chat engine.
 */
@Injectable()
export class LineShopAdapter implements IChannelAdapter {
  readonly channel = ChatChannel.LINE_SHOP;
  private readonly logger = new Logger(LineShopAdapter.name);

  constructor(private lineOaService: LineOaService) {}

  async sendMessage(message: OutboundMessage): Promise<SendResult> {
    try {
      if (!message.text) return { success: true };

      const sticker = parseStickerToken(message.text);
      const payload: LineMessagePayload = sticker
        ? { type: 'sticker', packageId: sticker.packageId, stickerId: sticker.stickerId }
        : { type: 'text', text: message.text };

      await this.lineOaService.pushMessage(message.externalUserId, [payload], 'line-shop');
      return { success: true };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[LineShopAdapter] send failed: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  }

  async sendTypingIndicator(_externalUserId: string): Promise<void> {
    // LINE doesn't support typing indicators from bots
  }

  async getUserProfile(externalUserId: string): Promise<UserProfile | null> {
    // LineOaService.getUserProfile throws on any failure — wrap so webhook never blocks
    try {
      const profile = await this.lineOaService.getUserProfile(externalUserId, 'line-shop');
      return {
        displayName: profile.displayName,
        avatarUrl: profile.pictureUrl,
      };
    } catch (err) {
      this.logger.warn(
        `[LineShopAdapter] profile fetch failed: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
  }
}
