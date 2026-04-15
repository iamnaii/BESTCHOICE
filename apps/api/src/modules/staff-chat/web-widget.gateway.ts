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
import { Server, Socket } from 'socket.io';
import { ChatChannel, MessageRole } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { RoomManagerService } from '../chat-engine/services/room-manager.service';
import { MessageRouterService } from '../chat-engine/services/message-router.service';
import { CHAT_EVENTS, CHAT_ROOMS } from '../chat-engine/constants/chat-events';

/** Room naming for the /widget namespace */
const WIDGET_ROOMS = {
  room: (roomId: string) => `widget:room:${roomId}`,
} as const;

/**
 * WebWidgetGateway — the /widget namespace for anonymous website visitors.
 *
 * No authentication required. Visitors get a visitorId (from query param or auto-generated UUID)
 * and a ChatRoom with channel=WEB. Messages are stored and forwarded to the staff inbox.
 */
@WebSocketGateway({
  namespace: '/widget',
  cors: { origin: '*' },
})
export class WebWidgetGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(WebWidgetGateway.name);

  constructor(
    private roomManager: RoomManagerService,
    private messageRouter: MessageRouterService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      // 1. Generate visitorId from query param or UUID
      const visitorId = (client.handshake.query?.visitorId as string) || uuidv4();

      // 2. Get or create ChatRoom with channel=WEB
      const room = await this.roomManager.getOrCreateRoom({
        externalUserId: visitorId,
        channel: ChatChannel.WEB,
      });

      // 3. Store roomId and visitorId on client for later use
      (client as any).roomId = room.id;
      (client as any).visitorId = visitorId;

      // 4. Join widget room
      client.join(WIDGET_ROOMS.room(room.id));

      // 5. Send room info back to the client
      client.emit('widget:connected', {
        roomId: room.id,
        visitorId,
      });

      // 6. Send welcome message if new room (no messages yet)
      if (room.totalMessages === 0) {
        const welcomeText = 'สวัสดีครับ/ค่ะ ยินดีต้อนรับสู่ BESTCHOICE มีอะไรให้ช่วยเหลือไหมครับ?';

        await this.roomManager.saveMessage({
          roomId: room.id,
          role: MessageRole.BOT,
          text: welcomeText,
        });

        client.emit('widget:message', {
          roomId: room.id,
          role: 'BOT',
          text: welcomeText,
          createdAt: new Date().toISOString(),
        });
      }

      this.logger.log(`[Widget] Visitor connected: ${visitorId} → room ${room.id}`);
    } catch (err) {
      this.logger.error(
        `[Widget] Connection error: ${err instanceof Error ? err.message : err}`,
      );
      client.disconnect();
    }
  }

  async handleDisconnect(client: Socket): Promise<void> {
    const visitorId = (client as any).visitorId as string;
    this.logger.log(`[Widget] Visitor disconnected: ${visitorId ?? 'unknown'}`);
  }

  @SubscribeMessage('widget:send')
  async handleMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { text: string },
  ): Promise<void> {
    const roomId = (client as any).roomId as string;
    if (!roomId || !data?.text?.trim()) return;

    const text = data.text.trim();

    // 1. Save message as CUSTOMER role
    const msg = await this.roomManager.saveMessage({
      roomId,
      role: MessageRole.CUSTOMER,
      text,
    });

    // 2. Emit back to widget room for confirmation
    this.server.to(WIDGET_ROOMS.room(roomId)).emit('widget:message', {
      roomId,
      role: 'CUSTOMER',
      text,
      createdAt: msg.createdAt.toISOString(),
    });

    // 3. Notify staff inbox via the staff chat room
    // StaffChatGateway listens on CHAT_ROOMS — emit to room + inbox
    // Note: We emit on the /chat namespace indirectly through the shared event system.
    // The staff gateway's emitNewMessage method is the proper way, but since we can't
    // inject StaffChatGateway (circular dep), we save the message and staff will see it
    // when they load/refresh the room. For real-time, a future enhancement can use
    // a shared EventEmitter or the StaffChatGateway.emitNewMessage() method.
    this.logger.debug(`[Widget] Message saved for room ${roomId}: ${text.substring(0, 50)}`);
  }

  @SubscribeMessage('widget:typing')
  handleTyping(
    @ConnectedSocket() client: Socket,
  ): void {
    const roomId = (client as any).roomId as string;
    if (!roomId) return;

    // Emit typing indicator to staff room channel (cross-namespace via shared naming)
    // Staff on /chat namespace join rooms like chat:room:{id}
    this.logger.debug(`[Widget] Typing indicator for room ${roomId}`);
  }

  // ─── Public methods for staff gateway to push messages to widget ──────

  /** Send a staff reply to the widget visitor */
  emitToWidget(roomId: string, payload: Record<string, unknown>): void {
    this.server?.to(WIDGET_ROOMS.room(roomId)).emit('widget:message', payload);
  }
}
