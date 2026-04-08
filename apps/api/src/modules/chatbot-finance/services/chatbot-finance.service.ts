import { Injectable, Logger } from '@nestjs/common';
import { MessageRole } from '@prisma/client';
import {
  LineFinanceWebhookEvent,
  LineMessageEvent,
  LineFollowEvent,
} from '../dto/line-webhook.dto';
import { LineFinanceClientService } from './line-finance-client.service';
import { ChatSessionService } from './chat-session.service';
import { VerificationService } from './verification.service';
import { FinanceAiService } from './finance-ai.service';

const FALLBACK_REPLY =
  'ขออภัยค่ะ ระบบขัดข้องชั่วคราว 🙏\nรบกวนติดต่อเจ้าหน้าที่ 063-134-6356 ในเวลาทำการนะคะ';

/**
 * Orchestration สำหรับ Finance Bot
 *
 * Flow:
 *   1. รับ event จาก LINE
 *   2. หา/สร้าง session
 *   3. บันทึก customer message
 *   4. Route:
 *      - not verified → VerificationService
 *      - verified     → FinanceAiService (Claude)
 *   5. ส่งคำตอบ + บันทึก bot message
 */
@Injectable()
export class ChatbotFinanceService {
  private readonly logger = new Logger(ChatbotFinanceService.name);

  constructor(
    private lineClient: LineFinanceClientService,
    private sessions: ChatSessionService,
    private verification: VerificationService,
    private ai: FinanceAiService,
  ) {}

  async handleEvent(event: LineFinanceWebhookEvent): Promise<void> {
    // Log Group ID เพื่อใช้ตอนตั้งค่า staff notifications (ภายหลัง)
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

  // ─── follow ──────────────────────────────────────────────

  private async handleFollow(event: LineFollowEvent): Promise<void> {
    const userId = event.source.userId;
    if (!userId) return;

    const session = await this.sessions.getOrCreate(userId);
    await this.sessions.saveMessage({
      sessionId: session.id,
      role: MessageRole.SYSTEM,
      text: '[follow event]',
    });

    const greeting =
      'สวัสดีค่ะ น้องเบสยินดีให้บริการนะคะ 😊\n\n' +
      'เพื่อความปลอดภัย รบกวนพิมพ์เบอร์โทรที่ลงทะเบียนไว้กับ BESTCHOICE ให้น้องด้วยนะคะ 📱';

    await this.replyAndSave(session.id, event.replyToken, greeting);
  }

  // ─── message ─────────────────────────────────────────────

  private async handleMessage(event: LineMessageEvent): Promise<void> {
    const userId = event.source.userId;

    // Ignore group/room messages — Phase A2 รองรับเฉพาะ 1:1 chat
    if (!userId || event.source.type !== 'user') {
      this.logger.debug(`Skip non-user message (type=${event.source.type})`);
      return;
    }

    let session = await this.sessions.getOrCreate(userId);

    // Phase A2: รองรับเฉพาะ text message — image/audio รอ Phase B
    if (event.message.type !== 'text') {
      const msg = `น้องเบสยังรับเฉพาะข้อความตัวอักษรอยู่นะคะ 🙏\nถ้ามีสลิปหรือรูป รบกวนติดต่อ 063-134-6356 ค่ะ`;
      await this.sessions.saveMessage({
        sessionId: session.id,
        role: MessageRole.CUSTOMER,
        text: `[${event.message.type}]`,
      });
      await this.replyAndSave(session.id, event.replyToken, msg);
      return;
    }

    const userText = event.message.text.trim();

    // 1. บันทึก customer message ก่อนเสมอ
    await this.sessions.saveMessage({
      sessionId: session.id,
      role: MessageRole.CUSTOMER,
      text: userText,
    });

    // 2. ตรวจ verification state
    const state = await this.verification.getState(session);

    let reply: string;
    let intent: string | undefined;
    let modelMeta: { model: string; inputTokens: number; outputTokens: number } | undefined;

    if (state.kind !== 'verified') {
      // 3a. Verification flow
      const result = await this.verification.handleVerificationStep(session, state, userText);
      reply = result.reply;
      intent = `verify:${state.kind}`;

      // ถ้าเพิ่ง verify สำเร็จ → reload session เพื่อให้ AI เห็น customer
      if (result.newState.kind === 'verified') {
        session = await this.sessions.getOrCreate(userId);
      }
    } else {
      // 3b. Verified → ส่งให้ AI
      const history = await this.sessions.getRecentMessages(session.id);
      const aiReply = await this.ai.generateReply({
        userMessage: userText,
        history: history.slice(0, -1), // exclude current message (เพิ่ง save)
        customerName: state.customerName,
      });

      if (aiReply) {
        reply = aiReply.text;
        modelMeta = {
          model: aiReply.model,
          inputTokens: aiReply.inputTokens,
          outputTokens: aiReply.outputTokens,
        };
        intent = 'ai_reply';
      } else {
        reply = FALLBACK_REPLY;
        intent = 'fallback';
      }
    }

    // 4. ตอบกลับ + save
    await this.replyAndSave(session.id, event.replyToken, reply, intent, modelMeta);
  }

  // ─── helpers ─────────────────────────────────────────────

  private async replyAndSave(
    sessionId: string,
    replyToken: string,
    text: string,
    intent?: string,
    modelMeta?: { model: string; inputTokens: number; outputTokens: number },
  ): Promise<void> {
    try {
      await this.lineClient.replyText(replyToken, text);
    } catch (err) {
      this.logger.error(
        `[Finance] reply failed: ${err instanceof Error ? err.message : err}`,
      );
      // ยัง save bot message ลง DB (ลูกค้าอาจไม่เห็น แต่เก็บประวัติไว้)
    }

    await this.sessions.saveMessage({
      sessionId,
      role: MessageRole.BOT,
      text,
      intent,
      modelUsed: modelMeta?.model,
      inputTokens: modelMeta?.inputTokens,
      outputTokens: modelMeta?.outputTokens,
    });
  }
}
