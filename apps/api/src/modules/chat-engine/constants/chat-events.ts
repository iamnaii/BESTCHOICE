/**
 * WebSocket event names for the /chat namespace.
 * Used by StaffChatGateway (Phase 2 Agent C) and frontend hooks.
 */

// Server → Client events
export const CHAT_EVENTS = {
  /** New message in a room */
  MESSAGE_NEW: 'chat:message:new',
  /** Room state changed (status, priority, assignment) */
  ROOM_UPDATE: 'chat:room:update',
  /** Someone is typing */
  TYPING: 'chat:typing',
  /** Staff presence changed (online/offline) */
  PRESENCE: 'chat:presence',
  /** Room assigned to a staff member */
  ASSIGNED: 'chat:assigned',
  /** Room resolved (marked IDLE) */
  RESOLVED: 'chat:resolved',
  /** New note added to room */
  NOTE_ADDED: 'chat:note:added',
  /** Current viewers of a room */
  VIEWERS: 'chat:viewers',
  /** Collision warning — another staff is viewing the same room */
  COLLISION_WARNING: 'chat:collision',
} as const;

// Client → Server events
export const CHAT_CLIENT_EVENTS = {
  /** Staff sends a message */
  SEND: 'chat:send',
  /** Staff starts typing */
  TYPING_START: 'chat:typing:start',
  /** Staff stops typing */
  TYPING_STOP: 'chat:typing:stop',
  /** Staff joins a room */
  JOIN: 'chat:join',
  /** Staff leaves a room */
  LEAVE: 'chat:leave',
  /** Staff marks messages as read */
  READ: 'chat:read',
  /** Staff opens/views a room (for collision detection) */
  VIEW_ROOM: 'chat:view',
} as const;

// WebSocket room naming
export const CHAT_ROOMS = {
  /** Global inbox room — all staff see new rooms */
  INBOX: 'chat:inbox',
  /** Per-room channel */
  room: (roomId: string) => `chat:room:${roomId}`,
  /** Per-staff room — direct notifications */
  staff: (userId: string) => `chat:staff:${userId}`,
} as const;
