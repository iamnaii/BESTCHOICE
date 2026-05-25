import { Injectable, Logger } from '@nestjs/common';
import { ChatChannel } from '@prisma/client';
import {
  IChannelAdapter,
  OutboundMessage,
  OutboundQuickReply,
  SendResult,
  UserProfile,
} from '../chat-engine/interfaces/channel-adapter.interface';
import { LineFinanceClientService } from '../chatbot-finance/services/line-finance-client.service';
import { parseStickerToken } from '../chat-engine/utils/sticker-token.util';

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

      const payload = this.buildLinePayload(message);
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

  /**
   * Build a LINE Messaging API message payload from an OutboundMessage.
   * Returns undefined if the message has no content the adapter can send.
   *
   * Priority: imageUrl > sticker > location > videoUrl > flexJson > jsonPayload > text
   * (matches the natural exclusivity of bubble types — a single bubble is one
   * of these.)
   */
  private buildLinePayload(message: OutboundMessage): Record<string, unknown> | undefined {
    const quickReply =
      message.quickReplies && message.quickReplies.length > 0
        ? { items: this.buildLineQuickReplyItems(message.quickReplies) }
        : undefined;
    const withQr = <T extends Record<string, unknown>>(payload: T): T =>
      quickReply ? ({ ...payload, quickReply } as T) : payload;

    if (message.imageUrl) {
      return withQr({
        type: 'image',
        originalContentUrl: message.imageUrl,
        previewImageUrl: message.thumbnailUrl ?? message.imageUrl,
      });
    }
    if (message.sticker) {
      return withQr({
        type: 'sticker',
        packageId: message.sticker.packageId,
        stickerId: message.sticker.stickerId,
      });
    }
    if (message.location) {
      return withQr({
        type: 'location',
        title: message.location.title,
        address: message.location.address,
        latitude: message.location.latitude,
        longitude: message.location.longitude,
      });
    }
    if (message.videoUrl) {
      // LINE rejects video messages whose previewImageUrl is not an image
      // (it must be a valid JPEG/PNG). Falling back to videoUrl produces a
      // silent 400 from the LINE API. Fail fast with a clear message instead.
      if (!message.thumbnailUrl) {
        throw new Error('VIDEO bubble ต้องมี thumbnailUrl (LINE ต้องการ preview image)');
      }
      return withQr({
        type: 'video',
        originalContentUrl: message.videoUrl,
        previewImageUrl: message.thumbnailUrl,
      });
    }
    if (message.flexJson) {
      return withQr({
        type: 'flex',
        altText: (message.flexJson as any)?.altText ?? 'Flex message',
        contents: message.flexJson,
      });
    }
    if (message.jsonPayload) {
      // Already a complete LINE message object (advanced/raw path); attach QR
      // only if the payload doesn't already include one.
      const raw = { ...(message.jsonPayload as Record<string, unknown>) };
      if (quickReply && !raw.quickReply) raw.quickReply = quickReply;
      return raw;
    }
    if (message.text) {
      // Legacy compatibility: sticker tokens embedded in text
      const sticker = parseStickerToken(message.text);
      if (sticker) {
        return withQr({
          type: 'sticker',
          packageId: sticker.packageId,
          stickerId: sticker.stickerId,
        });
      }
      return withQr({ type: 'text', text: message.text });
    }
    return undefined;
  }

  /**
   * Translate normalized quick replies to LINE quickReply.items[].
   * URL → type:'uri' action; MESSAGE → type:'message'; POSTBACK → type:'postback'.
   */
  private buildLineQuickReplyItems(qrs: OutboundQuickReply[]): Array<Record<string, unknown>> {
    return qrs.slice(0, 13).map((q) => {
      let action: Record<string, unknown>;
      if (q.type === 'URL') {
        action = { type: 'uri', label: q.label, uri: q.url ?? '' };
      } else if (q.type === 'MESSAGE') {
        action = { type: 'message', label: q.label, text: q.message ?? q.label };
      } else {
        action = { type: 'postback', label: q.label, data: q.payload ?? '' };
      }
      return { type: 'action', action };
    });
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
