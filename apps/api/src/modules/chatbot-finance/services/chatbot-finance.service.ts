import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatChannel, MessageRole, MessageType } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  LineFinanceWebhookEvent,
  LineMessageEvent,
  LineMessageContent,
  LineFollowEvent,
  LinePostbackEvent,
} from '../dto/line-webhook.dto';
import { LineFinanceClientService } from './line-finance-client.service';
import { LineQuickReply, FlexContainer, LineMessage } from './line-finance-client.service';
import { MAX_BOT_ATTACHMENTS } from '../../../utils/bot-attachments.util';
import { ChatRoomService } from './chat-room.service';
import { VerificationService } from './verification.service';
import { FinanceAiService } from './finance-ai.service';
import { HandoffService } from './handoff.service';
import { SlipProcessingService } from './slip-processing.service';
import { FeedbackService } from './feedback.service';
import { QuickReplyPostbackRouterService } from '../../staff-chat/services/quick-reply-postback-router.service';
import { LineGroupMembershipService } from './line-group-membership.service';
import { INTENTS } from '../constants/intents';
import { buildBrowserUrl } from '../../../utils/line-login.util';
import { formatStickerToken } from '../../chat-engine/utils/sticker-token.util';
import { MessageRouterService } from '../../chat-engine/services/message-router.service';
import { StorageService } from '../../storage/storage.service';

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
    private configService: ConfigService,
    // W4: module-level `forwardRef(() => StaffChatModule)` in
    // chatbot-finance.module.ts already breaks the circular import — a
    // constructor-level @Inject(forwardRef(...)) on the same provider is
    // redundant for Nest's DI graph.
    private postbackRouter: QuickReplyPostbackRouterService,
    private groups: LineGroupMembershipService,
    // Task 44 — โหมดเก็บเข้า inbox: ทางเดียวกับ SHOP (mirrorInbound) + เก็บรูปสลิปให้พนักงานเปิดดูได้
    private messageRouter: MessageRouterService,
    private storage: StorageService,
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
              {
                type: 'text',
                text: '📱  กรอกเบอร์ + รับ OTP ทาง SMS',
                size: 'xs',
                color: '#6B7280',
              },
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
    // ยื่น GFIN PR 2 (spec §10): เข้า/ออกกลุ่ม = งานบัญชีสมาชิกภาพ ไม่ใช่การตอบ → จดก่อน kill switch เสมอ · 'room' (แชทหลายคน) ไม่นับ
    if (
      (event.type === 'join' || event.type === 'leave') &&
      event.source.type === 'group' &&
      event.source.groupId
    ) {
      return event.type === 'join'
        ? this.groups.onJoin('FINANCE', event.source.groupId)
        : this.groups.onLeave('FINANCE', event.source.groupId);
    }

    // final-fix F3: กลุ่มที่เชิญ OA เข้าไว้ก่อน PR 2 ขึ้น ไม่มีทางได้ event `join` เลย (LINE ไม่ resend join
    // เมื่อบอทเป็นสมาชิกกลุ่มอยู่แล้ว) — จดสมาชิกภาพจากข้อความกลุ่มอื่นใดก็ได้แทน (bookkeeping ไม่ใช่การตอบ)
    // ก่อน kill switch เหมือนกัน · หนึ่ง indexed lookup ต่อ event (ดู ensureKnown) · ตัวข้อความยังถูกทิ้งตามเดิม
    // โดย handleMessage (group !== user)
    if (event.source.type === 'group' && event.source.groupId) {
      await this.groups.ensureKnown('FINANCE', event.source.groupId);
    }

    // คำตัดสินเจ้าของ #49 (Task 44): OA การเงิน = "เก็บเข้า inbox ไม่ตอบอัตโนมัติ" — ดู handleEventInboxOnly.
    // fail-safe: บอทเต็ม (AI ตอบ · ตัวอ่านสลิปที่อนุมัติเองได้) เปิดได้ทางเดียวคือ LINE_FINANCE_BOT_MODE=full
    // และ LINE_FINANCE_BOT_DISABLED ไม่ใช่ 'true' — env หาย/พิมพ์ผิด/deploy ด้วยชุดอื่น = inbox-only เสมอ
    if (!this.isFullBotMode()) {
      return this.handleEventInboxOnly(event);
    }

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

  /** รูป/ไฟล์จาก LINE เก็บ message id ไว้ให้ดึงไฟล์ทีหลัง (ยื่น GFIN) — ข้อความอื่นไม่เปลี่ยน */
  private inboundMediaFields(message: LineMessageContent): {
    type?: MessageType;
    text: string;
    externalMessageId?: string;
  } {
    if (message.type === 'image')
      return { type: 'IMAGE', text: '[image]', externalMessageId: message.id };
    if (message.type === 'file')
      return { type: 'FILE', text: '[file]', externalMessageId: message.id };
    return { text: this.inboundMessageToText(message) };
  }

  // ─── inbox-only mode (ค่าเริ่มต้น — Task 44) ─────

  /**
   * บอทเต็มเปิดเฉพาะเมื่อตั้ง `LINE_FINANCE_BOT_MODE=full` ไว้ตรง ๆ และไม่ได้ตั้ง `LINE_FINANCE_BOT_DISABLED=true`
   * (prod ตั้ง DISABLED=true ไว้ใน deploy-gcp.yml) · ค่าอื่นทุกแบบ = inbox-only — รีวิว Task 44 I-1: ด่านเดิมเทียบ
   * DISABLED === 'true' ตรงตัว env หายครั้งเดียว AI ตอบลูกค้าเก่าและสลิปติด APPROVED เองได้
   */
  private isFullBotMode(): boolean {
    return (
      this.configService.get<string>('LINE_FINANCE_BOT_MODE') === 'full' &&
      this.configService.get<string>('LINE_FINANCE_BOT_DISABLED') !== 'true'
    );
  }

  /**
   * คำตัดสินเจ้าของ #49 — OA การเงินต่อเข้าระบบในโหมด "เก็บเข้า inbox ไม่ตอบอัตโนมัติ":
   * - ข้อความ/รูป/สติกเกอร์/ไฟล์ของผู้ใช้ 1:1 → ห้อง LINE_FINANCE ใน unified inbox ทางเดียวกับ SHOP
   *   (`MessageRouterService.mirrorInbound` — เปิดห้องที่ปิดแล้วกลับมา · ตั้ง "รอตอบ" · ผู้สนใจอัตโนมัติ) ไม่ตอบเลย
   *   (ไม่มี AI · ไม่มีการ์ดยืนยันตัวตนต่อข้อความ · ไม่อ่านสลิปตอบลูกค้า/ไม่สร้าง PaymentEvidence)
   * - เพิ่มเพื่อน → ข้อความต้อนรับ + การ์ดยืนยันตัวตนเดิม (`handleFollow`) — ทางเดียวที่บอทตอบเอง
   * - postback ที่ลูกค้ากดเอง → ทางเดิม (`handlePostback`) · ลิงก์ LIFF (ยืนยันตัวตน/ชำระ/ดูสัญญา) ไม่ผ่าน webhook อยู่แล้ว
   * - ข้อความกลุ่ม/ห้องหลายคน → ไม่เก็บ (เหมือนทางเต็ม — การจดสมาชิกภาพกลุ่มทำก่อนถึงนี่แล้ว)
   * กันซ้ำ: controller claim `webhookEventId` ก่อนเรียก + `chat_messages.external_message_id` unique
   */
  private async handleEventInboxOnly(event: LineFinanceWebhookEvent): Promise<void> {
    switch (event.type) {
      case 'message':
        return this.mirrorMessageToInbox(event);
      case 'follow':
        return this.handleFollow(event);
      case 'postback':
        return this.handlePostback(event as LinePostbackEvent);
      default:
        return;
    }
  }

  private async mirrorMessageToInbox(event: LineMessageEvent): Promise<void> {
    const userId = event.source.userId;
    if (!userId || event.source.type !== 'user') return;

    const { message } = event;
    // error จาก mirrorInbound ไม่กลืน — controller จด log + Sentry ต่อ event (ข้อความที่เก็บไม่ได้ต้องมีร่องรอย)
    await this.messageRouter.mirrorInbound({
      externalMessageId: message.id,
      externalUserId: userId,
      channel: ChatChannel.LINE_FINANCE,
      ...(await this.inboxOnlyContent(message)),
    });
  }

  /** ชนิด/ข้อความที่เก็บเข้า inbox — รูปเก็บไฟล์ไว้ให้พนักงานเปิดดูได้ · ชนิดอื่นใช้ mapping เดิมของห้องการเงิน */
  private async inboxOnlyContent(
    message: LineMessageContent,
  ): Promise<{ type: MessageType; text?: string; mediaUrl?: string; mediaType?: string }> {
    if (message.type === 'image') {
      const mediaUrl = await this.storeInboundImage(message.id);
      return mediaUrl
        ? { type: MessageType.IMAGE, mediaUrl, mediaType: 'image/jpeg' }
        : { type: MessageType.IMAGE, text: '[image]' };
    }
    const { type = MessageType.TEXT, text } = this.inboundMediaFields(message);
    return { type, text };
  }

  /**
   * ดึงรูปจาก LINE (ไฟล์ของ LINE หมดอายุได้) แล้วเก็บใน storage — key ใต้ `staff-chat/` เพราะ inbox ลงลายเซ็น
   * storage key ให้เปิดดูได้ และปุ่ม GFIN อ่านไฟล์จาก storage เฉพาะ prefix นี้ · key ผูก message id (ส่งซ้ำ = ทับไฟล์เดิม)
   * ไม่สำเร็จ/ไม่มี storage → null (ยังเก็บข้อความพร้อม message id ไว้ให้ปุ่ม GFIN ดึงจาก LINE ทีหลัง)
   */
  private async storeInboundImage(messageId: string): Promise<string | null> {
    if (!this.storage.configured) return null;
    try {
      const buffer = await this.lineClient.getMessageContent(messageId);
      const key = `staff-chat/line-finance/${messageId}.jpg`;
      await this.storage.upload(key, buffer, 'image/jpeg');
      return key;
    } catch (err) {
      this.logger.warn(
        `[Finance inbox-only] store image ${messageId} failed: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
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
        ...this.inboundMediaFields(event.message),
      });
      await this.replyVerifyFlexAndSave(
        session.id,
        event.replyToken,
        undefined,
        INTENTS.VERIFY_REQUIRED,
      );
      return;
    }

    // Sync session.customerId ถ้าจำเป็น — เทียบค่าแทน !session.customerId เพราะห้องอาจถือ
    // "ผู้สนใจอัตโนมัติ" (placeholder, customerId ไม่ว่าง) อยู่แล้วตอน LINE เพิ่งถูกผูกกับลูกค้าจริง
    // linkRoomToCustomer เองเป็นคนตัดสินว่าจะ absorb placeholder หรือข้าม (ลูกค้าจริงคนอื่น) — Ruling R4
    if (linkStatus.customerId && session.customerId !== linkStatus.customerId) {
      await this.sessions.linkRoomToCustomer(session.id, linkStatus.customerId);
    }

    // Handoff/take-over gate — handoff หรือพนักงานรับช่วงต่อ (aiPaused) → bot หยุดตอบ
    if (await this.handoff.isBotSilenced(session.id)) {
      this.logger.log(`[Finance] Skip — session ${session.id} silenced (handoff/aiPaused)`);
      // ยังบันทึกข้อความเพื่อ history แต่ไม่ตอบ
      await this.sessions.saveMessage({
        roomId: session.id,
        role: MessageRole.CUSTOMER,
        ...this.inboundMediaFields(event.message),
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
        ...this.inboundMediaFields(event.message),
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
      const costUsd = (aiReply.inputTokens * 3 + aiReply.outputTokens * 15) / 1_000_000;

      // Send feedback Quick Reply when AI used tools (data-backed answers)
      const feedbackQuickReply =
        aiReply.toolsUsed.length > 0 ? this.buildFeedbackQuickReply(session.id) : undefined;

      await this.replyAndSave(
        session.id,
        event.replyToken,
        aiReply.text,
        intent,
        {
          model: aiReply.model,
          inputTokens: aiReply.inputTokens,
          outputTokens: aiReply.outputTokens,
          toolsUsed: aiReply.toolsUsed,
          costUsd,
        },
        feedbackQuickReply,
        // ส่งเฉพาะ attachment ที่มีรูปจริง — ลิงก์อยู่ในข้อความที่โมเดลเขียนแล้ว
        aiReply.attachments?.filter((a) => !!a.imageUrl).map((a) => ({ url: a.imageUrl! })),
      );
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
      externalMessageId: event.message.id,
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

    // Phase 5 — Quick Reply postback router (handles TEMPLATE:<id> payloads).
    // Runs BEFORE the existing feedback action handler. Returns
    // { handled: false } when the payload isn't a TEMPLATE: format so the
    // existing feedback flow is untouched.
    const userId = event.source.userId;
    if (userId) {
      try {
        const room = await this.prisma.chatRoom.findUnique({
          where: {
            lineUserId_channel: { lineUserId: userId, channel: ChatChannel.LINE_FINANCE },
          },
          select: { id: true },
        });
        if (room) {
          const routeResult = await this.postbackRouter.route(room.id, data);
          if (routeResult.handled) {
            if (routeResult.error) {
              this.logger.warn(
                `[Finance postback router] ${routeResult.action ?? 'unknown'}: ${routeResult.error}`,
              );
            }
            return;
          }
        }
      } catch (err) {
        this.logger.warn(
          `[Finance postback router] failed: ${err instanceof Error ? err.message : err}`,
        );
        // fall through to existing flow
      }
    }

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
    images?: { url: string }[], // B3 §5 Task 12 — รูปสินค้าตามหลังข้อความ (optional = call site เดิมไม่พัง)
  ): Promise<string> {
    // บันทึกข้อความ text ก่อนเพื่อเอา id ไปใส่ใน feedback quick reply
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

    // B3 §5 — รูปสินค้าตามหลังข้อความใน reply เดียวกัน (LINE รับได้ 5 ข้อความ/ครั้ง)
    const savedIds = [savedMsg.id];
    const imageList = (images ?? []).filter((i) => !!i.url).slice(0, MAX_BOT_ATTACHMENTS);
    for (const img of imageList) {
      const imageMessage = await this.sessions.saveMessage({
        roomId,
        role: MessageRole.BOT,
        type: MessageType.IMAGE,
        text: '[image]',
        mediaUrl: img.url,
        intent,
      });
      savedIds.push(imageMessage.id);
    }

    try {
      const messages: LineMessage[] = [
        { type: 'text', text },
        ...imageList.map((i) => ({
          type: 'image' as const,
          originalContentUrl: i.url,
          previewImageUrl: i.url,
        })),
      ];

      if (quickReply) {
        // LINE แสดง quick reply ของ "ข้อความสุดท้าย" เท่านั้น — ถ้าแปะไว้ที่ text
        // แล้วมีรูปตามหลัง ปุ่มจะหายไปเฉย ๆ
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
        messages[messages.length - 1] = {
          ...messages[messages.length - 1],
          quickReply: resolvedQuickReply,
        } as LineMessage;
      }

      await this.lineClient.replyMessage(replyToken, messages);
      for (const id of savedIds) await this.sessions.confirmBotSent(id);
    } catch (err) {
      this.logger.error(`[Finance] reply failed: ${err instanceof Error ? err.message : err}`);
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
    const savedIds: string[] = [];
    if (greeting) {
      const greetingMessage = await this.sessions.saveMessage({
        roomId,
        role: MessageRole.BOT,
        text: greeting,
      });
      savedIds.push(greetingMessage.id);
    }
    const flexMessage = await this.sessions.saveMessage({
      roomId,
      role: MessageRole.BOT,
      text: '[flex:verify]',
      intent,
    });
    savedIds.push(flexMessage.id);

    try {
      const messages = greeting
        ? [
            { type: 'text' as const, text: greeting },
            { type: 'flex' as const, altText: VERIFY_ALT_TEXT, contents: this.buildVerifyFlex() },
          ]
        : [{ type: 'flex' as const, altText: VERIFY_ALT_TEXT, contents: this.buildVerifyFlex() }];
      await this.lineClient.replyMessage(replyToken, messages);
      for (const id of savedIds) await this.sessions.confirmBotSent(id);
    } catch (err) {
      this.logger.error(
        `[Finance] verify flex reply failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
