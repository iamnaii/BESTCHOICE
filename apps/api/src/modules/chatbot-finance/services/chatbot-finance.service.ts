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
import { HandoffService } from './handoff.service';
import { SlipProcessingService } from './slip-processing.service';
import { INTENTS } from '../constants/intents';
import { buildBrowserUrl } from '../../../utils/line-login.util';

const FALLBACK_REPLY =
  'ขออภัยค่ะ ระบบขัดข้องชั่วคราว 🙏\nรบกวนติดต่อเจ้าหน้าที่ 063-134-6356 ในเวลาทำการนะคะ';

// Path removed — Endpoint URL in LINE Developers is set to full path
// https://bestchoicephone.app/liff/finance-verify
const VERIFY_PATH = '';

/** Max chars sent to Claude — prevents token bomb from oversized messages */
const MAX_USER_TEXT_LENGTH = 2000;

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
    private handoff: HandoffService,
    private slipProcessing: SlipProcessingService,
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
    const browserUrl = buildBrowserUrl('/liff/finance-verify');
    if (!url) {
      this.logger.warn('[Finance] LIFF ID not configured in SystemConfig');
      return (
        'รบกวนยืนยันตัวตนก่อนนะคะ เพื่อความปลอดภัยของข้อมูลค่ะ 🔐\n\n' +
        `👉 ยืนยันตัวตน:\n${browserUrl}\n\n` +
        'ใช้เวลาประมาณ 1 นาทีค่ะ'
      );
    }
    return (
      'รบกวนยืนยันตัวตนก่อนนะคะ เพื่อความปลอดภัยของข้อมูลค่ะ 🔐\n\n' +
      `👉 ${url}\n\n` +
      `🌐 เปิดใน browser:\n${browserUrl}\n\n` +
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

    if (!userId || event.source.type !== 'user') {
      this.logger.debug(`Skip non-user message (type=${event.source.type})`);
      return;
    }

    const session = await this.sessions.getOrCreate(userId);

    // Verification gate
    const linkStatus = await this.verification.isLinked(userId);
    if (!linkStatus.linked) {
      // บันทึก customer message ก่อน
      const msgText =
        event.message.type === 'text' ? event.message.text : `[${event.message.type}]`;
      await this.sessions.saveMessage({
        sessionId: session.id,
        role: MessageRole.CUSTOMER,
        text: msgText,
      });
      const reply = await this.buildVerifyPrompt();
      await this.replyAndSave(session.id, event.replyToken, reply, INTENTS.VERIFY_REQUIRED);
      return;
    }

    // Sync session.customerId ถ้าจำเป็น
    if (!session.customerId && linkStatus.customerId) {
      await this.sessions.linkSessionToCustomer(session.id, linkStatus.customerId);
    }

    // Handoff gate — ถ้า session อยู่ใน handoff mode bot หยุดตอบ
    if (await this.handoff.isInHandoffMode(session.id)) {
      this.logger.log(`[Finance] Skip — session ${session.id} in handoff mode`);
      // ยังบันทึกข้อความเพื่อ history แต่ไม่ตอบ
      const msgText =
        event.message.type === 'text' ? event.message.text : `[${event.message.type}]`;
      await this.sessions.saveMessage({
        sessionId: session.id,
        role: MessageRole.CUSTOMER,
        text: msgText,
      });
      return;
    }

    // Image → slip processing (require customerId — guard against edge case
    // where link became dangling between isLinked() and now)
    if (event.message.type === 'image') {
      if (!linkStatus.customerId) {
        this.logger.warn(`[Finance] linked but no customerId for ${userId.slice(0, 8)}...`);
        await this.replyAndSave(
          session.id,
          event.replyToken,
          'ระบบพบปัญหาชั่วคราวค่ะ 🙏 รบกวนติดต่อเจ้าหน้าที่นะคะ',
          INTENTS.VERIFY_INCONSISTENT,
        );
        return;
      }
      await this.handleImage(event, session.id, linkStatus.customerId, userId);
      return;
    }

    // Other non-text → unsupported
    if (event.message.type !== 'text') {
      const msg =
        'น้องเบสยังรับเฉพาะข้อความและรูปภาพ (สลิป) นะคะ 🙏\n' +
        'ถ้ามีอย่างอื่น รบกวนติดต่อ 063-134-6356 ค่ะ';
      await this.sessions.saveMessage({
        sessionId: session.id,
        role: MessageRole.CUSTOMER,
        text: `[${event.message.type}]`,
      });
      await this.replyAndSave(session.id, event.replyToken, msg);
      return;
    }

    // Text → AI (save full text, truncate for AI to prevent token bomb)
    const fullText = event.message.text.trim();
    await this.sessions.saveMessage({
      sessionId: session.id,
      role: MessageRole.CUSTOMER,
      text: fullText,
    });
    const userText =
      fullText.length > MAX_USER_TEXT_LENGTH
        ? fullText.slice(0, MAX_USER_TEXT_LENGTH) + '…'
        : fullText;

    if (!linkStatus.customerId || !linkStatus.customerName) {
      this.logger.warn(`[Finance] linked but missing customer data for ${userId.slice(0, 8)}...`);
      await this.replyAndSave(
        session.id,
        event.replyToken,
        'ระบบพบปัญหาชั่วคราวค่ะ 🙏 รบกวนติดต่อเจ้าหน้าที่นะคะ',
        INTENTS.VERIFY_INCONSISTENT,
      );
      return;
    }

    const history = await this.sessions.getRecentMessages(session.id);
    const aiReply = await this.ai.generateReply({
      userMessage: userText,
      history: history.slice(0, -1),
      customerId: linkStatus.customerId,
      customerName: linkStatus.customerName,
      sessionId: session.id,
    });

    if (aiReply) {
      const intent = aiReply.handoffTriggered ? INTENTS.AI_HANDOFF : INTENTS.AI_REPLY;
      // Approximate cost: Sonnet 4.5 input $3/M, output $15/M (checked 2026-04-10)
      // With prompt caching enabled, actual input cost is lower (~$0.30/M for cache hits)
      const costUsd =
        (aiReply.inputTokens * 3 + aiReply.outputTokens * 15) / 1_000_000;
      await this.replyAndSave(session.id, event.replyToken, aiReply.text, intent, {
        model: aiReply.model,
        inputTokens: aiReply.inputTokens,
        outputTokens: aiReply.outputTokens,
        toolsUsed: aiReply.toolsUsed,
        costUsd,
      });
    } else {
      await this.replyAndSave(session.id, event.replyToken, FALLBACK_REPLY, INTENTS.FALLBACK);
    }
  }

  // ─── image handler (slip) ────────────────────────────────

  private async handleImage(
    event: LineMessageEvent,
    sessionId: string,
    customerId: string,
    lineUserId: string,
  ): Promise<void> {
    if (event.message.type !== 'image') return;

    // บันทึก customer message
    await this.sessions.saveMessage({
      sessionId,
      role: MessageRole.CUSTOMER,
      type: 'IMAGE',
      text: '[image]',
    });

    // ดาวน์โหลด media จาก LINE
    let imageBuffer: Buffer;
    try {
      imageBuffer = await this.lineClient.getMessageContent(event.message.id);
    } catch (err) {
      this.logger.error(
        `[Finance] image download failed: ${err instanceof Error ? err.message : err}`,
      );
      await this.replyAndSave(
        sessionId,
        event.replyToken,
        'อ่านรูปไม่สำเร็จค่ะ 🙏 รบกวนส่งใหม่อีกครั้งนะคะ',
        INTENTS.IMAGE_ERROR,
      );
      return;
    }

    // Process slip
    const result = await this.slipProcessing.processSlip({
      imageBuffer,
      mediaType: 'image/jpeg',
      customerId,
      lineUserId,
    });

    await this.replyAndSave(
      sessionId,
      event.replyToken,
      result.reply,
      result.matched ? INTENTS.SLIP_MATCHED : INTENTS.SLIP_REVIEW,
    );
  }

  // ─── helpers ─────────────────────────────────────────────

  private async replyAndSave(
    sessionId: string,
    replyToken: string,
    text: string,
    intent?: string,
    modelMeta?: {
      model: string;
      inputTokens: number;
      outputTokens: number;
      toolsUsed?: string[];
      costUsd?: number;
    },
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
      toolsUsed: modelMeta?.toolsUsed,
      costUsd: modelMeta?.costUsd,
    });
  }
}
