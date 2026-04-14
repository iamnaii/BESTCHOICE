/**
 * IChatGateway — interface for the WebSocket gateway.
 *
 * Allows chat-engine services to emit real-time events without
 * directly depending on the StaffChatGateway (avoids circular deps).
 */
export interface IChatGateway {
  emitNewMessage(sessionId: string, payload: Record<string, unknown>): void;
  emitSessionUpdate(sessionId: string, payload: Record<string, unknown>): void;
  emitToStaff(staffId: string, event: string, payload: Record<string, unknown>): void;
}

export const CHAT_GATEWAY_TOKEN = 'CHAT_GATEWAY';
