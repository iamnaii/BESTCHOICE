/**
 * LINE Webhook event types สำหรับ Finance Bot
 * (subset ที่ใช้จริง — รองรับเพิ่มได้ภายหลัง)
 */

export interface LineFinanceWebhookBody {
  destination: string;
  events: LineFinanceWebhookEvent[];
}

export type LineFinanceWebhookEvent =
  | LineMessageEvent
  | LineFollowEvent
  | LineUnfollowEvent
  | LinePostbackEvent;

export interface LineEventBase {
  type: string;
  mode: string;
  timestamp: number;
  source: LineEventSource;
  webhookEventId: string;
  deliveryContext: { isRedelivery: boolean };
  replyToken?: string;
}

export interface LineEventSource {
  type: 'user' | 'group' | 'room';
  userId?: string;
  groupId?: string;
  roomId?: string;
}

export interface LineMessageEvent extends LineEventBase {
  type: 'message';
  replyToken: string;
  message: LineMessageContent;
}

export type LineMessageContent =
  | { id: string; type: 'text'; text: string }
  | { id: string; type: 'image'; contentProvider: { type: string } }
  | { id: string; type: 'audio'; duration: number; contentProvider: { type: string } }
  | { id: string; type: 'video'; duration: number; contentProvider: { type: string } }
  | { id: string; type: 'file'; fileName: string; fileSize: number }
  | { id: string; type: 'sticker'; packageId: string; stickerId: string };

export interface LineFollowEvent extends LineEventBase {
  type: 'follow';
  replyToken: string;
}

export interface LineUnfollowEvent extends LineEventBase {
  type: 'unfollow';
}

export interface LinePostbackEvent extends LineEventBase {
  type: 'postback';
  replyToken: string;
  postback: { data: string; params?: Record<string, string> };
}
