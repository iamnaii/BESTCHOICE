import { Injectable, Logger } from '@nestjs/common';
import { MessageRole } from '@prisma/client';
import {
  LineFinanceWebhookEvent,
  LineMessageEvent,
  LineFollowEvent,
} from '../dto/line-webhook.dto';
import { LineFinanceClientService } from './line-finance-client.service';
import { ChatSessionService } from './chat-session.service';

/**
 * Orchestration สำหรับ Finance Bot
 * Phase A1: ตอบ greeting + log Group ID + echo (skeleton)
 * Phase A2+ จะเพิ่ม: AI service, verification, tools, vision
 */
@Injectable()
export class ChatbotFinanceService {
  private readonly logger = new Logger(ChatbotFinanceService.name);

  constructor(
    private lineClient: LineFinanceClientService,
    private sessions: ChatSessionService,
  ) {}

  async handleEvent(event: LineFinanceWebhookEvent): Promise<void> {
    // Log Group ID เมื่อได้รับ event จาก group (เพื่อ setup staff notifications)
    if (event.source.type === 'group' && event.source.groupId) {
      this.logger.log(`📌 GROUP EVENT — groupId: ${event.source.groupId}`);
    }
    if (event.source.type === 'room' && event.source.roomId) {
      this.logger.log(`📌 ROOM EVENT — roomId: ${event.source.roomId}`);
    }

    switch (event.type) {
      case 'message':
        return this.handleMessage(event);
      case 'follow':
        return this.handleFollow(event);
      case 'unfollow':
        this.logger.log(`User unfollowed: ${event.source.userId}`);
        return;
      case 'postback':
        this.logger.log(`Postback: ${(event as { postback: { data: string } }).postback.data}`);
        return;
      default:
        this.logger.debug(`Unhandled event type: ${(event as { type: string }).type}`);
    }
  }

  private async handleFollow(event: LineFollowEvent): Promise<void> {
    const userId = event.source.userId;
    if (!userId) return;

    const session = await this.sessions.getOrCreate(userId);
    await this.sessions.saveMessage({
      sessionId: session.id,
      role: MessageRole.SYSTEM,
      text: '[follow event]',
    });

    // Greeting (Phase A1 placeholder — Phase B จะใช้ AI + persona น้องเบส)
    const greeting =
      'สวัสดีค่ะ 😊 น้องเบสยินดีให้บริการนะคะ\n' +
      'เพื่อความปลอดภัย ขอเบอร์โทรที่ลงทะเบียนไว้กับ BESTCHOICE ด้วยนะคะ';

    await this.lineClient.replyText(event.replyToken, greeting);
    await this.sessions.saveMessage({
      sessionId: session.id,
      role: MessageRole.BOT,
      text: greeting,
    });
  }

  private async handleMessage(event: LineMessageEvent): Promise<void> {
    const userId = event.source.userId;

    // ข้อความใน group/room — ใช้สำหรับเก็บ groupId เท่านั้นใน Phase A1
    if (!userId || event.source.type !== 'user') {
      this.logger.debug(`Skip non-user message (type=${event.source.type})`);
      return;
    }

    const session = await this.sessions.getOrCreate(userId);

    // บันทึก customer message
    if (event.message.type === 'text') {
      await this.sessions.saveMessage({
        sessionId: session.id,
        role: MessageRole.CUSTOMER,
        text: event.message.text,
      });

      // Phase A1: echo + ack (skeleton)
      // Phase A2 จะแทนด้วย AI service + verification flow
      const reply = `ได้รับข้อความแล้วค่ะ 🙏\n(ระบบกำลังพัฒนา — Phase A1 skeleton)`;
      await this.lineClient.replyText(event.replyToken, reply);
      await this.sessions.saveMessage({
        sessionId: session.id,
        role: MessageRole.BOT,
        text: reply,
      });
    } else {
      this.logger.log(`Received non-text message: ${event.message.type}`);
      await this.sessions.saveMessage({
        sessionId: session.id,
        role: MessageRole.CUSTOMER,
        type: event.message.type.toUpperCase() as never,
        text: `[${event.message.type}]`,
      });
    }
  }
}
