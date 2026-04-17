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
import { RoomManagerService } from '../chat-engine/services/room-manager.service';
import { PresenceService } from './services/presence.service';
import { CollisionDetectionService } from './services/collision-detection.service';
import { LeadScoringService } from './services/lead-scoring.service';

/**
 * Staff Chat WebSocket Gateway — the /chat namespace.
 *
 * Handles real-time communication between staff members and the chat system.
 * Staff connect via socket.io, join rooms for sessions they're monitoring,
 * and receive live updates when customers send messages.
 *
 * Authentication: JWT token passed in handshake auth or query params.
 * Rooms:
 * - chat:inbox — all staff see new/updated rooms
 * - chat:room:{id} — per-room channel for messages
 * - chat:staff:{userId} — personal notifications
 */
@WebSocketGateway({
  namespace: '/chat',
  cors: {
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean | string) => void,
    ) => {
      if (!origin) return callback(null, true);
      const allowed = (process.env.FRONTEND_URL || 'http://localhost:5173')
        .split(',')
        .map((o) => o.trim());
      if (!allowed.includes('https://bestchoicephone.app')) {
        allowed.push('https://bestchoicephone.app');
      }
      if (allowed.includes(origin)) return callback(null, origin);
      callback(null, false);
    },
    credentials: true,
  },
})
export class StaffChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(StaffChatGateway.name);

  constructor(
    private messageRouter: MessageRouterService,
    private roomManager: RoomManagerService,
    private presenceService: PresenceService,
    private collisionDetectionService: CollisionDetectionService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private leadScoring: LeadScoringService,
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

    // Clean up collision detection viewers for this user
    this.collisionDetectionService.removeViewerFromAll(userId);

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
  handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string },
  ): void {
    client.join(CHAT_ROOMS.room(data.roomId));
    this.logger.debug(`[WS] ${(client as any).userId} joined room ${data.roomId}`);
  }

  @SubscribeMessage(CHAT_CLIENT_EVENTS.LEAVE)
  handleLeaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string },
  ): void {
    const userId = (client as any).userId as string;
    client.leave(CHAT_ROOMS.room(data.roomId));

    // Remove from collision detection
    if (userId) {
      this.collisionDetectionService.removeViewer(data.roomId, userId);

      // Broadcast updated viewer list to remaining viewers
      const viewers = this.collisionDetectionService.getViewers(data.roomId);
      this.server.to(CHAT_ROOMS.room(data.roomId)).emit(CHAT_EVENTS.VIEWERS, {
        roomId: data.roomId,
        viewers,
      });
    }
  }

  @SubscribeMessage(CHAT_CLIENT_EVENTS.SEND)
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; text: string },
  ): Promise<void> {
    const userId = (client as any).userId as string;
    if (!userId || !data.roomId || !data.text) return;

    // Warn if another staff is also viewing this room
    if (this.collisionDetectionService.isCollision(data.roomId, userId)) {
      const viewers = this.collisionDetectionService.getViewers(data.roomId);
      client.emit(CHAT_EVENTS.COLLISION_WARNING, {
        roomId: data.roomId,
        viewers: viewers.filter((v) => v.userId !== userId),
      });
    }

    // Send through engine (saves message + sends to customer via adapter)
    await this.messageRouter.sendStaffMessage({
      roomId: data.roomId,
      staffId: userId,
      text: data.text,
    });

    // Broadcast to all staff in the room
    this.server.to(CHAT_ROOMS.room(data.roomId)).emit(CHAT_EVENTS.MESSAGE_NEW, {
      roomId: data.roomId,
      role: 'STAFF',
      staffId: userId,
      text: data.text,
      createdAt: new Date().toISOString(),
    });

    // Auto-update lead score after new message
    this.leadScoring.scoreSession(data.roomId).catch((err) =>
      this.logger.error('Lead scoring failed', err),
    );
  }

  @SubscribeMessage(CHAT_CLIENT_EVENTS.TYPING_START)
  handleTypingStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string },
  ): void {
    const userId = (client as any).userId as string;
    client.to(CHAT_ROOMS.room(data.roomId)).emit(CHAT_EVENTS.TYPING, {
      roomId: data.roomId,
      userId,
      isTyping: true,
    });
  }

  @SubscribeMessage(CHAT_CLIENT_EVENTS.TYPING_STOP)
  handleTypingStop(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string },
  ): void {
    const userId = (client as any).userId as string;
    client.to(CHAT_ROOMS.room(data.roomId)).emit(CHAT_EVENTS.TYPING, {
      roomId: data.roomId,
      userId,
      isTyping: false,
    });
  }

  @SubscribeMessage(CHAT_CLIENT_EVENTS.READ)
  async handleMarkRead(
    @ConnectedSocket() _client: Socket,
    @MessageBody() data: { roomId: string },
  ): Promise<void> {
    if (!data.roomId) return;
    const now = new Date();
    const result = await this.roomManager.markMessagesRead(data.roomId, now);
    this.logger.debug(`[WS] Mark read: room ${data.roomId} (${result.count} messages)`);
  }

  @SubscribeMessage(CHAT_CLIENT_EVENTS.VIEW_ROOM)
  handleViewRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string },
  ): void {
    const userId = (client as any).userId as string;
    const userName = (client as any).userName as string;
    if (!userId || !data.roomId) return;

    // Track this viewer
    this.collisionDetectionService.addViewer(data.roomId, userId, userName);

    // Get all current viewers
    const viewers = this.collisionDetectionService.getViewers(data.roomId);

    // Broadcast viewer list to everyone in the room
    this.server.to(CHAT_ROOMS.room(data.roomId)).emit(CHAT_EVENTS.VIEWERS, {
      roomId: data.roomId,
      viewers,
    });

    // If collision detected, send warning to the joining user
    if (this.collisionDetectionService.isCollision(data.roomId, userId)) {
      client.emit(CHAT_EVENTS.COLLISION_WARNING, {
        roomId: data.roomId,
        viewers: viewers.filter((v) => v.userId !== userId),
      });
    }
  }

  // ─── Public methods for other services to emit events ──────

  /** Notify staff about a new customer message (called by MessageRouter) */
  emitNewMessage(roomId: string, payload: Record<string, unknown>): void {
    this.server?.to(CHAT_ROOMS.room(roomId)).emit(CHAT_EVENTS.MESSAGE_NEW, payload);
    this.server?.to(CHAT_ROOMS.INBOX).emit(CHAT_EVENTS.ROOM_UPDATE, {
      roomId,
      ...payload,
    });
  }

  /** Notify staff about room state change (assignment, status, etc.) */
  emitRoomUpdate(roomId: string, payload: Record<string, unknown>): void {
    this.server?.to(CHAT_ROOMS.room(roomId)).emit(CHAT_EVENTS.ROOM_UPDATE, payload);
    this.server?.to(CHAT_ROOMS.INBOX).emit(CHAT_EVENTS.ROOM_UPDATE, payload);
  }

  /** Notify a specific staff member */
  emitToStaff(staffId: string, event: string, payload: Record<string, unknown>): void {
    this.server?.to(CHAT_ROOMS.staff(staffId)).emit(event, payload);
  }
}
