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
import { SessionManagerService } from '../chat-engine/services/session-manager.service';
import { MessageRouterService } from '../chat-engine/services/message-router.service';
import { CHAT_EVENTS, CHAT_ROOMS } from '../chat-engine/constants/chat-events';

/** Room naming for the /widget namespace */
const WIDGET_ROOMS = {
  session: (sessionId: string) => `widget:session:${sessionId}`,
} as const;

/**
 * WebWidgetGateway — the /widget namespace for anonymous website visitors.
 *
 * No authentication required. Visitors get a visitorId (from query param or auto-generated UUID)
 * and a ChatSession with channel=WEB. Messages are stored and forwarded to the staff inbox.
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
    private sessionManager: SessionManagerService,
    private messageRouter: MessageRouterService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      // 1. Generate visitorId from query param or UUID
      const visitorId = (client.handshake.query?.visitorId as string) || uuidv4();

      // 2. Get or create ChatSession with channel=WEB
      const session = await this.sessionManager.getOrCreateSession({
        externalUserId: visitorId,
        channel: ChatChannel.WEB,
      });

      // 3. Store sessionId and visitorId on client for later use
      (client as any).sessionId = session.id;
      (client as any).visitorId = visitorId;

      // 4. Join widget session room
      client.join(WIDGET_ROOMS.session(session.id));

      // 5. Send session info back to the client
      client.emit('widget:connected', {
        sessionId: session.id,
        visitorId,
      });

      // 6. Send welcome message if new session (no messages yet)
      if (session.totalMessages === 0) {
        const welcomeText = 'สวัสดีครับ/ค่ะ ยินดีต้อนรับสู่ BESTCHOICE มีอะไรให้ช่วยเหลือไหมครับ?';

        await this.sessionManager.saveMessage({
          sessionId: session.id,
          role: MessageRole.BOT,
          text: welcomeText,
        });

        client.emit('widget:message', {
          sessionId: session.id,
          role: 'BOT',
          text: welcomeText,
          createdAt: new Date().toISOString(),
        });
      }

      this.logger.log(`[Widget] Visitor connected: ${visitorId} → session ${session.id}`);
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
    const sessionId = (client as any).sessionId as string;
    if (!sessionId || !data?.text?.trim()) return;

    const text = data.text.trim();

    // 1. Save message as CUSTOMER role
    const msg = await this.sessionManager.saveMessage({
      sessionId,
      role: MessageRole.CUSTOMER,
      text,
    });

    // 2. Emit back to widget room for confirmation
    this.server.to(WIDGET_ROOMS.session(sessionId)).emit('widget:message', {
      sessionId,
      role: 'CUSTOMER',
      text,
      createdAt: msg.createdAt.toISOString(),
    });

    // 3. Notify staff inbox via the staff chat room
    // StaffChatGateway listens on CHAT_ROOMS — emit to session + inbox
    // Note: We emit on the /chat namespace indirectly through the shared event system.
    // The staff gateway's emitNewMessage method is the proper way, but since we can't
    // inject StaffChatGateway (circular dep), we save the message and staff will see it
    // when they load/refresh the session. For real-time, a future enhancement can use
    // a shared EventEmitter or the StaffChatGateway.emitNewMessage() method.
    this.logger.debug(`[Widget] Message saved for session ${sessionId}: ${text.substring(0, 50)}`);
  }

  @SubscribeMessage('widget:typing')
  handleTyping(
    @ConnectedSocket() client: Socket,
  ): void {
    const sessionId = (client as any).sessionId as string;
    if (!sessionId) return;

    // Emit typing indicator to staff session room (cross-namespace via shared naming)
    // Staff on /chat namespace join rooms like chat:session:{id}
    this.logger.debug(`[Widget] Typing indicator for session ${sessionId}`);
  }

  // ─── Public methods for staff gateway to push messages to widget ──────

  /** Send a staff reply to the widget visitor */
  emitToWidget(sessionId: string, payload: Record<string, unknown>): void {
    this.server?.to(WIDGET_ROOMS.session(sessionId)).emit('widget:message', payload);
  }
}
