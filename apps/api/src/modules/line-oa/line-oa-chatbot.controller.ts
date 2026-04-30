import {
  formatDateShort,
  formatDateShortThai,
} from '../../utils/thai-date.util';
import {
  Controller,
  Post,
  Req,
  UseGuards,
  Logger,
  HttpCode,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { LineOaService } from './line-oa.service';
import { ChatbotService } from './chatbot.service';
import { QuickReplyService } from './quick-reply.service';
import { RichMenuService } from './rich-menu/rich-menu.service';
import { LineWebhookGuard } from './line-webhook.guard';
import { LineWebhookBody, LineMessageEvent, LinePostbackEvent, LineFollowEvent } from './dto/webhook-event.dto';
import {
  CHATBOT_RESPONSES,
  ANDROID_KEYWORDS,
  IPAD_USED_KEYWORDS,
  GREETING_KEYWORDS,
} from './chatbot-system-prompt.constants';
import { PrismaService } from '../../prisma/prisma.service';
import { buildWelcomeFlex, buildReWelcomeFlex } from './flex-messages/welcome.flex';
import { PromptPayQrService } from './promptpay/promptpay-qr.service';
import { PaymentLinkService } from './payment-links/payment-link.service';
import { SkipCsrf } from '../../guards/skip-csrf.decorator';
import { StorageService } from '../storage/storage.service';
import { WebhookDedupService } from '../chatbot-finance/services/webhook-dedup.service';
import { MessageRouterService } from '../chat-engine/services/message-router.service';
import { formatStickerToken } from '../chat-engine/utils/sticker-token.util';
import { ChatChannel, MessageType } from '@prisma/client';
import { toNum as d, calcOutstanding as sumOutstanding } from '../../utils/decimal.util';
import { buildBrowserUrl } from '../../utils/line-login.util';

/**
 * SHOP OA Chatbot — webhook handler + auto-reply commands.
 * Handles LINE webhook events: text messages, images (slips), postbacks, follow/unfollow.
 */
@ApiTags('LINE OA - Chatbot')
@Controller('line-oa')
export class LineOaChatbotController {
  private readonly logger = new Logger(LineOaChatbotController.name);

  constructor(
    private lineOaService: LineOaService,
    private chatbotService: ChatbotService,
    private quickReplyService: QuickReplyService,
    private richMenuService: RichMenuService,
    private prisma: PrismaService,
    private promptPayQrService: PromptPayQrService,
    private paymentLinkService: PaymentLinkService,
    private storageService: StorageService,
    private webhookDedupService: WebhookDedupService,
    private messageRouter: MessageRouterService,
  ) {}

  // ─── LINE Webhook ─────────────────────────────────────

  @Post('webhook')
  @SkipCsrf()
  @UseGuards(LineWebhookGuard)
  @HttpCode(200)
  async handleWebhook(@Req() req: Request): Promise<string> {
    const body = req.body as LineWebhookBody;

    if (!body.events || body.events.length === 0) {
      return 'OK';
    }

    for (const event of body.events) {
      if ((event as { deliveryContext?: { isRedelivery?: boolean } }).deliveryContext?.isRedelivery) {
        continue;
      }
      const eventId = (event as { webhookEventId?: string }).webhookEventId;
      if (eventId && await this.webhookDedupService.isDuplicate(eventId)) {
        this.logger.log(`[SHOP webhook] Skip duplicate event: ${eventId}`);
        continue;
      }

      try {
        await this.processEvent(event);
      } catch (err) {
        this.logger.error(`Error processing LINE event: ${err instanceof Error ? err.message : err}`);
        Sentry.captureException(err, {
          tags: { module: 'line-shop-webhook' },
          extra: { eventId, eventType: event.type },
        });
      }
    }

    return 'OK';
  }

  private async processEvent(event: LineWebhookBody['events'][number]): Promise<void> {
    switch (event.type) {
      case 'message': {
        const msgEvent = event as LineMessageEvent;
        if (msgEvent.message.type === 'text') {
          await this.handleTextMessage(msgEvent);
        } else if (msgEvent.message.type === 'image') {
          await this.handleImageMessage(msgEvent);
        } else if (msgEvent.message.type === 'sticker') {
          await this.handleStickerMessage(msgEvent);
        }
        break;
      }
      case 'follow':
        await this.handleFollow(event as LineFollowEvent);
        break;
      case 'unfollow':
        await this.lineOaService.unlinkLineId(event.source.userId);
        break;
      case 'postback':
        await this.handlePostback(event as LinePostbackEvent);
        break;
    }
  }

  // ─── Follow Handler ───────────────────────────────────

  private async handleFollow(event: LineFollowEvent): Promise<void> {
    const userId = event.source.userId;

    // Link LINE ID to customer (idempotent — no-op if already linked)
    await this.lineOaService.linkLineId(userId);

    // Check if already verified (re-follow vs new follow)
    const customer = await this.lineOaService.findCustomerByLineId(userId);

    if (customer) {
      // Re-follow: verified customer returning
      try {
        await this.richMenuService.switchRichMenu(userId, true, 'shop');
      } catch (err) {
        this.logger.warn(`Failed to switch Rich Menu on re-follow: ${err instanceof Error ? err.message : err}`);
      }

      const reWelcomeFlex = buildReWelcomeFlex(customer.name);
      const reWelcomeMsg = {
        ...reWelcomeFlex,
        quickReply: { items: this.quickReplyService.verifiedReturn() },
      };
      await this.lineOaService.replyMessage(event.replyToken, [reWelcomeMsg], 'line-shop');
      return;
    }

    // New follow: not yet verified
    try {
      await this.richMenuService.switchRichMenu(userId, false, 'shop');
    } catch (err) {
      this.logger.warn(`Failed to switch Rich Menu on new follow: ${err instanceof Error ? err.message : err}`);
    }

    // Check SystemConfig for custom greeting override
    const [greetingConfig, quickReplyConfig] = await Promise.all([
      this.prisma.systemConfig.findUnique({ where: { key: 'line.greetingMessages' } }),
      this.prisma.systemConfig.findUnique({ where: { key: 'line.greetingQuickReply' } }),
    ]);

    const showQuickReply = quickReplyConfig?.value !== 'false';
    let lineMessages: any[];

    if (greetingConfig?.value) {
      try {
        const stored: Array<{ type: string; content: any }> = JSON.parse(greetingConfig.value);
        lineMessages = stored.map((item, idx) => {
          const isLast = idx === stored.length - 1;
          const quickReplyObj = isLast && showQuickReply ? { quickReply: { items: this.quickReplyService.shopOnboarding() } } : {};

          if (item.type === 'text') {
            return { type: 'text', text: item.content?.text || '', ...quickReplyObj };
          }
          if (item.type === 'image') {
            return { type: 'image', originalContentUrl: item.content?.imageUrl || '', previewImageUrl: item.content?.imageUrl || '', ...quickReplyObj };
          }
          if (item.type === 'flex') {
            let flexContents: any;
            if (item.content?.flexMode === 'json') {
              try { flexContents = JSON.parse(item.content.jsonText); } catch { flexContents = null; }
            } else {
              flexContents = item.content?.flexContents || null;
            }
            if (!flexContents) return null;
            return { type: 'flex', altText: item.content?.altText || 'ข้อความจาก BESTCHOICE', contents: flexContents, ...quickReplyObj };
          }
          return null;
        }).filter(Boolean);
      } catch {
        lineMessages = [];
      }
    } else {
      lineMessages = [];
    }

    if (lineMessages.length === 0) {
      // Fallback: send Welcome Flex with register URL
      const liffRegisterUrl = buildBrowserUrl('/liff/register');
      const welcomeFlex = buildWelcomeFlex({ oaType: 'shop', liffRegisterUrl });
      lineMessages = [
        {
          ...welcomeFlex,
          ...(showQuickReply ? { quickReply: { items: this.quickReplyService.shopOnboarding() } } : {}),
        },
      ];
    }

    await this.lineOaService.replyMessage(event.replyToken, lineMessages, 'line-shop');
  }

  // ─── Text Message Handler ─────────────────────────────

  private isBusinessHours(): boolean {
    const now = new Date();
    const bangkokOffset = 7 * 60;
    const localMinutes = (now.getUTCHours() * 60 + now.getUTCMinutes() + bangkokOffset) % (24 * 60);
    return localMinutes >= 9 * 60 && localMinutes < 18 * 60;
  }

  private async handleTextMessage(event: LineMessageEvent): Promise<void> {
    if (event.message.type !== 'text') return;
    const text = event.message.text.trim();
    const textLower = text.toLowerCase();
    const userId = event.source.userId;

    // Mirror to Unified Inbox (best-effort — never block Shop bot reply flow)
    try {
      await this.messageRouter.mirrorInbound({
        externalMessageId: event.message.id,
        externalUserId: userId,
        channel: ChatChannel.LINE_SHOP,
        type: MessageType.TEXT,
        text,
      });
    } catch (err) {
      this.logger.warn(`[SHOP mirror] text: ${err instanceof Error ? err.message : err}`);
    }

    // Owner self-register
    if (textLower === '#owner') {
      try {
        await this.prisma.systemConfig.upsert({
          where: { key: 'owner_line_id' },
          create: { key: 'owner_line_id', value: userId, label: 'LINE User ID เจ้าของ' },
          update: { value: userId },
        });
        await this.lineOaService.replyMessage(event.replyToken, [
          { type: 'text', text: `บันทึก Owner LINE ID เรียบร้อยแล้วค่ะ\n\nUser ID: ${userId}\n\nตอนนี้สามารถใช้ "ส่งทดสอบ" จากหน้าตั้งค่า LINE OA ได้เลยค่ะ` },
        ], 'line-shop');
      } catch {
        await this.lineOaService.replyMessage(event.replyToken, [
          { type: 'text', text: 'ไม่สามารถบันทึกได้ กรุณาลองใหม่อีกครั้ง' },
        ], 'line-shop');
      }
      return;
    }

    // Self-link by phone
    if (/^0\d{9}$/.test(text)) {
      const result = await this.lineOaService.selfLinkByPhone(userId, text);
      if (result.success && result.customerName) {
        await this.lineOaService.replyMessage(event.replyToken, [
          { type: 'text', text: `ผูกบัญชีสำเร็จค่ะ คุณ${result.customerName} 🎉\n\nตอนนี้สามารถใช้คำสั่งต่างๆ ได้แล้วค่ะ:\n• "เช็คยอด" - ดูยอดค้างชำระ\n• "งวด" - ดูตารางค่างวด\n• "ชำระ" - ชำระเงิน` },
        ], 'line-shop');
        return;
      }
      const existing = await this.lineOaService.findCustomerByLineId(userId);
      if (!existing) {
        await this.lineOaService.replyMessage(event.replyToken, [
          { type: 'text', text: 'ไม่พบข้อมูลเบอร์โทรนี้ในระบบค่ะ กรุณาตรวจสอบเบอร์โทร หรือติดต่อสาขาเพื่อลงทะเบียน' },
        ], 'line-shop');
        return;
      }
    }

    // Outside-hours auto-reply
    if (!this.isBusinessHours()) {
      await this.lineOaService.replyMessage(event.replyToken, [
        { type: 'text', text: CHATBOT_RESPONSES.outsideHours },
      ], 'line-shop');
      return;
    }

    if (['ยอด', 'เช็คยอด', 'ยอดค้าง', 'balance'].includes(textLower)) {
      await this.handleCheckBalance(userId, event.replyToken);
    } else if (['งวด', 'ตารางงวด', 'installment'].includes(textLower)) {
      await this.handleCheckInstallments(userId, event.replyToken);
    } else if (['ชำระ', 'จ่าย', 'pay', 'payment'].includes(textLower)) {
      await this.handlePaymentRequest(userId, event.replyToken);
    } else if (['ใบเสร็จ', 'receipt'].includes(textLower)) {
      await this.handleReceipt(userId, event.replyToken);
    } else if (['ติดต่อ', 'contact'].includes(textLower)) {
      await this.handleContact(userId, event.replyToken);
    } else if (['สัญญา', 'contract'].includes(textLower)) {
      await this.handleContractLink(userId, event.replyToken);
    } else if (['ลงทะเบียน', 'register', 'สมัคร'].includes(textLower)) {
      await this.handleRegisterLink(userId, event.replyToken);
    } else if (['ช่วยเหลือ', 'help', 'เมนู', 'menu'].includes(textLower)) {
      await this.handleHelp(event.replyToken);
    } else if (GREETING_KEYWORDS.some((kw) => textLower.includes(kw))) {
      await this.handleGreeting(event.replyToken);
    } else if (ANDROID_KEYWORDS.some((kw) => textLower.includes(kw))) {
      await this.handleAndroidRedirect(event.replyToken);
    } else if (IPAD_USED_KEYWORDS.some((kw) => textLower.includes(kw))) {
      await this.handleIpadUsedRedirect(event.replyToken);
    } else {
      await this.handleFreeformMessage(text, event.replyToken, userId);
    }
  }

  // ─── Sticker Handler ──────────────────────────────────
  // Customer-sent stickers are mirrored to Unified Inbox as a
  // [sticker:packageId:stickerId] token so MessageBubble can render the image.

  private async handleStickerMessage(event: LineMessageEvent): Promise<void> {
    if (event.message.type !== 'sticker') return;
    const { packageId, stickerId } = event.message;
    try {
      await this.messageRouter.mirrorInbound({
        externalMessageId: event.message.id,
        externalUserId: event.source.userId,
        channel: ChatChannel.LINE_SHOP,
        type: MessageType.TEXT,
        text: formatStickerToken(packageId, stickerId),
      });
    } catch (err) {
      this.logger.warn(`[SHOP mirror] sticker: ${err instanceof Error ? err.message : err}`);
    }
  }

  // ─── Image (Slip) Handler ─────────────────────────────

  private async handleImageMessage(event: LineMessageEvent): Promise<void> {
    if (event.message.type !== 'image') return;
    const userId = event.source.userId;

    // Mirror to Unified Inbox (best-effort — image URL filled after upload below)
    try {
      await this.messageRouter.mirrorInbound({
        externalMessageId: event.message.id,
        externalUserId: userId,
        channel: ChatChannel.LINE_SHOP,
        type: MessageType.IMAGE,
      });
    } catch (err) {
      this.logger.warn(`[SHOP mirror] image: ${err instanceof Error ? err.message : err}`);
    }

    const customer = await this.lineOaService.findCustomerByLineId(userId);
    if (!customer) {
      await this.lineOaService.replyMessage(event.replyToken, [
        { type: 'text', text: 'ยังไม่ได้เชื่อมบัญชีค่ะ กรุณาพิมพ์เบอร์โทรศัพท์ที่ลงทะเบียนไว้เพื่อเชื่อมบัญชีก่อนนะคะ\n\nตัวอย่าง: 0812345678' },
      ], 'line-shop');
      return;
    }

    const activeContract = customer.contracts.find((c) => c.payments.some((p) => p.status !== 'PAID'));
    if (!activeContract) {
      await this.lineOaService.replyMessage(event.replyToken, [
        { type: 'text', text: 'ไม่พบงวดค้างชำระ ชำระครบทุกงวดแล้วค่ะ' },
      ], 'line-shop');
      return;
    }

    try {
      const imageBuffer = await this.lineOaService.downloadContent(event.message.id, 'line-shop');
      const filename = `slips/slip-${userId}-${Date.now()}.jpg`;
      await this.storageService.upload(filename, imageBuffer, 'image/jpeg');

      const evidence = await this.prisma.paymentEvidence.create({
        data: { contractId: activeContract.id, lineUserId: userId, imageUrl: filename, status: 'PENDING_REVIEW' },
      });

      await this.prisma.notificationLog.create({
        data: {
          channel: 'IN_APP', recipient: 'STAFF',
          subject: `สลิปใหม่จาก ${customer.name}`,
          message: `ลูกค้า ${customer.name} ส่งสลิปชำระเงิน สัญญา ${activeContract.contractNumber} รอตรวจสอบ`,
          status: 'SENT', relatedId: evidence.id, sentAt: new Date(),
        },
      });

      await this.lineOaService.replyMessage(event.replyToken, [
        { type: 'text', text: `รับสลิปเรียบร้อยแล้วค่ะ คุณ${customer.name}\nสัญญา: ${activeContract.contractNumber}\n\nกำลังตรวจสอบ จะแจ้งผลให้ทราบภายหลังค่ะ` },
      ], 'line-shop');
    } catch (err) {
      this.logger.error(`Error processing slip: ${err instanceof Error ? err.message : err}`);
      await this.lineOaService.replyMessage(event.replyToken, [
        { type: 'text', text: 'ขออภัยค่ะ เกิดข้อผิดพลาดในการรับสลิป กรุณาลองใหม่อีกครั้ง' },
      ], 'line-shop');
    }
  }

  // ─── Command Handlers ─────────────────────────────────

  private async handleCheckBalance(userId: string, replyToken: string): Promise<void> {
    const customer = await this.lineOaService.findCustomerByLineId(userId);
    if (!customer) {
      await this.lineOaService.replyMessage(replyToken, [
        { type: 'text', text: 'ยังไม่ได้เชื่อมบัญชีค่ะ กรุณาพิมพ์เบอร์โทรศัพท์ที่ลงทะเบียนไว้เพื่อเชื่อมบัญชีก่อนนะคะ\n\nตัวอย่าง: 0812345678' },
      ], 'line-shop');
      return;
    }
    if (customer.contracts.length === 0) {
      await this.lineOaService.replyMessage(replyToken, [
        { type: 'text', text: `คุณ${customer.name} ไม่มีสัญญาที่ใช้งานอยู่ค่ะ` },
      ], 'line-shop');
      return;
    }

    const contractsData = customer.contracts.map((c) => {
      const paidPayments = c.payments.filter((p) => p.status === 'PAID');
      const nextPending = c.payments.find((p) => p.status !== 'PAID');
      const unpaid = c.payments.filter((p) => p.status !== 'PAID');
      return {
        contractNumber: c.contractNumber,
        totalInstallments: c.payments.length,
        paidInstallments: paidPayments.length,
        nextDueDate: nextPending ? formatDateShort(nextPending.dueDate) : null,
        nextAmountDue: nextPending ? sumOutstanding([nextPending]) : 0,
        totalOutstanding: Math.round(sumOutstanding(unpaid)),
        status: c.status,
      };
    });

    const flex = this.lineOaService.buildBalanceSummary({ customerName: customer.name, contracts: contractsData });
    await this.lineOaService.replyMessage(replyToken, [flex], 'line-shop');
  }

  private async handleCheckInstallments(userId: string, replyToken: string, contractNumber?: string): Promise<void> {
    const customer = await this.lineOaService.findCustomerByLineId(userId);
    if (!customer) { await this.lineOaService.replyMessage(replyToken, [{ type: 'text', text: 'ยังไม่ได้เชื่อมบัญชีค่ะ กรุณาพิมพ์เบอร์โทรศัพท์ที่ลงทะเบียนไว้เพื่อเชื่อมบัญชีก่อนนะคะ\n\nตัวอย่าง: 0812345678' }], 'line-shop'); return; }
    if (customer.contracts.length === 0) { await this.lineOaService.replyMessage(replyToken, [{ type: 'text', text: `คุณ${customer.name} ไม่มีสัญญาที่ใช้งานอยู่ค่ะ` }], 'line-shop'); return; }

    if (!contractNumber && customer.contracts.length > 1) {
      const options = customer.contracts.map((c) => ({
        contractNumber: c.contractNumber, status: c.status,
        totalOutstanding: sumOutstanding(c.payments.filter((p) => p.status !== 'PAID')),
      }));
      const flex = this.lineOaService.buildContractSelector(customer.name, options, 'check_installments');
      await this.lineOaService.replyMessage(replyToken, [flex], 'line-shop');
      return;
    }

    const contract = contractNumber
      ? customer.contracts.find((c) => c.contractNumber === contractNumber) || customer.contracts[0]
      : customer.contracts[0];

    const lines = contract.payments.map((p) => {
      const status = p.status === 'PAID' ? '✅' : p.status === 'OVERDUE' ? '❌' : p.status === 'PARTIALLY_PAID' ? '⏳' : '⬜';
      return `${status} งวด ${p.installmentNo} | ${formatDateShortThai(p.dueDate)} | ${d(p.amountDue).toLocaleString()} บาท`;
    });

    await this.lineOaService.replyMessage(replyToken, [
      { type: 'text', text: `ตารางค่างวด: ${contract.contractNumber}\n\n${lines.join('\n')}\n\n✅ ชำระแล้ว  ⬜ รอชำระ  ❌ ค้างชำระ` },
    ], 'line-shop');
  }

  private async handlePaymentRequest(userId: string, replyToken: string, contractNumber?: string): Promise<void> {
    const customer = await this.lineOaService.findCustomerByLineId(userId);
    if (!customer) { await this.lineOaService.replyMessage(replyToken, [{ type: 'text', text: 'ยังไม่ได้เชื่อมบัญชีค่ะ กรุณาพิมพ์เบอร์โทรศัพท์ที่ลงทะเบียนไว้เพื่อเชื่อมบัญชีก่อนนะคะ\n\nตัวอย่าง: 0812345678' }], 'line-shop'); return; }
    if (customer.contracts.length === 0) { await this.lineOaService.replyMessage(replyToken, [{ type: 'text', text: `คุณ${customer.name} ไม่มีสัญญาที่ใช้งานอยู่ค่ะ` }], 'line-shop'); return; }

    if (!contractNumber && customer.contracts.length > 1) {
      const options = customer.contracts.map((c) => ({
        contractNumber: c.contractNumber, status: c.status,
        totalOutstanding: sumOutstanding(c.payments.filter((p) => p.status !== 'PAID')),
      }));
      const flex = this.lineOaService.buildContractSelector(customer.name, options, 'pay');
      await this.lineOaService.replyMessage(replyToken, [flex], 'line-shop');
      return;
    }

    const contract = contractNumber ? customer.contracts.find((c) => c.contractNumber === contractNumber) || customer.contracts[0] : customer.contracts[0];
    const nextPayment = contract.payments.find((p) => p.status !== 'PAID');
    if (!nextPayment) { await this.lineOaService.replyMessage(replyToken, [{ type: 'text', text: 'ชำระครบทุกงวดแล้วค่ะ ขอบคุณค่ะ' }], 'line-shop'); return; }

    const amount = sumOutstanding([nextPayment]);
    try {
      const qrDataUrl = await this.promptPayQrService.generateQrDataUrl(amount);
      const paymentLink = await this.paymentLinkService.createPaymentLink(contract.id, nextPayment.installmentNo);
      const flex = this.lineOaService.buildPromptPayQr({
        customerName: customer.name, contractNumber: contract.contractNumber,
        installmentNo: nextPayment.installmentNo, totalInstallments: contract.payments.length,
        amount, qrImageUrl: qrDataUrl, accountName: this.promptPayQrService.getAccountName(),
        maskedPromptPayId: this.promptPayQrService.getMaskedPromptPayId(), paymentLinkUrl: paymentLink.url,
      });
      await this.lineOaService.replyMessage(replyToken, [flex], 'line-shop');
    } catch (err) {
      this.logger.warn(`QR generation failed: ${err}`);
      let bankInfo = '';
      try {
        const [bankName, bankAccount, bankAccountName] = await Promise.all([
          this.prisma.systemConfig.findUnique({ where: { key: 'bank_name' } }),
          this.prisma.systemConfig.findUnique({ where: { key: 'bank_account_number' } }),
          this.prisma.systemConfig.findUnique({ where: { key: 'bank_account_name' } }),
        ]);
        if (bankAccount?.value) bankInfo = `\n\nโอนเงินได้ที่:\n🏦 ${bankName?.value || 'ธนาคาร'}\nเลขบัญชี: ${bankAccount.value}\nชื่อบัญชี: ${bankAccountName?.value || '-'}`;
      } catch { /* ignore */ }
      await this.lineOaService.replyMessage(replyToken, [
        { type: 'text', text: `ข้อมูลชำระเงิน:\nสัญญา: ${contract.contractNumber}\nงวดที่: ${nextPayment.installmentNo}/${contract.payments.length}\nยอด: ${amount.toLocaleString()} บาท\nกำหนด: ${formatDateShort(nextPayment.dueDate)}${bankInfo}\n\nหลังโอนเงินแล้ว ส่งสลิปมาในแชทนี้ได้เลยค่ะ` },
      ], 'line-shop');
    }
  }

  private async handleReceipt(userId: string, replyToken: string): Promise<void> {
    const customer = await this.lineOaService.findCustomerByLineId(userId);
    if (!customer) { await this.lineOaService.replyMessage(replyToken, [{ type: 'text', text: 'ยังไม่ได้เชื่อมบัญชีค่ะ กรุณาพิมพ์เบอร์โทรศัพท์ที่ลงทะเบียนไว้เพื่อเชื่อมบัญชีก่อนนะคะ\n\nตัวอย่าง: 0812345678' }], 'line-shop'); return; }
    if (customer.contracts.length === 0) { await this.lineOaService.replyMessage(replyToken, [{ type: 'text', text: `คุณ${customer.name} ไม่มีสัญญาที่ใช้งานอยู่ค่ะ` }], 'line-shop'); return; }

    const contractsData = customer.contracts.map((c) => ({
      contractNumber: c.contractNumber,
      payments: c.payments.filter((p) => p.status === 'PAID').sort((a, b) => b.installmentNo - a.installmentNo).slice(0, 5)
        .map((p) => ({ installmentNo: p.installmentNo, amountPaid: d(p.amountPaid), paidDate: p.paidDate ? formatDateShort(p.paidDate) : '-' })),
      remainingCount: c.payments.filter((p) => p.status !== 'PAID').length,
    }));

    if (contractsData.every((c) => c.payments.length === 0)) {
      await this.lineOaService.replyMessage(replyToken, [{ type: 'text', text: 'ยังไม่มีรายการชำระเงินค่ะ' }], 'line-shop');
      return;
    }
    const flex = this.lineOaService.buildReceiptHistory({ customerName: customer.name, contracts: contractsData });
    await this.lineOaService.replyMessage(replyToken, [flex], 'line-shop');
  }

  private async handleContact(userId: string, replyToken: string): Promise<void> {
    const branch = await this.lineOaService.findBranchForCustomer(userId);
    if (!branch) { await this.lineOaService.replyMessage(replyToken, [{ type: 'text', text: 'กรุณาติดต่อสาขา BEST CHOICE ใกล้บ้านค่ะ' }], 'line-shop'); return; }
    const parts = ['📍 ข้อมูลติดต่อสาขา\n', `🏢 ${branch.name}`];
    if (branch.phone) parts.push(`📞 ${branch.phone}`);
    if (branch.location) parts.push(`📍 ${branch.location}`);
    await this.lineOaService.replyMessage(replyToken, [{ type: 'text', text: parts.join('\n') }], 'line-shop');
  }

  private async handlePostback(event: LinePostbackEvent): Promise<void> {
    const params = new URLSearchParams(event.postback.data);
    const action = params.get('action');
    const contractNumber = params.get('contract') || undefined;
    const userId = event.source.userId;
    switch (action) {
      case 'check_balance': await this.handleCheckBalance(userId, event.replyToken); break;
      case 'check_installments': await this.handleCheckInstallments(userId, event.replyToken, contractNumber); break;
      case 'pay': await this.handlePaymentRequest(userId, event.replyToken, contractNumber); break;
      default: this.logger.warn(`Unknown postback action: ${action}`);
    }
  }

  private async handleContractLink(userId: string, replyToken: string): Promise<void> {
    const customer = await this.lineOaService.findCustomerByLineId(userId);
    if (!customer) {
      await this.lineOaService.replyMessage(replyToken, [{ type: 'text', text: `ยังไม่ได้เชื่อมบัญชีค่ะ กรุณาลงทะเบียนก่อนนะคะ\n\n👉 ลงทะเบียน:\n${buildBrowserUrl('/liff/register')}\n\nหรือพิมพ์เบอร์โทรที่ลงทะเบียนไว้เพื่อเชื่อมบัญชี` }], 'line-shop');
      return;
    }
    await this.lineOaService.replyMessage(replyToken, [{ type: 'text', text: `คุณ${customer.name} สามารถดูข้อมูลสัญญาทั้งหมดได้ที่ลิงก์ด้านล่างค่ะ\n\n📋 ดูสัญญา:\n${buildBrowserUrl('/liff/contract')}` }], 'line-shop');
  }

  private async handleRegisterLink(userId: string, replyToken: string): Promise<void> {
    const customer = await this.lineOaService.findCustomerByLineId(userId);
    if (customer) {
      await this.lineOaService.replyMessage(replyToken, [{ type: 'text', text: `คุณ${customer.name} ลงทะเบียนแล้วค่ะ\n\n📋 ดูสัญญา:\n${buildBrowserUrl('/liff/contract')}` }], 'line-shop');
      return;
    }
    await this.lineOaService.replyMessage(replyToken, [{ type: 'text', text: `กรุณาลงทะเบียนเพื่อผูกบัญชี LINE กับระบบค่ะ\n\n👉 ลงทะเบียน:\n${buildBrowserUrl('/liff/register')}\n\nหรือพิมพ์เบอร์โทรที่ลงทะเบียนไว้เพื่อเชื่อมบัญชี` }], 'line-shop');
  }

  private async handleGreeting(replyToken: string): Promise<void> {
    await this.lineOaService.replyMessage(replyToken, [{ type: 'text', text: CHATBOT_RESPONSES.onboarding }], 'line-shop');
  }

  private async handleAndroidRedirect(replyToken: string): Promise<void> {
    await this.lineOaService.replyMessage(replyToken, [{ type: 'text', text: CHATBOT_RESPONSES.androidRedirect }], 'line-shop');
  }

  private async handleIpadUsedRedirect(replyToken: string): Promise<void> {
    await this.lineOaService.replyMessage(replyToken, [{ type: 'text', text: CHATBOT_RESPONSES.ipadUsedRedirect }], 'line-shop');
  }

  private async handleFreeformMessage(text: string, replyToken: string, userId?: string): Promise<void> {
    const aiResponse = await this.chatbotService.generateResponse(text, userId);
    await this.lineOaService.replyMessage(replyToken, [
      { type: 'text', text: aiResponse ?? 'ได้รับข้อความแล้วค่ะ น้องเบสจะตอบกลับภายใน 5 นาทีนะคะ 🙏' },
    ], 'line-shop');
  }

  private async handleHelp(replyToken: string): Promise<void> {
    await this.lineOaService.replyMessage(replyToken, [
      { type: 'text', text: '📋 คำสั่งที่ใช้ได้:\n\n💰 "เช็คยอด" - ดูยอดค้างชำระ\n📊 "งวด" - ดูตารางค่างวดทั้งหมด\n💳 "ชำระ" - ข้อมูลการชำระเงิน\n📋 "สัญญา" - ดูข้อมูลสัญญา\n🧾 "ใบเสร็จ" - ดูประวัติการชำระ\n📞 "ติดต่อ" - ข้อมูลติดต่อสาขา\n🔗 "ลงทะเบียน" - ผูกบัญชี LINE\n📷 ส่งรูปสลิป - แจ้งชำระเงิน\n❓ "ช่วยเหลือ" - แสดงเมนูนี้\n\nหรือกดเมนูด้านล่างได้เลยค่ะ' },
    ], 'line-shop');
  }
}
