import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { CHAT_EVENTS, CHAT_CLIENT_EVENTS, CHAT_ROOMS } from '../chat-engine/constants/chat-events';
import { MessageRouterService } from '../chat-engine/services/message-router.service';
import { SessionManagerService } from '../chat-engine/services/session-manager.service';
import { PresenceService } from './services/presence.service';

/**
 * Staff Chat WebSocket Gateway — the /chat namespace.
 *
 * Handles real-time communication between staff members and the chat system.
 * Staff connect via socket.io, join rooms for sessions they're monitoring,
 * and receive live updates when customers send messages.
 *
 * Authentication: JWT token passed in handshake auth or query params.
 * Rooms:
 * - chat:inbox — all staff see new/updated sessions
 * - chat:session:{id} — per-session room for messages
 * - chat:staff:{userId} — personal notifications
 */
@WebSocketGateway({
  namespace: '/chat',
  cors: { origin: '*', credentials: true },
})
export class StaffChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(StaffChatGateway.name);

  constructor(
    private messageRouter: MessageRouterService,
    private sessionManager: SessionManagerService,
    private presenceService: PresenceService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    // Verify JWT from handshake auth.token (sent by frontend)
    const token = client.handshake.auth?.token as string;
    if (!token) {
      this.logger.warn('[WS] Connection rejected — no token in handshake');
      client.disconnect();
      return;
    }

    let userId: string;
    let userName: string;
    try {
      const payload = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });
      userId = payload.sub;
      userName = payload.name ?? 'staff';
      // Attach to socket data for later use
      (client as any).userId = userId;
      (client as any).userName = userName;
    } catch {
      this.logger.warn('[WS] Connection rejected — invalid JWT');
      client.disconnect();
      return;
    }

    // Track presence
    this.presenceService.setOnline(userId, client.id);

    // Join personal room and inbox
    client.join(CHAT_ROOMS.staff(userId));
    client.join(CHAT_ROOMS.INBOX);

    // Broadcast presence to other staff
    this.server.to(CHAT_ROOMS.INBOX).emit(CHAT_EVENTS.PRESENCE, {
      userId,
      userName,
      status: 'online',
    });

    this.logger.log(`[WS] Staff connected: ${userName} (${userId})`);
  }

  async handleDisconnect(client: Socket): Promise<void> {
    const userId = (client as any).userId as string;
    if (!userId) return;

    this.presenceService.setOffline(userId, client.id);

    // Only broadcast offline if no more connections from this user
    if (!this.presenceService.isOnline(userId)) {
      this.server.to(CHAT_ROOMS.INBOX).emit(CHAT_EVENTS.PRESENCE, {
        userId,
        status: 'offline',
      });
    }

    this.logger.log(`[WS] Staff disconnected: ${userId}`);
  }

  @SubscribeMessage(CHAT_CLIENT_EVENTS.JOIN)
  handleJoinSession(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string },
  ): void {
    client.join(CHAT_ROOMS.session(data.sessionId));
    this.logger.debug(`[WS] ${(client as any).userId} joined session ${data.sessionId}`);
  }

  @SubscribeMessage(CHAT_CLIENT_EVENTS.LEAVE)
  handleLeaveSession(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string },
  ): void {
    client.leave(CHAT_ROOMS.session(data.sessionId));
  }

  @SubscribeMessage(CHAT_CLIENT_EVENTS.SEND)
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string; text: string },
  ): Promise<void> {
    const userId = (client as any).userId as string;
    if (!userId || !data.sessionId || !data.text) return;

    // Send through engine (saves message + sends to customer via adapter)
    await this.messageRouter.sendStaffMessage({
      sessionId: data.sessionId,
      staffId: userId,
      text: data.text,
    });

    // Broadcast to all staff in the session room
    this.server.to(CHAT_ROOMS.session(data.sessionId)).emit(CHAT_EVENTS.MESSAGE_NEW, {
      sessionId: data.sessionId,
      role: 'STAFF',
      staffId: userId,
      text: data.text,
      createdAt: new Date().toISOString(),
    });
  }

  @SubscribeMessage(CHAT_CLIENT_EVENTS.TYPING_START)
  handleTypingStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string },
  ): void {
    const userId = (client as any).userId as string;
    client.to(CHAT_ROOMS.session(data.sessionId)).emit(CHAT_EVENTS.TYPING, {
      sessionId: data.sessionId,
      userId,
      isTyping: true,
    });
  }

  @SubscribeMessage(CHAT_CLIENT_EVENTS.TYPING_STOP)
  handleTypingStop(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string },
  ): void {
    const userId = (client as any).userId as string;
    client.to(CHAT_ROOMS.session(data.sessionId)).emit(CHAT_EVENTS.TYPING, {
      sessionId: data.sessionId,
      userId,
      isTyping: false,
    });
  }

  @SubscribeMessage(CHAT_CLIENT_EVENTS.READ)
  async handleMarkRead(
    @ConnectedSocket() _client: Socket,
    @MessageBody() data: { sessionId: string },
  ): Promise<void> {
    // Mark all unread messages in this session as read
    // This is a UI-level action — actual DB update is light
    this.logger.debug(`[WS] Mark read: session ${data.sessionId}`);
  }

  // ─── Public methods for other services to emit events ──────

  /** Notify staff about a new customer message (called by MessageRouter) */
  emitNewMessage(sessionId: string, payload: Record<string, unknown>): void {
    this.server?.to(CHAT_ROOMS.session(sessionId)).emit(CHAT_EVENTS.MESSAGE_NEW, payload);
    this.server?.to(CHAT_ROOMS.INBOX).emit(CHAT_EVENTS.SESSION_UPDATE, {
      sessionId,
      ...payload,
    });
  }

  /** Notify staff about session state change (assignment, status, etc.) */
  emitSessionUpdate(sessionId: string, payload: Record<string, unknown>): void {
    this.server?.to(CHAT_ROOMS.session(sessionId)).emit(CHAT_EVENTS.SESSION_UPDATE, payload);
    this.server?.to(CHAT_ROOMS.INBOX).emit(CHAT_EVENTS.SESSION_UPDATE, payload);
  }

  /** Notify a specific staff member */
  emitToStaff(staffId: string, event: string, payload: Record<string, unknown>): void {
    this.server?.to(CHAT_ROOMS.staff(staffId)).emit(event, payload);
  }
}
