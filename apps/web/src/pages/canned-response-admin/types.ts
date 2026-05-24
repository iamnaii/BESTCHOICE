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
  createdAt: string;
}

export interface CannedResponse {
  id: string;
  shortcut: string;
  title: string;
  content: string;
  category: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  bubbles?: CannedResponseBubble[];
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
