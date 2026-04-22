import api from '@/lib/api';

export type ChatChannelValue = 'LINE_FINANCE' | 'LINE_SHOP' | 'FACEBOOK' | 'TIKTOK' | 'WEB';

/**
 * ChatRoomSummary — projection of ChatRoom used in the unified inbox list.
 * Matches the include shape returned by `GET /staff-chat/rooms`
 * (`RoomManagerService.listRooms`). Most fields come from the ChatRoom row
 * directly; `customer`, `assignedTo`, `messages` are nested via Prisma include.
 */
export interface ChatRoomSummary {
  id: string;
  customerId: string | null;
  lineUserId: string | null;
  externalUserId: string | null;
  displayName: string | null;
  pictureUrl: string | null;
  channel: ChatChannelValue;
  status: 'ACTIVE' | 'IDLE';
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
  handoffMode: boolean;
  handoffReason: string | null;
  aiPaused: boolean;
  firstResponseAt: string | null;
  unreadCount: number;
  lastMessageAt: string;
  customer: { id: string; name: string | null; phone: string | null } | null;
  assignedTo: { id: string; name: string | null; avatarUrl: string | null } | null;
  messages: Array<{ text: string | null; role: string; createdAt: string }>;
}

export interface ChatRoomListResponse {
  data: ChatRoomSummary[];
  total: number;
  page: number;
  limit: number;
}

export type RoomFilter = 'all' | 'sales' | 'service' | 'handoff' | 'sla_breach';
export type ChannelFilter = 'all' | 'LINE_FINANCE' | 'FACEBOOK';

/**
 * Fetch rooms for the unified inbox.
 * The `filter` prop is client-side only for now — Task 11 keeps server params
 * minimal (channel + search). SLA/handoff filtering is applied client-side
 * in `useRooms` until a server-side index is added.
 */
export async function fetchRooms(params: {
  filter: RoomFilter;
  channel: ChannelFilter;
  q?: string;
}): Promise<ChatRoomListResponse> {
  const query: Record<string, string> = {};
  if (params.channel !== 'all') query.channel = params.channel;
  if (params.q) query.search = params.q;
  const res = await api.get<ChatRoomListResponse>('/staff-chat/rooms', { params: query });
  return res.data;
}

export async function fetchMessages(roomId: string) {
  const res = await api.get(`/staff-chat/rooms/${roomId}/messages`);
  return res.data;
}

export async function approveDraft(draftMessageId: string, editedText?: string) {
  return api.post('/chat-ai/approve', { draftMessageId, editedText });
}

export async function skipDraft(draftMessageId: string) {
  return api.post(`/chat-ai/skip/${draftMessageId}`);
}

export async function takeOver(roomId: string) {
  return api.post(`/chat-ai/take-over/${roomId}`);
}

export async function sendStaffMessage(roomId: string, text: string) {
  return api.post(`/staff-chat/rooms/${roomId}/messages`, { text });
}
