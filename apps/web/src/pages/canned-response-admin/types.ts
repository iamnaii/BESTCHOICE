export type BubbleType = 'TEXT' | 'IMAGE' | 'STICKER';

export interface CannedResponseBubble {
  id: string;
  cannedResponseId: string;
  type: BubbleType;
  sortOrder: number;
  text: string | null;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  stickerPackageId: string | null;
  stickerId: string | null;
  channels: string[]; // empty = all
  createdAt: string;
}

export type QuickReplyType = 'POSTBACK' | 'URL' | 'MESSAGE';

export interface CannedResponseQuickReply {
  id: string;
  cannedResponseId: string;
  label: string;
  type: QuickReplyType;
  payload: string | null;
  url: string | null;
  message: string | null;
  sortOrder: number;
  createdAt: string;
}

export type Channel = 'LINE_FINANCE' | 'LINE_SHOP' | 'FACEBOOK' | 'INSTAGRAM' | 'TIKTOK' | 'WEB';
export const ALL_CHANNELS: Channel[] = ['LINE_FINANCE', 'LINE_SHOP', 'FACEBOOK', 'INSTAGRAM', 'TIKTOK', 'WEB'];
export const CHANNEL_LABELS: Record<Channel, string> = {
  LINE_FINANCE: 'LINE การเงิน',
  LINE_SHOP: 'LINE ร้าน',
  FACEBOOK: 'Facebook',
  INSTAGRAM: 'Instagram',
  TIKTOK: 'TikTok',
  WEB: 'Web Widget',
};

export interface CannedResponse {
  id: string;
  shortcut: string;
  title: string;
  content: string;
  category: string | null;
  sortOrder: number;
  isActive: boolean;
  hideFromChat?: boolean;
  verifiedOnly?: boolean;
  createdAt: string;
  bubbles?: CannedResponseBubble[];
  quickReplies?: CannedResponseQuickReply[];
}

export interface ReorderItem {
  id: string;
  sortOrder: number;
  category: string | null;
}

/** A grouped category in the tree */
export interface CategoryGroup {
  name: string; // "อื่นๆ" for null
  items: CannedResponse[]; // sorted by sortOrder asc
}
