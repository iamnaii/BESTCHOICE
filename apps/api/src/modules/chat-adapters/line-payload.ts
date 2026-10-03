import type {
  OutboundMessage,
  OutboundQuickReply,
} from '../chat-engine/interfaces/channel-adapter.interface';
import { parseStickerToken } from '../chat-engine/utils/sticker-token.util';

/** Payload priority and quick replies shared by both LINE channels. */
export function buildLinePayload(message: OutboundMessage): Record<string, unknown> | undefined {
  const quickReply =
    message.quickReplies && message.quickReplies.length > 0
      ? { items: buildLineQuickReplyItems(message.quickReplies) }
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

function buildLineQuickReplyItems(qrs: OutboundQuickReply[]): Array<Record<string, unknown>> {
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
