import { Injectable, Logger } from '@nestjs/common';
import { MessageRole } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  LineFinanceWebhookEvent,
  LineMessageEvent,
  LineFollowEvent,
  LinePostbackEvent,
} from '../dto/line-webhook.dto';
import { LineFinanceClientService } from './line-finance-client.service';
import { LineQuickReply, FlexContainer } from './line-finance-client.service';
import { ChatRoomService } from './chat-room.service';
import { VerificationService } from './verification.service';
import { FinanceAiService } from './finance-ai.service';
import { HandoffService } from './handoff.service';
import { SlipProcessingService } from './slip-processing.service';
import { FeedbackService } from './feedback.service';
import { INTENTS } from '../constants/intents';
import { buildBrowserUrl } from '../../../utils/line-login.util';
import { formatStickerToken } from '../../chat-engine/utils/sticker-token.util';

const FALLBACK_REPLY =
  'ขออภัยค่ะ ระบบขัดข้องชั่วคราว 🙏\nรบกวนติดต่อเจ้าหน้าที่ 063-134-6356 ในเวลาทำการนะคะ';

/** Max chars sent to Claude — prevents token bomb from oversized messages */
const MAX_USER_TEXT_LENGTH = 2000;

const VERIFY_ALT_TEXT = 'รบกวนยืนยันตัวตนก่อนนะคะ เพื่อความปลอดภัยของข้อมูลค่ะ 🔐';

/**
 * Orchestration สำหรับ Finance Bot
 *
 * Verification: ส่ง Flex card พร้อมปุ่มเปิด LINE Login OAuth → /liff/finance-verify
 */
@Injectable()
export class ChatbotFinanceService {
  private readonly logger = new Logger(ChatbotFinanceService.name);

  constructor(
    private prisma: PrismaService,
    private lineClient: LineFinanceClientService,
    private sessions: ChatRoomService,
    private verification: VerificationService,
    private ai: FinanceAiService,
    private handoff: HandoffService,
    private slipProcessing: SlipProcessingService,
    private feedback: FeedbackService,
  ) {}

  /** Flex card สำหรับ prompt ยืนยันตัวตน — ปุ่มเปิด LINE Login OAuth */
  private buildVerifyFlex(): FlexContainer {
    const verifyUrl = buildBrowserUrl('/liff/finance-verify');
    return {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#059669',
        paddingAll: '20px',
        contents: [
          { type: 'text', text: 'BEST CHOICE FINANCE', color: '#FFFFFF', size: 'xxs' },
          {
            type: 'text',
            text: '🔐 ยืนยันตัวตน',
            color: '#FFFFFF',
            size: 'xl',
            weight: 'bold',
            margin: 'sm',
          },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        paddingAll: '20px',
        contents: [
          {
            type: 'text',
            text: 'รบกวนยืนยันตัวตนก่อนนะคะ เพื่อความปลอดภัยของข้อมูลค่ะ',
            wrap: true,
            size: 'sm',
            color: '#1F2937',
          },
          {
            type: 'box',
            layout: 'vertical',
            backgroundColor: '#F9FAFB',
            cornerRadius: 'md',
            paddingAll: '12px',
            margin: 'md',
            spacing: 'sm',
            contents: [
              { type: 'text', text: '⏱️  ใช้เวลาประมาณ 1 นาที', size: 'xs', color: '#6B7280' },
              { type: 'text', text: '📱  กรอกเบอร์ + รับ OTP ทาง SMS', size: 'xs', color: '#6B7280' },
            ],
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#059669',
            height: 'sm',
            action: {
              type: 'uri',
              label: 'เริ่มยืนยันตัวตน',
              uri: verifyUrl,
            },
          },
        ],
      },
    };
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
        return this.handlePostback(event as LinePostbackEvent);
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
      roomId: session.id,
      role: MessageRole.SYSTEM,
      text: '[follow event]',
    });

    await this.replyVerifyFlexAndSave(
      session.id,
      event.replyToken,
      'สวัสดีค่ะ น้องเบสยินดีให้บริการนะคะ 😊',
    );
  }

  /** Customer message → plain text for inbox storage.
   *  Stickers become [sticker:packageId:stickerId] so MessageBubble renders the image. */
  private inboundMessageToText(message: LineMessageEvent['message']): string {
    if (message.type === 'text') return message.text;
    if (message.type === 'sticker') return formatStickerToken(message.packageId, message.stickerId);
    return `[${message.type}]`;
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
      await this.sessions.saveMessage({
        roomId: session.id,
        role: MessageRole.CUSTOMER,
        text: this.inboundMessageToText(event.message),
      });
      await this.replyVerifyFlexAndSave(
        session.id,
        event.replyToken,
        undefined,
        INTENTS.VERIFY_REQUIRED,
      );
      return;
    }

    // Sync session.customerId ถ้าจำเป็น
    if (!session.customerId && linkStatus.customerId) {
      await this.sessions.linkRoomToCustomer(session.id, linkStatus.customerId);
    }

    // Handoff gate — ถ้า session อยู่ใน handoff mode bot หยุดตอบ
    if (await this.handoff.isInHandoffMode(session.id)) {
      this.logger.log(`[Finance] Skip — session ${session.id} in handoff mode`);
      // ยังบันทึกข้อความเพื่อ history แต่ไม่ตอบ
      await this.sessions.saveMessage({
        roomId: session.id,
        role: MessageRole.CUSTOMER,
        text: this.inboundMessageToText(event.message),
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

    // Sticker → mirror as token so inbox shows the sticker image; no bot reply needed
    if (event.message.type === 'sticker') {
      await this.sessions.saveMessage({
        roomId: session.id,
        role: MessageRole.CUSTOMER,
        text: this.inboundMessageToText(event.message),
      });
      return;
    }

    // Other non-text → unsupported
    if (event.message.type !== 'text') {
      const msg =
        'น้องเบสยังรับเฉพาะข้อความและรูปภาพ (สลิป) นะคะ 🙏\n' +
        'ถ้ามีอย่างอื่น รบกวนติดต่อ 063-134-6356 ค่ะ';
      await this.sessions.saveMessage({
        roomId: session.id,
        role: MessageRole.CUSTOMER,
        text: this.inboundMessageToText(event.message),
      });
      await this.replyAndSave(session.id, event.replyToken, msg);
      return;
    }

    // Text → AI (save full text, truncate for AI to prevent token bomb)
    const fullText = event.message.text.trim();
    await this.sessions.saveMessage({
      roomId: session.id,
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
      roomId: session.id,
    });

    if (aiReply) {
      const intent = aiReply.handoffTriggered ? INTENTS.AI_HANDOFF : INTENTS.AI_REPLY;
      // Approximate cost: Sonnet 4.5 input $3/M, output $15/M (checked 2026-04-10)
      // With prompt caching enabled, actual input cost is lower (~$0.30/M for cache hits)
      const costUsd =
        (aiReply.inputTokens * 3 + aiReply.outputTokens * 15) / 1_000_000;

      // Send feedback Quick Reply when AI used tools (data-backed answers)
      const feedbackQuickReply =
        aiReply.toolsUsed.length > 0
          ? this.buildFeedbackQuickReply(session.id)
          : undefined;

      await this.replyAndSave(session.id, event.replyToken, aiReply.text, intent, {
        model: aiReply.model,
        inputTokens: aiReply.inputTokens,
        outputTokens: aiReply.outputTokens,
        toolsUsed: aiReply.toolsUsed,
        costUsd,
      }, feedbackQuickReply);
    } else {
      await this.replyAndSave(session.id, event.replyToken, FALLBACK_REPLY, INTENTS.FALLBACK);
    }
  }

  // ─── image handler (slip) ────────────────────────────────

  private async handleImage(
    event: LineMessageEvent,
    roomId: string,
    customerId: string,
    lineUserId: string,
  ): Promise<void> {
    if (event.message.type !== 'image') return;

    // บันทึก customer message
    await this.sessions.saveMessage({
      roomId,
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
        roomId,
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
      roomId,
      event.replyToken,
      result.reply,
      result.matched ? INTENTS.SLIP_MATCHED : INTENTS.SLIP_REVIEW,
    );
  }

  // ─── helpers ─────────────────────────────────────────────

  // ─── postback handler ──────────────────────────────────

  private async handlePostback(event: LinePostbackEvent): Promise<void> {
    const data = event.postback.data;
    this.logger.log(`[Finance] Postback: ${data}`);

    const params = new URLSearchParams(data);
    const action = params.get('action');

    if (action === 'feedback') {
      const rating = parseInt(params.get('rating') ?? '', 10);
      const roomId = params.get('roomId');
      const messageId = params.get('messageId');
      const userId = event.source.userId;

      if (!userId || !roomId || isNaN(rating)) {
        this.logger.warn(`[Finance] Invalid feedback postback: ${data}`);
        return;
      }

      try {
        await this.feedback.saveFeedback({
          lineUserId: userId,
          roomId,
          messageId: messageId ?? undefined,
          rating,
        });

        const thankYou =
          rating === 1
            ? 'ขอบคุณสำหรับ feedback ค่ะ 😊'
            : 'ขอบคุณสำหรับ feedback ค่ะ 🙏 ทีมงานจะปรับปรุงให้ดียิ่งขึ้นนะคะ';

        if (event.replyToken) {
          await this.replyAndSave(roomId, event.replyToken, thankYou, INTENTS.FEEDBACK);
        }
      } catch (err) {
        this.logger.error(
          `[Finance] Feedback save failed: ${err instanceof Error ? err.message : err}`,
        );
      }
      return;
    }

    this.logger.debug(`[Finance] Unhandled postback action: ${action}`);
  }

  /** Build Quick Reply with 👍/👎 feedback buttons */
  private buildFeedbackQuickReply(roomId: string): LineQuickReply {
    // messageId placeholder — will be replaced after save
    return {
      items: [
        {
          type: 'action',
          action: {
            type: 'postback',
            label: '👍 ถูกต้อง',
            data: `action=feedback&rating=1&roomId=${roomId}&messageId=__MSG_ID__`,
            displayText: '👍 ถูกต้อง',
          },
        },
        {
          type: 'action',
          action: {
            type: 'postback',
            label: '👎 ไม่ถูกต้อง',
            data: `action=feedback&rating=0&roomId=${roomId}&messageId=__MSG_ID__`,
            displayText: '👎 ไม่ถูกต้อง',
          },
        },
      ],
    };
  }

  private async replyAndSave(
    roomId: string,
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
    quickReply?: LineQuickReply,
  ): Promise<string> {
    // Save message first to get the ID for feedback Quick Reply
    const savedMsg = await this.sessions.saveMessage({
      roomId,
      role: MessageRole.BOT,
      text,
      intent,
      modelUsed: modelMeta?.model,
      inputTokens: modelMeta?.inputTokens,
      outputTokens: modelMeta?.outputTokens,
      toolsUsed: modelMeta?.toolsUsed,
      costUsd: modelMeta?.costUsd,
    });

    try {
      if (quickReply) {
        // Replace placeholder with actual message ID
        const resolvedQuickReply: LineQuickReply = {
          items: quickReply.items.map((item) => ({
            ...item,
            action: {
              ...item.action,
              ...(item.action.type === 'postback'
                ? { data: item.action.data.replace('__MSG_ID__', savedMsg.id) }
                : {}),
            },
          })),
        } as LineQuickReply;
        await this.lineClient.replyWithQuickReply(replyToken, text, resolvedQuickReply);
      } else {
        await this.lineClient.replyText(replyToken, text);
      }
    } catch (err) {
      this.logger.error(
        `[Finance] reply failed: ${err instanceof Error ? err.message : err}`,
      );
    }

    return savedMsg.id;
  }

  /**
   * Reply with optional text greeting + verify Flex card (2 messages in one reply).
   * Saves both messages for session history (flex saved with altText).
   */
  private async replyVerifyFlexAndSave(
    roomId: string,
    replyToken: string,
    greeting?: string,
    intent: string = INTENTS.VERIFY_REQUIRED,
  ): Promise<void> {
    if (greeting) {
      await this.sessions.saveMessage({
        roomId,
        role: MessageRole.BOT,
        text: greeting,
      });
    }
    await this.sessions.saveMessage({
      roomId,
      role: MessageRole.BOT,
      text: VERIFY_ALT_TEXT,
      intent,
    });

    try {
      const messages = greeting
        ? [
            { type: 'text' as const, text: greeting },
            { type: 'flex' as const, altText: VERIFY_ALT_TEXT, contents: this.buildVerifyFlex() },
          ]
        : [{ type: 'flex' as const, altText: VERIFY_ALT_TEXT, contents: this.buildVerifyFlex() }];
      await this.lineClient.replyMessage(replyToken, messages);
    } catch (err) {
      this.logger.error(
        `[Finance] verify flex reply failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
