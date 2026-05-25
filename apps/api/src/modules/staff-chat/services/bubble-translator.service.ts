import { Injectable } from '@nestjs/common';
import {
  OutboundMessage,
  OutboundQuickReply,
} from '../../chat-engine/interfaces/channel-adapter.interface';

/** Row shape from the CannedResponseBubble table — kept as a structural type
 *  so the service doesn't take a Prisma client dependency. */
export interface Bubble {
  id: string;
  type: string;
  channels: string[];
  text: string | null;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  stickerPackageId: string | null;
  stickerId: string | null;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  locationTitle: string | null;
  json: any;
}

/** Row shape from the CannedResponseQuickReply table. */
export interface QuickReply {
  id: string;
  label: string;
  type: 'POSTBACK' | 'URL' | 'MESSAGE';
  payload: string | null;
  url: string | null;
  message: string | null;
}

/**
 * BubbleTranslator — pure-logic service. Converts CannedResponseBubble rows
 * into the channel-agnostic OutboundMessage shape, and filters bubbles by the
 * target channel. Adapters are responsible for the channel-specific API call.
 */
@Injectable()
export class BubbleTranslatorService {
  /**
   * Filter bubbles applicable to the given channel.
   * Empty `channels[]` means "all channels".
   */
  filterByChannel(bubbles: Bubble[], channel: string): Bubble[] {
    return bubbles.filter(
      (b) => b.channels.length === 0 || b.channels.includes(channel),
    );
  }

  /**
   * Translate a single bubble row to an OutboundMessage. The result is
   * channel-agnostic — adapters interpret the fields per their platform's API.
   *
   * NOTE: `channel` and `type` are set to placeholders; the sender service
   * fills them in before adapter dispatch. We don't know the channel at this
   * layer.
   */
  toOutboundMessage(bubble: Bubble, externalUserId: string): OutboundMessage {
    const base = {
      externalUserId,
      // placeholders — sender service replaces with the room's actual channel
      channel: undefined as any,
      type: undefined as any,
    };

    switch (bubble.type) {
      case 'TEXT':
        return { ...base, text: bubble.text ?? '' };
      case 'IMAGE':
        return {
          ...base,
          imageUrl: bubble.mediaUrl ?? '',
          thumbnailUrl: bubble.thumbnailUrl ?? undefined,
        };
      case 'STICKER':
        return {
          ...base,
          sticker:
            bubble.stickerPackageId && bubble.stickerId
              ? { packageId: bubble.stickerPackageId, stickerId: bubble.stickerId }
              : undefined,
        };
      case 'LOCATION':
        return {
          ...base,
          location: {
            title: bubble.locationTitle ?? '',
            address: bubble.address ?? '',
            latitude: bubble.latitude ?? 0,
            longitude: bubble.longitude ?? 0,
          },
        };
      case 'VIDEO':
        return {
          ...base,
          videoUrl: bubble.mediaUrl ?? '',
          thumbnailUrl: bubble.thumbnailUrl ?? undefined,
        };
      case 'CARD':
        // Stored as simplified JSON — LINE adapter wraps as Flex, FB adapter
        // translates to generic template.
        return { ...base, flexJson: bubble.json };
      case 'JSON':
        return { ...base, jsonPayload: bubble.json };
      default:
        return base;
    }
  }

  /** Convert quick-reply rows to the OutboundMessage.quickReplies shape. */
  translateQuickReplies(qrs: QuickReply[]): OutboundQuickReply[] {
    return qrs.map((q) => ({
      label: q.label,
      type: q.type,
      payload: q.payload ?? undefined,
      url: q.url ?? undefined,
      message: q.message ?? undefined,
    }));
  }
}
