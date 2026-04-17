/**
 * Sticker token format used between Unified Inbox UI and channel adapters.
 *
 * The frontend sends stickers as a plain text message of the form
 * `[sticker:<packageId>:<stickerId>]` because the chat protocol carries text
 * only. Channel adapters detect this token and translate it into a
 * platform-specific sticker payload (LINE sticker message, etc.). Inbound
 * webhooks re-encode customer stickers into the same token so MessageBubble
 * can render them as an animated image.
 */

const STICKER_RE = /^\[sticker:(\d+):(\d+)\]$/;

export interface ParsedSticker {
  packageId: string;
  stickerId: string;
}

export function parseStickerToken(text: string | null | undefined): ParsedSticker | null {
  if (!text) return null;
  const m = text.trim().match(STICKER_RE);
  if (!m) return null;
  return { packageId: m[1], stickerId: m[2] };
}

export function formatStickerToken(packageId: string | number, stickerId: string | number): string {
  return `[sticker:${packageId}:${stickerId}]`;
}
