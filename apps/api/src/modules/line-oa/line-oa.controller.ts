import {
  formatDateShort,
  formatDateShortThai,
} from '../../utils/thai-date.util';
import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Req,
  UseGuards,
  Logger,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { LineOaService } from './line-oa.service';
import { ChatbotService } from './chatbot.service';
import { LineWebhookGuard } from './line-webhook.guard';
import { LineWebhookBody, LineMessageEvent, LinePostbackEvent } from './dto/webhook-event.dto';
import {
  CHATBOT_RESPONSES,
  ANDROID_KEYWORDS,
  IPAD_USED_KEYWORDS,
  GREETING_KEYWORDS,
} from './chatbot-system-prompt.constants';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PromptPayQrService } from './promptpay/promptpay-qr.service';
import { PaymentLinkService } from './payment-links/payment-link.service';
import { SkipCsrf } from '../../guards/skip-csrf.decorator';
import { StorageService } from '../storage/storage.service';
import { WebhookDedupService } from '../chatbot-finance/services/webhook-dedup.service';
import { toNum as d, calcOutstanding as sumOutstanding } from '../../utils/decimal.util';

@ApiTags('LINE OA')
@ApiBearerAuth('JWT')
@Controller('line-oa')
export class LineOaController {
  private readonly logger = new Logger(LineOaController.name);

  constructor(
    private lineOaService: LineOaService,
    private chatbotService: ChatbotService,
    private prisma: PrismaService,
    private promptPayQrService: PromptPayQrService,
    private paymentLinkService: PaymentLinkService,
    private storageService: StorageService,
    private webhookDedupService: WebhookDedupService,
  ) {}

  // ─── LINE Webhook ─────────────────────────────────────

  @Post('webhook')
  @SkipCsrf()
  @UseGuards(LineWebhookGuard)
  @HttpCode(200)
  async handleWebhook(@Req() req: Request): Promise<string> {
    const body = req.body as LineWebhookBody;

    if (!body.events || body.events.length === 0) {
      return 'OK'; // LINE sends empty events for webhook verification
    }

    // Process events with DB-based dedup (safe for multi-instance Cloud Run)
    for (const event of body.events) {
      // Skip redelivered events
      if ((event as { deliveryContext?: { isRedelivery?: boolean } }).deliveryContext?.isRedelivery) {
        continue;
      }
      // Dedup by webhookEventId
      const eventId = (event as { webhookEventId?: string }).webhookEventId;
      if (eventId && await this.webhookDedupService.isDuplicate(eventId)) {
        this.logger.log(`[SHOP webhook] Skip duplicate event: ${eventId}`);
        continue;
      }

      try {
        await this.processEvent(event);
      } catch (err) {
        this.logger.error(`Error processing LINE event: ${err instanceof Error ? err.message : err}`);
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
        }
        break;
      }
      case 'follow':
        await this.lineOaService.linkLineId(event.source.userId);
        break;
      case 'unfollow':
        await this.lineOaService.unlinkLineId(event.source.userId);
        break;
      case 'postback':
        await this.handlePostback(event as LinePostbackEvent);
        break;
    }
  }

  // ─── Text Message Handler ─────────────────────────────

  private isBusinessHours(): boolean {
    const now = new Date();
    const bangkokOffset = 7 * 60; // UTC+7
    const localMinutes = (now.getUTCHours() * 60 + now.getUTCMinutes() + bangkokOffset) % (24 * 60);
    return localMinutes >= 9 * 60 && localMinutes < 18 * 60;
  }

  private async handleTextMessage(event: LineMessageEvent): Promise<void> {
    if (event.message.type !== 'text') return;
    const text = event.message.text.trim();
    const textLower = text.toLowerCase();
    const userId = event.source.userId;

    // Owner self-register: save LINE User ID as owner_line_id (ทำงานตลอด 24h)
    if (textLower === '#owner') {
      try {
        await this.prisma.systemConfig.upsert({
          where: { key: 'owner_line_id' },
          create: { key: 'owner_line_id', value: userId, label: 'LINE User ID เจ้าของ' },
          update: { value: userId },
        });
        await this.lineOaService.replyMessage(event.replyToken, [
          { type: 'text', text: `บันทึก Owner LINE ID เรียบร้อยแล้วค่ะ\n\nUser ID: ${userId}\n\nตอนนี้สามารถใช้ "ส่งทดสอบ" จากหน้าตั้งค่า LINE OA ได้เลยค่ะ` },
        ]);
      } catch {
        await this.lineOaService.replyMessage(event.replyToken, [
          { type: 'text', text: 'ไม่สามารถบันทึกได้ กรุณาลองใหม่อีกครั้ง' },
        ]);
      }
      return;
    }

    // Self-link: if text is a phone number and user is not linked yet
    if (/^0\d{9}$/.test(text)) {
      const result = await this.lineOaService.selfLinkByPhone(userId, text);
      if (result.success && result.customerName) {
        await this.lineOaService.replyMessage(event.replyToken, [
          { type: 'text', text: `ผูกบัญชีสำเร็จค่ะ คุณ${result.customerName} 🎉\n\nตอนนี้สามารถใช้คำสั่งต่างๆ ได้แล้วค่ะ:\n• "เช็คยอด" - ดูยอดค้างชำระ\n• "งวด" - ดูตารางค่างวด\n• "ชำระ" - ชำระเงิน` },
        ]);
        return;
      }
      // If already linked, check if it was an existing link (not a failed search)
      const existing = await this.lineOaService.findCustomerByLineId(userId);
      if (existing) {
        // User is already linked, treat phone as unknown command — fall through
      } else {
        await this.lineOaService.replyMessage(event.replyToken, [
          { type: 'text', text: 'ไม่พบข้อมูลเบอร์โทรนี้ในระบบค่ะ กรุณาตรวจสอบเบอร์โทร หรือติดต่อสาขาเพื่อลงทะเบียน' },
        ]);
        return;
      }
    }

    // Outside-hours auto-reply (หลังผ่าน #owner และ phone self-link แล้ว)
    if (!this.isBusinessHours()) {
      await this.lineOaService.replyMessage(event.replyToken, [
        { type: 'text', text: CHATBOT_RESPONSES.outsideHours },
      ]);
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
      await this.handleFreeformMessage(text, event.replyToken);
    }
  }

  // ─── Image (Slip) Handler ─────────────────────────────

  private async handleImageMessage(event: LineMessageEvent): Promise<void> {
    if (event.message.type !== 'image') return;
    const userId = event.source.userId;

    const customer = await this.lineOaService.findCustomerByLineId(userId);

    if (!customer) {
      await this.lineOaService.replyMessage(event.replyToken, [
        {
          type: 'text',
          text: 'ยังไม่ได้เชื่อมบัญชีค่ะ กรุณาพิมพ์เบอร์โทรศัพท์ที่ลงทะเบียนไว้เพื่อเชื่อมบัญชีก่อนนะคะ\n\nตัวอย่าง: 0812345678',
        },
      ]);
      return;
    }

    const activeContract = customer.contracts.find((c) =>
      c.payments.some((p) => p.status !== 'PAID'),
    );

    if (!activeContract) {
      await this.lineOaService.replyMessage(event.replyToken, [
        { type: 'text', text: 'ไม่พบงวดค้างชำระ ชำระครบทุกงวดแล้วค่ะ' },
      ]);
      return;
    }

    try {
      // Download image from LINE Content API
      const imageBuffer = await this.lineOaService.downloadContent(event.message.id);

      // Upload to S3/GCS storage (ephemeral filesystem on Cloud Run)
      const filename = `slips/slip-${userId}-${Date.now()}.jpg`;
      await this.storageService.upload(filename, imageBuffer, 'image/jpeg');
      const imageUrl = filename;

      // Create PaymentEvidence record
      const evidence = await this.prisma.paymentEvidence.create({
        data: {
          contractId: activeContract.id,
          lineUserId: userId,
          imageUrl,
          status: 'PENDING_REVIEW',
        },
      });

      // Notify staff via IN_APP
      await this.prisma.notificationLog.create({
        data: {
          channel: 'IN_APP',
          recipient: 'STAFF',
          subject: `สลิปใหม่จาก ${customer.name}`,
          message: `ลูกค้า ${customer.name} ส่งสลิปชำระเงิน สัญญา ${activeContract.contractNumber} รอตรวจสอบ`,
          status: 'SENT',
          relatedId: evidence.id,
          sentAt: new Date(),
        },
      });

      await this.lineOaService.replyMessage(event.replyToken, [
        {
          type: 'text',
          text: `รับสลิปเรียบร้อยแล้วค่ะ คุณ${customer.name}\nสัญญา: ${activeContract.contractNumber}\n\nกำลังตรวจสอบ จะแจ้งผลให้ทราบภายหลังค่ะ`,
        },
      ]);

      this.logger.log(`[LINE] Slip received from ${customer.name} for contract ${activeContract.contractNumber}`);
    } catch (err) {
      this.logger.error(`Error processing slip: ${err instanceof Error ? err.message : err}`);
      await this.lineOaService.replyMessage(event.replyToken, [
        { type: 'text', text: 'ขออภัยค่ะ เกิดข้อผิดพลาดในการรับสลิป กรุณาลองใหม่อีกครั้ง' },
      ]);
    }
  }

  // ─── Auto-reply Command Handlers ──────────────────────

  private async handleCheckBalance(userId: string, replyToken: string): Promise<void> {
    const customer = await this.lineOaService.findCustomerByLineId(userId);

    if (!customer) {
      await this.lineOaService.replyMessage(replyToken, [
        { type: 'text', text: 'ยังไม่ได้เชื่อมบัญชีค่ะ กรุณาพิมพ์เบอร์โทรศัพท์ที่ลงทะเบียนไว้เพื่อเชื่อมบัญชีก่อนนะคะ\n\nตัวอย่าง: 0812345678' },
      ]);
      return;
    }

    if (customer.contracts.length === 0) {
      await this.lineOaService.replyMessage(replyToken, [
        { type: 'text', text: `คุณ${customer.name} ไม่มีสัญญาที่ใช้งานอยู่ค่ะ` },
      ]);
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
        nextDueDate: nextPending
          ? formatDateShort(nextPending.dueDate)
          : null,
        nextAmountDue: nextPending
          ? sumOutstanding([nextPending])
          : 0,
        totalOutstanding: Math.round(sumOutstanding(unpaid)),
        status: c.status,
      };
    });

    const flex = this.lineOaService.buildBalanceSummary({
      customerName: customer.name,
      contracts: contractsData,
    });

    await this.lineOaService.replyMessage(replyToken, [flex]);
  }

  private async handleCheckInstallments(userId: string, replyToken: string, contractNumber?: string): Promise<void> {
    const customer = await this.lineOaService.findCustomerByLineId(userId);

    if (!customer) {
      await this.lineOaService.replyMessage(replyToken, [
        { type: 'text', text: 'ยังไม่ได้เชื่อมบัญชีค่ะ กรุณาพิมพ์เบอร์โทรศัพท์ที่ลงทะเบียนไว้เพื่อเชื่อมบัญชีก่อนนะคะ\n\nตัวอย่าง: 0812345678' },
      ]);
      return;
    }

    if (customer.contracts.length === 0) {
      await this.lineOaService.replyMessage(replyToken, [
        { type: 'text', text: `คุณ${customer.name} ไม่มีสัญญาที่ใช้งานอยู่ค่ะ` },
      ]);
      return;
    }

    // Multi-contract: if no specific contract and multiple contracts, show selector
    if (!contractNumber && customer.contracts.length > 1) {
      const options = customer.contracts.map((c) => ({
        contractNumber: c.contractNumber,
        status: c.status,
        totalOutstanding: sumOutstanding(c.payments.filter((p) => p.status !== 'PAID')),
      }));
      const flex = this.lineOaService.buildContractSelector(customer.name, options, 'check_installments');
      await this.lineOaService.replyMessage(replyToken, [flex]);
      return;
    }

    const contract = contractNumber
      ? customer.contracts.find((c) => c.contractNumber === contractNumber) || customer.contracts[0]
      : customer.contracts[0];

    const lines = contract.payments.map((p) => {
      const status =
        p.status === 'PAID' ? '✅'
        : p.status === 'OVERDUE' ? '❌'
        : p.status === 'PARTIALLY_PAID' ? '⏳'
        : '⬜';
      const date = formatDateShortThai(p.dueDate);
      return `${status} งวด ${p.installmentNo} | ${date} | ${d(p.amountDue).toLocaleString()} บาท`;
    });

    await this.lineOaService.replyMessage(replyToken, [
      {
        type: 'text',
        text: `ตารางค่างวด: ${contract.contractNumber}\n\n${lines.join('\n')}\n\n✅ ชำระแล้ว  ⬜ รอชำระ  ❌ ค้างชำระ`,
      },
    ]);
  }

  private async handlePaymentRequest(userId: string, replyToken: string, contractNumber?: string): Promise<void> {
    const customer = await this.lineOaService.findCustomerByLineId(userId);

    if (!customer) {
      await this.lineOaService.replyMessage(replyToken, [
        { type: 'text', text: 'ยังไม่ได้เชื่อมบัญชีค่ะ กรุณาพิมพ์เบอร์โทรศัพท์ที่ลงทะเบียนไว้เพื่อเชื่อมบัญชีก่อนนะคะ\n\nตัวอย่าง: 0812345678' },
      ]);
      return;
    }

    if (customer.contracts.length === 0) {
      await this.lineOaService.replyMessage(replyToken, [
        { type: 'text', text: `คุณ${customer.name} ไม่มีสัญญาที่ใช้งานอยู่ค่ะ` },
      ]);
      return;
    }

    // Multi-contract: if no specific contract and multiple contracts, show selector
    if (!contractNumber && customer.contracts.length > 1) {
      const options = customer.contracts.map((c) => ({
        contractNumber: c.contractNumber,
        status: c.status,
        totalOutstanding: sumOutstanding(c.payments.filter((p) => p.status !== 'PAID')),
      }));
      const flex = this.lineOaService.buildContractSelector(customer.name, options, 'pay');
      await this.lineOaService.replyMessage(replyToken, [flex]);
      return;
    }

    const contract = contractNumber
      ? customer.contracts.find((c) => c.contractNumber === contractNumber) || customer.contracts[0]
      : customer.contracts[0];

    const nextPayment = contract.payments.find((p) => p.status !== 'PAID');

    if (!nextPayment) {
      await this.lineOaService.replyMessage(replyToken, [
        { type: 'text', text: 'ชำระครบทุกงวดแล้วค่ะ ขอบคุณค่ะ' },
      ]);
      return;
    }

    const amount = sumOutstanding([nextPayment]);

    // Generate PromptPay QR and payment link
    try {
      const qrDataUrl = await this.promptPayQrService.generateQrDataUrl(amount);
      const paymentLink = await this.paymentLinkService.createPaymentLink(contract.id, nextPayment.installmentNo);

      const flex = this.lineOaService.buildPromptPayQr({
        customerName: customer.name,
        contractNumber: contract.contractNumber,
        installmentNo: nextPayment.installmentNo,
        totalInstallments: contract.payments.length,
        amount,
        qrImageUrl: qrDataUrl,
        accountName: this.promptPayQrService.getAccountName(),
        maskedPromptPayId: this.promptPayQrService.getMaskedPromptPayId(),
        paymentLinkUrl: paymentLink.url,
      });

      await this.lineOaService.replyMessage(replyToken, [flex]);
    } catch (err) {
      // Fallback to text with bank account info if QR generation fails
      this.logger.warn(`QR generation failed, falling back to text: ${err}`);

      let bankInfo = '';
      try {
        const [bankName, bankAccount, bankAccountName] = await Promise.all([
          this.prisma.systemConfig.findUnique({ where: { key: 'bank_name' } }),
          this.prisma.systemConfig.findUnique({ where: { key: 'bank_account_number' } }),
          this.prisma.systemConfig.findUnique({ where: { key: 'bank_account_name' } }),
        ]);
        if (bankAccount?.value) {
          bankInfo = `\n\nโอนเงินได้ที่:\n🏦 ${bankName?.value || 'ธนาคาร'}\nเลขบัญชี: ${bankAccount.value}\nชื่อบัญชี: ${bankAccountName?.value || '-'}`;
        }
      } catch (err) {
        this.logger.warn('Bank config lookup failed', err instanceof Error ? err.message : err);
      }

      await this.lineOaService.replyMessage(replyToken, [
        {
          type: 'text',
          text: `ข้อมูลชำระเงิน:\nสัญญา: ${contract.contractNumber}\nงวดที่: ${nextPayment.installmentNo}/${contract.payments.length}\nยอด: ${amount.toLocaleString()} บาท\nกำหนด: ${formatDateShort(nextPayment.dueDate)}${bankInfo}\n\nหลังโอนเงินแล้ว ส่งสลิปมาในแชทนี้ได้เลยค่ะ`,
        },
      ]);
    }
  }

  private async handleReceipt(userId: string, replyToken: string): Promise<void> {
    const customer = await this.lineOaService.findCustomerByLineId(userId);

    if (!customer) {
      await this.lineOaService.replyMessage(replyToken, [
        { type: 'text', text: 'ยังไม่ได้เชื่อมบัญชีค่ะ กรุณาพิมพ์เบอร์โทรศัพท์ที่ลงทะเบียนไว้เพื่อเชื่อมบัญชีก่อนนะคะ\n\nตัวอย่าง: 0812345678' },
      ]);
      return;
    }

    if (customer.contracts.length === 0) {
      await this.lineOaService.replyMessage(replyToken, [
        { type: 'text', text: `คุณ${customer.name} ไม่มีสัญญาที่ใช้งานอยู่ค่ะ` },
      ]);
      return;
    }

    const contractsData = customer.contracts.map((c) => {
      const paidPayments = c.payments
        .filter((p) => p.status === 'PAID')
        .sort((a, b) => b.installmentNo - a.installmentNo)
        .slice(0, 5);

      return {
        contractNumber: c.contractNumber,
        payments: paidPayments.map((p) => ({
          installmentNo: p.installmentNo,
          amountPaid: d(p.amountPaid),
          paidDate: p.paidDate
            ? formatDateShort(p.paidDate)
            : '-',
        })),
        remainingCount: c.payments.filter((p) => p.status !== 'PAID').length,
      };
    });

    if (contractsData.every((c) => c.payments.length === 0)) {
      await this.lineOaService.replyMessage(replyToken, [
        { type: 'text', text: 'ยังไม่มีรายการชำระเงินค่ะ' },
      ]);
      return;
    }

    const flex = this.lineOaService.buildReceiptHistory({
      customerName: customer.name,
      contracts: contractsData,
    });

    await this.lineOaService.replyMessage(replyToken, [flex]);
  }

  private async handleContact(userId: string, replyToken: string): Promise<void> {
    const branch = await this.lineOaService.findBranchForCustomer(userId);

    if (!branch) {
      await this.lineOaService.replyMessage(replyToken, [
        { type: 'text', text: 'กรุณาติดต่อสาขา BEST CHOICE ใกล้บ้านค่ะ' },
      ]);
      return;
    }

    const parts = ['📍 ข้อมูลติดต่อสาขา\n'];
    parts.push(`🏢 ${branch.name}`);
    if (branch.phone) parts.push(`📞 ${branch.phone}`);
    if (branch.location) parts.push(`📍 ${branch.location}`);

    await this.lineOaService.replyMessage(replyToken, [
      { type: 'text', text: parts.join('\n') },
    ]);
  }

  private async handlePostback(event: LinePostbackEvent): Promise<void> {
    const data = event.postback.data;
    const userId = event.source.userId;
    const params = new URLSearchParams(data);
    const action = params.get('action');
    const contractNumber = params.get('contract') || undefined;

    switch (action) {
      case 'check_balance':
        await this.handleCheckBalance(userId, event.replyToken);
        break;
      case 'check_installments':
        await this.handleCheckInstallments(userId, event.replyToken, contractNumber);
        break;
      case 'pay':
        await this.handlePaymentRequest(userId, event.replyToken, contractNumber);
        break;
      default:
        this.logger.warn(`Unknown postback action: ${action}`);
    }
  }

  /**
   * Get browser-friendly URL that works outside LINE.
   * Uses LINE Login OAuth → redirects back to LIFF page.
   */
  private getBrowserUrl(path: string): string {
    const apiBase = process.env.API_BASE_URL || 'http://localhost:3000';
    return `${apiBase}/api/line-oa/line-login/authorize?returnPath=${encodeURIComponent(path)}`;
  }

  private async handleContractLink(userId: string, replyToken: string): Promise<void> {
    const customer = await this.lineOaService.findCustomerByLineId(userId);

    if (!customer) {
      const registerUrl = this.getBrowserUrl('/liff/register');
      await this.lineOaService.replyMessage(replyToken, [
        {
          type: 'text',
          text: `ยังไม่ได้เชื่อมบัญชีค่ะ กรุณาลงทะเบียนก่อนนะคะ\n\n👉 ลงทะเบียน:\n${registerUrl}\n\nหรือพิมพ์เบอร์โทรที่ลงทะเบียนไว้เพื่อเชื่อมบัญชี`,
        },
      ]);
      return;
    }

    const contractUrl = this.getBrowserUrl('/liff/contract');
    await this.lineOaService.replyMessage(replyToken, [
      {
        type: 'text',
        text: `คุณ${customer.name} สามารถดูข้อมูลสัญญาทั้งหมดได้ที่ลิงก์ด้านล่างค่ะ\n\n📋 ดูสัญญา:\n${contractUrl}`,
      },
    ]);
  }

  private async handleRegisterLink(userId: string, replyToken: string): Promise<void> {
    const customer = await this.lineOaService.findCustomerByLineId(userId);

    if (customer) {
      const contractUrl = this.getBrowserUrl('/liff/contract');
      await this.lineOaService.replyMessage(replyToken, [
        {
          type: 'text',
          text: `คุณ${customer.name} ลงทะเบียนแล้วค่ะ\n\n📋 ดูสัญญา:\n${contractUrl}`,
        },
      ]);
      return;
    }

    const registerUrl = this.getBrowserUrl('/liff/register');
    await this.lineOaService.replyMessage(replyToken, [
      {
        type: 'text',
        text: `กรุณาลงทะเบียนเพื่อผูกบัญชี LINE กับระบบค่ะ\n\n👉 ลงทะเบียน:\n${registerUrl}\n\nหรือพิมพ์เบอร์โทรที่ลงทะเบียนไว้เพื่อเชื่อมบัญชี`,
      },
    ]);
  }

  private async handleGreeting(replyToken: string): Promise<void> {
    await this.lineOaService.replyMessage(replyToken, [
      { type: 'text', text: CHATBOT_RESPONSES.onboarding },
    ]);
  }

  private async handleAndroidRedirect(replyToken: string): Promise<void> {
    await this.lineOaService.replyMessage(replyToken, [
      { type: 'text', text: CHATBOT_RESPONSES.androidRedirect },
    ]);
  }

  private async handleIpadUsedRedirect(replyToken: string): Promise<void> {
    await this.lineOaService.replyMessage(replyToken, [
      { type: 'text', text: CHATBOT_RESPONSES.ipadUsedRedirect },
    ]);
  }

  private async handleFreeformMessage(text: string, replyToken: string): Promise<void> {
    // ลอง AI response ก่อน — ถ้าไม่มี API key หรือ error ใช้ fallback
    const aiResponse = await this.chatbotService.generateResponse(text);
    await this.lineOaService.replyMessage(replyToken, [
      {
        type: 'text',
        text: aiResponse ?? 'ได้รับข้อความแล้วค่ะ น้องเบสจะตอบกลับภายใน 5 นาทีนะคะ 🙏',
      },
    ]);
  }

  private async handleHelp(replyToken: string): Promise<void> {
    await this.lineOaService.replyMessage(replyToken, [
      {
        type: 'text',
        text: '📋 คำสั่งที่ใช้ได้:\n\n💰 "เช็คยอด" - ดูยอดค้างชำระ\n📊 "งวด" - ดูตารางค่างวดทั้งหมด\n💳 "ชำระ" - ข้อมูลการชำระเงิน\n📋 "สัญญา" - ดูข้อมูลสัญญา\n🧾 "ใบเสร็จ" - ดูประวัติการชำระ\n📞 "ติดต่อ" - ข้อมูลติดต่อสาขา\n🔗 "ลงทะเบียน" - ผูกบัญชี LINE\n📷 ส่งรูปสลิป - แจ้งชำระเงิน\n❓ "ช่วยเหลือ" - แสดงเมนูนี้\n\nหรือกดเมนูด้านล่างได้เลยค่ะ',
      },
    ]);
  }

  // ─── LINE OA Settings (Owner) ───────────────────────

  private static readonly LINE_CONFIG_KEYS = [
    'line_channel_access_token',
    'line_channel_secret',
    'liff_id',
    'promptpay_id',
    'promptpay_account_name',
    'payment_link_base_url',
    'bank_name',
    'bank_account_number',
    'bank_account_name',
    'owner_line_id',
  ];

  @Get('settings')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  async getLineSettings() {
    const configs = await this.prisma.systemConfig.findMany({
      where: { key: { in: LineOaController.LINE_CONFIG_KEYS } },
    });

    const settings: Record<string, string> = {};
    for (const c of configs) {
      settings[c.key] = c.value;
    }

    // Mask sensitive values for display
    const masked = { ...settings };
    if (masked.line_channel_access_token) {
      const v = masked.line_channel_access_token;
      masked.line_channel_access_token = v.length > 10
        ? v.substring(0, 6) + '****' + v.substring(v.length - 4)
        : '****';
    }
    if (masked.line_channel_secret) {
      const v = masked.line_channel_secret;
      masked.line_channel_secret = v.length > 8
        ? v.substring(0, 4) + '****' + v.substring(v.length - 4)
        : '****';
    }

    return {
      settings: masked,
      isConfigured: !!settings.line_channel_access_token && !!settings.line_channel_secret,
    };
  }

  @Post('settings')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  async saveLineSettings(
    @Body() body: Record<string, string>,
  ) {
    const labels: Record<string, string> = {
      line_channel_access_token: 'LINE Channel Access Token',
      line_channel_secret: 'LINE Channel Secret',
      liff_id: 'LIFF ID',
      promptpay_id: 'PromptPay ID',
      promptpay_account_name: 'PromptPay Account Name',
      payment_link_base_url: 'Payment Link Base URL',
      bank_name: 'ชื่อธนาคาร',
      bank_account_number: 'เลขบัญชีธนาคาร',
      bank_account_name: 'ชื่อบัญชีธนาคาร',
      owner_line_id: 'LINE User ID เจ้าของ',
    };

    for (const key of LineOaController.LINE_CONFIG_KEYS) {
      if (body[key] !== undefined && body[key] !== '') {
        await this.prisma.systemConfig.upsert({
          where: { key },
          create: { key, value: body[key], label: labels[key] || key },
          update: { value: body[key] },
        });
      }
    }

    // Reload config in services
    await this.lineOaService.reloadConfig();
    if (body.promptpay_id || body.promptpay_account_name) {
      this.promptPayQrService.setConfig(
        body.promptpay_id || '',
        body.promptpay_account_name || '',
      );
    }

    this.logger.log('[LINE] Settings updated by admin');
    return { success: true, message: 'บันทึกการตั้งค่า LINE OA เรียบร้อย' };
  }

  @Post('settings/test-connection')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  async testLineConnection() {
    try {
      // Test by calling LINE Bot Info endpoint
      const result = await this.lineOaService.testConnection();
      return { success: true, botInfo: result };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'ไม่สามารถเชื่อมต่อ LINE ได้',
      };
    }
  }

  @Get('settings/webhook-url')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  async getWebhookUrl(@Req() req: Request) {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.get('host');
    const webhookUrl = `${protocol}://${host}/api/line-oa/webhook`;

    return { webhookUrl };
  }

  // ─── Test Send (Owner Preview) ──────────────────────

  @Post('test-send')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  async testSendMessage(
    @Body() body: { lineUserId?: string; messageType: string },
  ) {
    // Resolve target LINE user ID
    let targetLineId = body.lineUserId;
    if (!targetLineId) {
      const config = await this.prisma.systemConfig.findUnique({
        where: { key: 'owner_line_id' },
      });
      targetLineId = config?.value;
    }

    if (!targetLineId) {
      return { success: false, error: 'กรุณาใส่ LINE User ID หรือบันทึก owner_line_id ในการตั้งค่า' };
    }

    const sampleData = {
      customerName: 'ทดสอบ สมมุติ',
      contractNumber: 'BC-2026-0001',
      installmentNo: 3,
      totalInstallments: 12,
    };

    try {
      let flex;
      switch (body.messageType) {
        case 'payment_reminder':
          flex = this.lineOaService.buildPaymentReminder({
            customerName: sampleData.customerName,
            contractNumber: sampleData.contractNumber,
            installmentNo: sampleData.installmentNo,
            totalInstallments: sampleData.totalInstallments,
            amountDue: 3500,
            dueDate: '20/03/2026',
            daysUntilDue: 3,
          });
          break;
        case 'overdue_notice':
          flex = this.lineOaService.buildOverdueNotice({
            customerName: sampleData.customerName,
            contractNumber: sampleData.contractNumber,
            installmentNo: sampleData.installmentNo,
            totalInstallments: sampleData.totalInstallments,
            amountDue: 3500,
            lateFee: 150,
            totalOutstanding: 3650,
            dueDate: '10/03/2026',
            daysOverdue: 3,
          });
          break;
        case 'payment_success':
          flex = this.lineOaService.buildPaymentSuccess({
            customerName: sampleData.customerName,
            contractNumber: sampleData.contractNumber,
            installmentNo: sampleData.installmentNo,
            totalInstallments: sampleData.totalInstallments,
            amountPaid: 3500,
            paymentMethod: 'BANK_TRANSFER',
            paidDate: '13/03/2026',
            remainingInstallments: 9,
          });
          break;
        case 'balance_summary':
          flex = this.lineOaService.buildBalanceSummary({
            customerName: sampleData.customerName,
            contracts: [
              {
                contractNumber: sampleData.contractNumber,
                totalInstallments: sampleData.totalInstallments,
                paidInstallments: 2,
                status: 'ACTIVE',
                totalOutstanding: 31500,
                nextDueDate: '20/04/2026',
                nextAmountDue: 3500,
              },
            ],
          });
          break;
        default:
          return { success: false, error: `ไม่รู้จักประเภทข้อความ: ${body.messageType}` };
      }

      await this.lineOaService.sendFlexMessage(targetLineId, flex);
      this.logger.log(`[LINE] Test message '${body.messageType}' sent to ${targetLineId}`);
      return { success: true, message: `ส่งข้อความทดสอบ "${body.messageType}" สำเร็จ` };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'ส่งข้อความล้มเหลว',
      };
    }
  }

  // ─── LINE OA Statistics ──────────────────────────────

  @Get('stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'BRANCH_MANAGER')
  async getLineStats() {
    return this.lineOaService.getLineStats();
  }
}
