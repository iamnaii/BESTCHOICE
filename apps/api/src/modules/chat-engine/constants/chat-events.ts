/**
 * WebSocket event names for the /chat namespace.
 * Used by StaffChatGateway (Phase 2 Agent C) and frontend hooks.
 */

// Server → Client events
export const CHAT_EVENTS = {
  /** New message in a session */
  MESSAGE_NEW: 'chat:message:new',
  /** Session state changed (status, priority, assignment) */
  SESSION_UPDATE: 'chat:session:update',
  /** Someone is typing */
  TYPING: 'chat:typing',
  /** Staff presence changed (online/offline) */
  PRESENCE: 'chat:presence',
  /** Session assigned to a staff member */
  ASSIGNED: 'chat:assigned',
  /** Session resolved */
  RESOLVED: 'chat:resolved',
  /** New note added to session */
  NOTE_ADDED: 'chat:note:added',
  /** Current viewers of a session */
  VIEWERS: 'chat:viewers',
  /** Collision warning — another staff is viewing the same session */
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
  /** Staff joins a session room */
  JOIN: 'chat:join',
  /** Staff leaves a session room */
  LEAVE: 'chat:leave',
  /** Staff marks messages as read */
  READ: 'chat:read',
  /** Staff opens/views a session (for collision detection) */
  VIEW_SESSION: 'chat:view',
} as const;

// WebSocket room naming
export const CHAT_ROOMS = {
  /** Global inbox room — all staff see new sessions */
  INBOX: 'chat:inbox',
  /** Per-session room */
  session: (sessionId: string) => `chat:session:${sessionId}`,
  /** Per-staff room — direct notifications */
  staff: (userId: string) => `chat:staff:${userId}`,
} as const;
