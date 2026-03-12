/**
 * LINE Webhook Event Types
 * Based on LINE Messaging API webhook event types
 */

export interface LineWebhookBody {
  destination: string;
  events: LineWebhookEvent[];
}

export type LineWebhookEvent =
  | LineMessageEvent
  | LineFollowEvent
  | LineUnfollowEvent
  | LinePostbackEvent;

export interface LineEventBase {
  type: string;
  mode: string;
  timestamp: number;
  source: LineSource;
  webhookEventId: string;
  deliveryContext: { isRedelivery: boolean };
  replyToken: string;
}

export interface LineSource {
  type: 'user' | 'group' | 'room';
  userId: string;
  groupId?: string;
  roomId?: string;
}

// ─── Message Events ─────────────────────────────────────

export interface LineMessageEvent extends LineEventBase {
  type: 'message';
  message: LineTextMessage | LineImageMessage | LineStickerMessage;
}

export interface LineTextMessage {
  type: 'text';
  id: string;
  text: string;
}

export interface LineImageMessage {
  type: 'image';
  id: string;
  contentProvider: {
    type: 'line' | 'external';
    originalContentUrl?: string;
    previewImageUrl?: string;
  };
}

export interface LineStickerMessage {
  type: 'sticker';
  id: string;
  packageId: string;
  stickerId: string;
}

// ─── Follow/Unfollow Events ─────────────────────────────

export interface LineFollowEvent extends LineEventBase {
  type: 'follow';
}

export interface LineUnfollowEvent extends LineEventBase {
  type: 'unfollow';
}

// ─── Postback Event ─────────────────────────────────────

export interface LinePostbackEvent extends LineEventBase {
  type: 'postback';
  postback: {
    data: string;
    params?: Record<string, string>;
  };
}

// ─── LINE Message Types (for sending) ───────────────────

export interface LineTextMessagePayload {
  type: 'text';
  text: string;
}

export interface LineFlexMessagePayload {
  type: 'flex';
  altText: string;
  contents: unknown;
}

export type LineMessagePayload = LineTextMessagePayload | LineFlexMessagePayload;
