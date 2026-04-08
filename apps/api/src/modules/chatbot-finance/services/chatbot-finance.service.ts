import { Injectable, Logger } from '@nestjs/common';
import { MessageRole } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
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

const VERIFY_PATH = '/liff/finance-verify';

/**
 * Orchestration สำหรับ Finance Bot
 *
 * Verification: ใช้ LIFF (เปิด page ใน LINE) — chat แค่ส่ง link
 * LIFF URL อ่านจาก SystemConfig.liff_id (เซ็ตผ่านหน้า /settings/line-oa)
 */
@Injectable()
export class ChatbotFinanceService {
  private readonly logger = new Logger(ChatbotFinanceService.name);

  constructor(
    private prisma: PrismaService,
    private lineClient: LineFinanceClientService,
    private sessions: ChatSessionService,
    private verification: VerificationService,
    private ai: FinanceAiService,
  ) {}

  /**
   * อ่าน LIFF base URL จาก SystemConfig (pattern เดียวกับ line-oa.controller)
   * Returns null ถ้ายังไม่ได้ตั้งค่า
   */
  private async getLiffVerifyUrl(): Promise<string | null> {
    const liffConfig = await this.prisma.systemConfig.findUnique({
      where: { key: 'liff_id' },
    });
    if (!liffConfig?.value) return null;
    // LIFF รองรับ path-based routing: https://liff.line.me/{liffId}{path}
    return `https://liff.line.me/${liffConfig.value}${VERIFY_PATH}`;
  }

  /** ข้อความให้ลูกค้าเปิด LIFF + fallback ถ้ายังไม่ได้ตั้งค่า */
  private async buildVerifyPrompt(): Promise<string> {
    const url = await this.getLiffVerifyUrl();
    if (!url) {
      this.logger.warn('[Finance] LIFF ID not configured in SystemConfig');
      return (
        'ระบบยืนยันตัวตนยังไม่พร้อมใช้งานค่ะ 🙏\n' +
        'รบกวนติดต่อเจ้าหน้าที่ 063-134-6356 นะคะ'
      );
    }
    return (
      'รบกวนยืนยันตัวตนก่อนนะคะ เพื่อความปลอดภัยของข้อมูลค่ะ 🔐\n\n' +
      `👉 ${url}\n\n` +
      'ใช้เวลาประมาณ 1 นาทีค่ะ'
    );
  }

  async handleEvent(event: LineFinanceWebhookEvent): Promise<void> {
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
      (await this.buildVerifyPrompt());

    await this.replyAndSave(session.id, event.replyToken, greeting);
  }

  // ─── message ─────────────────────────────────────────────

  private async handleMessage(event: LineMessageEvent): Promise<void> {
    const userId = event.source.userId;

    // Phase A2 รองรับเฉพาะ 1:1 chat
    if (!userId || event.source.type !== 'user') {
      this.logger.debug(`Skip non-user message (type=${event.source.type})`);
      return;
    }

    const session = await this.sessions.getOrCreate(userId);

    // Phase A2: text only
    if (event.message.type !== 'text') {
      const msg =
        'น้องเบสยังรับเฉพาะข้อความตัวอักษรอยู่นะคะ 🙏\n' +
        'ถ้ามีสลิปหรือรูป รบกวนติดต่อ 063-134-6356 ค่ะ';
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

    // 2. ตรวจ verification: ใช้ CustomerLineLink (DB) เท่านั้น
    const linkStatus = await this.verification.isLinked(userId);

    if (!linkStatus.linked) {
      const reply = await this.buildVerifyPrompt();
      await this.replyAndSave(session.id, event.replyToken, reply, 'verify_required');
      return;
    }

    // 3. Verified → ส่งให้ AI (อัพเดต session.customerId ให้ตรง ถ้าจำเป็น)
    if (!session.customerId && linkStatus.customerId) {
      // CustomerLineLink มี link อยู่ แต่ session ยังไม่ sync (สำหรับ session เก่าก่อน verify)
      await this.sessions.linkSessionToCustomer(session.id, linkStatus.customerId);
    }

    const history = await this.sessions.getRecentMessages(session.id);
    const aiReply = await this.ai.generateReply({
      userMessage: userText,
      history: history.slice(0, -1),
      customerId: linkStatus.customerId!,
      customerName: linkStatus.customerName!,
    });

    if (aiReply) {
      await this.replyAndSave(session.id, event.replyToken, aiReply.text, 'ai_reply', {
        model: aiReply.model,
        inputTokens: aiReply.inputTokens,
        outputTokens: aiReply.outputTokens,
      });
    } else {
      await this.replyAndSave(session.id, event.replyToken, FALLBACK_REPLY, 'fallback');
    }
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
