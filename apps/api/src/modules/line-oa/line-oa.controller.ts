import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Req,
  Param,
  Query,
  UseGuards,
  Logger,
  BadRequestException,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { LineOaService } from './line-oa.service';
import { buildWelcomeFlex } from './flex-messages/welcome.flex';
import { buildContractSignedFlex } from './flex-messages/contract-signed.flex';
import { buildVerifySuccessFlex } from './flex-messages/verify-success.flex';
import { buildLinkContractFlex } from './flex-messages/link-contract.flex';
import { buildContractCompletedFlex } from './flex-messages/contract-completed.flex';
import { buildEarlyPayoffSuccessFlex } from './flex-messages/early-payoff-success.flex';
import {
  buildPromotionFlex,
  buildThankYouFlex,
  buildNewProductFlex,
} from './flex-messages/campaign.flex';
import { buildDailyReportFlex } from './flex-messages/daily-report.flex';

/** All Flex templates exposed to the owner test-send endpoints. */
const TEST_FLEX_TYPES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'link_contract', label: 'ผูกสัญญา (Link Contract)' },
  { value: 'welcome_finance', label: 'ยินดีต้อนรับ — FINANCE' },
  { value: 'welcome_shop', label: 'ยินดีต้อนรับ — SHOP' },
  { value: 'contract_signed', label: 'เซ็นสัญญาสำเร็จ' },
  { value: 'verify_success', label: 'ยืนยันตัวตนสำเร็จ' },
  { value: 'payment_reminder', label: 'แจ้งเตือนค่างวด (ก่อนครบกำหนด)' },
  { value: 'promptpay_qr', label: 'QR พร้อมเพย์' },
  { value: 'payment_success', label: 'แจ้งชำระเงินสำเร็จ' },
  { value: 'overdue_notice', label: 'แจ้งเตือนค้างชำระ' },
  { value: 'balance_summary', label: 'สรุปยอดคงเหลือ' },
  { value: 'contract_selector', label: 'เลือกสัญญา (หลายสัญญา)' },
  { value: 'receipt_history', label: 'ประวัติใบเสร็จ' },
  { value: 'contract_completed', label: 'ปิดสัญญาครบ' },
  { value: 'early_payoff_success', label: 'ปิดยอดสำเร็จ (ลด 50%)' },
  { value: 'promotion', label: 'แคมเปญ — โปรโมชัน' },
  { value: 'thank_you', label: 'แคมเปญ — ขอบคุณ' },
  { value: 'new_product', label: 'แคมเปญ — สินค้าใหม่' },
  { value: 'daily_report', label: 'รายงานประจำวัน (owner)' },
] as const;
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { PromptPayQrService } from './promptpay/promptpay-qr.service';
import { RichMenuService } from './rich-menu/rich-menu.service';
import { SetAliasDto } from './rich-menu/dto/set-alias.dto';
import { DeployTemplateDto, SetCallCenterPhoneDto } from './rich-menu/dto/deploy-template.dto';
import { AuditService } from '../audit/audit.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

/**
 * LINE OA Settings + Admin — owner-only configuration and test endpoints.
 * Chatbot webhook handlers are in LineOaChatbotController.
 */
@ApiTags('LINE OA')
@ApiBearerAuth('JWT')
@Controller('line-oa')
export class LineOaController {
  private readonly logger = new Logger(LineOaController.name);

  constructor(
    private lineOaService: LineOaService,
    private prisma: PrismaService,
    private promptPayQrService: PromptPayQrService,
    private richMenuService: RichMenuService,
    private audit: AuditService,
  ) {}

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
  async saveLineSettings(@Body() body: Record<string, string>) {
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

    if (body.promptpay_id || body.promptpay_account_name) {
      this.promptPayQrService.setConfig(body.promptpay_id || '', body.promptpay_account_name || '');
    }

    this.logger.log('[LINE] Settings updated by admin');
    return { success: true, message: 'บันทึกการตั้งค่า LINE OA เรียบร้อย' };
  }

  @Post('settings/test-connection')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  async testLineConnection() {
    try {
      const result = await this.lineOaService.testConnection();
      return { success: true, botInfo: result };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'ไม่สามารถเชื่อมต่อ LINE ได้' };
    }
  }

  @Get('settings/webhook-url')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  async getWebhookUrl(@Req() req: Request) {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.get('host');
    return { webhookUrl: `${protocol}://${host}/api/line-oa/webhook` };
  }

  // ─── Test Send (Owner Preview) ──────────────────────

  @Get('test-flex-types')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  getTestFlexTypes() {
    return { types: TEST_FLEX_TYPES };
  }

  @Post('test-send')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  async testSendMessage(@Body() body: { lineUserId?: string; messageType: string }) {
    const targetLineId = await this.resolveOwnerLineId(body.lineUserId);
    if (!targetLineId) {
      return { success: false, error: 'กรุณาใส่ LINE User ID หรือบันทึก owner_line_id ในการตั้งค่า' };
    }

    try {
      const flex = this.buildTestFlexSample(body.messageType);
      if (!flex) {
        return { success: false, error: `ไม่รู้จักประเภทข้อความ: ${body.messageType}` };
      }
      await this.lineOaService.sendFlexMessage(targetLineId, flex);
      this.logger.log(`[LINE] Test message '${body.messageType}' sent to ${targetLineId}`);
      return { success: true, message: `ส่งข้อความทดสอบ "${body.messageType}" สำเร็จ` };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'ส่งข้อความล้มเหลว' };
    }
  }

  /**
   * Send one sample of every Flex template in sequence (throttled ~250ms apart
   * to avoid LINE push-message burst limits). Owner-only preview tool.
   */
  @Post('test-send-all')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  async testSendAllMessages(@Body() body: { lineUserId?: string }) {
    const targetLineId = await this.resolveOwnerLineId(body.lineUserId);
    if (!targetLineId) {
      return { success: false, error: 'กรุณาใส่ LINE User ID หรือบันทึก owner_line_id ในการตั้งค่า' };
    }

    const types = TEST_FLEX_TYPES.map((t) => t.value);
    const results: Array<{ type: string; ok: boolean; error?: string }> = [];

    for (const type of types) {
      try {
        const flex = this.buildTestFlexSample(type);
        if (!flex) {
          results.push({ type, ok: false, error: 'unknown type' });
          continue;
        }
        await this.lineOaService.sendFlexMessage(targetLineId, flex);
        results.push({ type, ok: true });
        // Small throttle between messages — LINE push limit burst protection.
        await new Promise((resolve) => setTimeout(resolve, 250));
      } catch (err) {
        results.push({
          type,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const sent = results.filter((r) => r.ok).length;
    this.logger.log(`[LINE] test-send-all → ${sent}/${results.length} sent to ${targetLineId}`);
    return {
      success: sent > 0,
      total: results.length,
      sent,
      failed: results.length - sent,
      results,
    };
  }

  private async resolveOwnerLineId(lineUserId?: string): Promise<string | null> {
    if (lineUserId) return lineUserId;
    const config = await this.prisma.systemConfig.findUnique({
      where: { key: 'owner_line_id' },
    });
    return config?.value ?? null;
  }

  /** Build a sample Flex payload for a given test type (owner preview only). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private buildTestFlexSample(type: string): any {
    const sample = {
      customerName: 'ทดสอบ สมมุติ',
      contractNumber: 'BC-2026-0001',
      installmentNo: 3,
      totalInstallments: 12,
    };
    const longUri = 'https://liff.line.me/2000000000-xxxx/liff/contract';

    switch (type) {
      case 'payment_reminder':
        return this.lineOaService.buildPaymentReminder({
          ...sample,
          amountDue: 4500,
          dueDate: '15 เม.ย. 2568',
          daysUntilDue: 3,
        });
      case 'overdue_notice':
        return this.lineOaService.buildOverdueNotice({
          ...sample,
          amountDue: 4500,
          lateFee: 200,
          totalOutstanding: 4700,
          dueDate: '10 เม.ย. 2568',
          daysOverdue: 5,
        });
      case 'payment_success':
        return this.lineOaService.buildPaymentSuccess({
          ...sample,
          amountPaid: 4500,
          paymentMethod: 'BANK_TRANSFER',
          paidDate: '15 เม.ย. 2568',
          remainingInstallments: 9,
        });
      case 'balance_summary':
        return this.lineOaService.buildBalanceSummary({
          customerName: sample.customerName,
          contracts: [
            {
              contractNumber: sample.contractNumber,
              totalInstallments: 12,
              paidInstallments: 5,
              status: 'ACTIVE',
              totalOutstanding: 31500,
              nextDueDate: '20 เม.ย. 2568',
              nextAmountDue: 4500,
            },
          ],
        });
      case 'promptpay_qr':
        return this.lineOaService.buildPromptPayQr({
          ...sample,
          amount: 4500,
          qrImageUrl: 'https://storage.googleapis.com/bestchoice-assets/sample-qr.png',
          accountName: 'บจก. เบสท์ ชอยส์ ไฟแนนซ์',
          maskedPromptPayId: 'xxx-xxx-7890',
        });
      case 'receipt_history':
        return this.lineOaService.buildReceiptHistory({
          customerName: sample.customerName,
          contracts: [
            {
              contractNumber: sample.contractNumber,
              payments: [
                { installmentNo: 3, amountPaid: 4500, paidDate: '15 เม.ย. 2568' },
                { installmentNo: 2, amountPaid: 4500, paidDate: '15 มี.ค. 2568' },
                { installmentNo: 1, amountPaid: 4500, paidDate: '15 ก.พ. 2568' },
              ],
              remainingCount: 9,
            },
          ],
        });
      case 'contract_selector':
        return this.lineOaService.buildContractSelector(
          sample.customerName,
          [
            { contractNumber: 'BC-2024-001847', status: 'ACTIVE', totalOutstanding: 22030 },
            { contractNumber: 'BC-2024-001623', status: 'ACTIVE', totalOutstanding: 15890 },
            { contractNumber: 'BC-2024-001099', status: 'OVERDUE', totalOutstanding: 8420 },
          ],
          'check_installments',
        );
      case 'welcome_finance':
        return buildWelcomeFlex({ oaType: 'finance', liffRegisterUrl: longUri });
      case 'welcome_shop':
        return buildWelcomeFlex({ oaType: 'shop', liffRegisterUrl: longUri });
      case 'contract_signed':
        return buildContractSignedFlex({
          customerName: sample.customerName,
          contractNumber: sample.contractNumber,
          productName: 'iPhone 15 Pro 256GB',
          totalMonths: 12,
          monthlyPayment: 4500,
          signedAt: '15 เม.ย. 2568',
          downloadUrl: longUri,
        });
      case 'verify_success':
        return buildVerifySuccessFlex({
          customerName: sample.customerName,
          contractNumber: sample.contractNumber,
          totalInstallments: 12,
          monthlyAmount: 4500,
        });
      case 'link_contract':
        return buildLinkContractFlex({
          liffLinkUrl: longUri,
          liffRegisterUrl: longUri,
        });
      case 'contract_completed':
        return buildContractCompletedFlex({
          customerName: sample.customerName,
          contractNumber: sample.contractNumber,
          productName: 'iPhone 15 Pro 256GB',
          totalPaid: 54000,
          totalInstallments: 12,
          startDate: 'ก.พ. 2567',
          endDate: 'ก.พ. 2568',
          loyaltyPointsEarned: 540,
          shopUrl: 'https://bestchoicephone.app',
          liffHistoryUrl: longUri,
        });
      case 'early_payoff_success':
        return buildEarlyPayoffSuccessFlex({
          customerName: sample.customerName,
          contractNumber: sample.contractNumber,
          amountPaid: 18450,
          originalAmount: 22030,
          savings: 3580,
          payoffDate: '15 เม.ย. 2568',
          receiptUrl: longUri,
          branchPickupHint: 'รับเครื่องได้ที่สาขาใกล้บ้าน — เปิดทุกวัน 10:00–20:00',
        });
      case 'promotion':
        return buildPromotionFlex({
          title: 'ปิดสัญญาก่อนกำหนด ลดดอกเบี้ย 50%',
          subtitle: 'ประหยัดดอกเบี้ยได้ทันทีเมื่อปิดยอดก่อนครบสัญญา',
          ctaUrl: longUri,
          ctaLabel: 'รับสิทธิ์พิเศษ',
        });
      case 'thank_you':
        return buildThankYouFlex({
          customerName: sample.customerName,
          message: 'ขอบคุณที่ชำระตรงเวลา 6 งวดติดต่อกัน · รับโบนัส 60 แต้ม',
        });
      case 'new_product':
        return buildNewProductFlex({
          productName: 'iPhone 16 Pro Max',
          price: '฿49,900',
          downPayment: 'ดาวน์เริ่มต้น ฿5,000',
          ctaUrl: 'https://bestchoicephone.app',
        });
      case 'daily_report':
        return buildDailyReportFlex({
          date: '15 เม.ย. 2568',
          todayPaymentCount: 12,
          todayPaymentAmount: 54500,
          overdueCount: 5,
          overdueAmount: 18200,
          defaultCount: 2,
          newContractsToday: 3,
          pendingApprovals: 1,
        });
      default:
        return null;
    }
  }

  // ─── LINE OA Statistics ──────────────────────────────

  @Get('stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'BRANCH_MANAGER')
  async getLineStats() {
    return this.lineOaService.getLineStats();
  }

  // ─── Greeting Message (Owner) ───────────────────────

  @Get('greeting')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  async getGreeting() {
    const config = await this.prisma.systemConfig.findUnique({
      where: { key: 'line.greetingMessages' },
    });
    const messages = config?.value ? JSON.parse(config.value) : [];
    const showQuickReply = await this.prisma.systemConfig.findUnique({
      where: { key: 'line.greetingQuickReply' },
    });
    return {
      messages, // array of { type, content }
      showQuickReply: showQuickReply?.value !== 'false',
    };
  }

  @Put('greeting')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  async updateGreeting(@Body() body: { messages: any[]; showQuickReply?: boolean }) {
    await this.prisma.systemConfig.upsert({
      where: { key: 'line.greetingMessages' },
      create: { key: 'line.greetingMessages', value: JSON.stringify(body.messages), label: 'LINE greeting messages' },
      update: { value: JSON.stringify(body.messages), deletedAt: null },
    });
    if (body.showQuickReply !== undefined) {
      await this.prisma.systemConfig.upsert({
        where: { key: 'line.greetingQuickReply' },
        create: { key: 'line.greetingQuickReply', value: String(body.showQuickReply), label: 'Show Quick Reply after greeting' },
        update: { value: String(body.showQuickReply), deletedAt: null },
      });
    }
    return { success: true };
  }

  // ─── Rich Menu Management (Owner) ───────────────────
  // All endpoints accept ?channel=shop|finance (default: shop)

  @Get('rich-menu/list')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  async listRichMenus(@Query('channel') channel?: string) {
    const ch = this.parseChannel(channel);
    const richmenus = await this.richMenuService.listRichMenus(ch);
    const defaultId = await this.richMenuService.getDefaultRichMenuId(ch).catch(() => null);
    return { richmenus, defaultRichMenuId: defaultId };
  }

  @Get('rich-menu/default')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  async getDefaultRichMenu(@Query('channel') channel?: string) {
    const ch = this.parseChannel(channel);
    const richMenuId = await this.richMenuService.getDefaultRichMenuId(ch);
    return { richMenuId };
  }

  @Post('rich-menu/create-default')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  async createDefaultRichMenu(
    @Body()
    body: {
      liffUrl?: string;
      name?: string;
      chatBarText?: string;
      layout?: string;
      buttons?: any[];
      channel?: string;
    },
    @CurrentUser() user: { id: string },
  ) {
    const ch = this.parseChannel(body.channel);
    const result = await this.richMenuService.createCustomRichMenu(
      { ...body, layout: body.layout as '2x3' | '1x3' | '2x2' | undefined },
      ch,
    );
    await this.audit.log({
      userId: user.id,
      action: 'RICH_MENU_CREATE',
      entity: 'RichMenu',
      entityId: result.richMenuId ?? '',
      newValue: {
        channel: ch,
        name: body.name,
        chatBarText: body.chatBarText,
        layout: body.layout,
        buttonCount: body.buttons?.length ?? 0,
      },
    });
    return { success: true, richMenuId: result.richMenuId };
  }

  @Post('rich-menu/:id/upload-image')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  @UseInterceptors(FileInterceptor('image'))
  async uploadRichMenuImage(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Query('channel') channel?: string,
  ) {
    if (!file) throw new BadRequestException('กรุณาอัปโหลดรูปภาพ');
    const ch = this.parseChannel(channel);
    await this.richMenuService.uploadRichMenuImage(id, file.buffer, ch);
    return { success: true, message: 'อัปโหลดรูป Rich Menu สำเร็จ' };
  }

  @Post('rich-menu/create-with-image')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  @UseInterceptors(FileInterceptor('image'))
  async createWithImage(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: any,
    @CurrentUser() user: { id: string },
  ) {
    const config = typeof body.config === 'string' ? JSON.parse(body.config) : (body.config ?? {});
    const ch = this.parseChannel(config.channel);

    const result = await this.richMenuService.createCustomRichMenu(config, ch);

    if (file && result.richMenuId) {
      await this.richMenuService.uploadRichMenuImage(result.richMenuId, file.buffer, ch);
    }

    if (config.setAsDefault && result.richMenuId) {
      await this.richMenuService.setDefaultRichMenu(result.richMenuId, ch);
    }

    await this.audit.log({
      userId: user.id,
      action: 'RICH_MENU_CREATE_WITH_IMAGE',
      entity: 'RichMenu',
      entityId: result.richMenuId ?? '',
      newValue: {
        channel: ch,
        name: config.name,
        layout: config.layout,
        setAsDefault: !!config.setAsDefault,
        hasImage: !!file,
      },
    });

    return { success: true, richMenuId: result.richMenuId };
  }

  @Post('rich-menu/:id/set-default')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  async setDefaultRichMenu(
    @Param('id') id: string,
    @Query('channel') channel?: string,
    @CurrentUser() user?: { id: string },
  ) {
    const ch = this.parseChannel(channel);
    // Capture the previous default so audit log shows the swap, not just the new value.
    const previousDefault = await this.richMenuService
      .getDefaultRichMenuId(ch)
      .catch(() => null);
    await this.richMenuService.setDefaultRichMenu(id, ch);
    if (user?.id) {
      await this.audit.log({
        userId: user.id,
        action: 'RICH_MENU_SET_DEFAULT',
        entity: 'RichMenu',
        entityId: id,
        oldValue: { channel: ch, defaultRichMenuId: previousDefault },
        newValue: { channel: ch, defaultRichMenuId: id },
      });
    }
    return { success: true, message: 'ตั้งค่า Rich Menu เริ่มต้นเรียบร้อย' };
  }

  @Delete('rich-menu/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  async deleteRichMenu(
    @Param('id') id: string,
    @Query('channel') channel?: string,
    @CurrentUser() user?: { id: string },
  ) {
    const ch = this.parseChannel(channel);
    await this.richMenuService.deleteRichMenu(id, ch);
    if (user?.id) {
      await this.audit.log({
        userId: user.id,
        action: 'RICH_MENU_DELETE',
        entity: 'RichMenu',
        entityId: id,
        oldValue: { channel: ch, richMenuId: id },
      });
    }
    return { success: true, message: 'ลบ Rich Menu เรียบร้อย' };
  }

  @Get('rich-menu/aliases')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  async getRichMenuAliases() {
    return this.richMenuService.getRichMenuAliases();
  }

  @Post('rich-menu/:id/set-alias')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  async setRichMenuAlias(@Param('id') id: string, @Body() dto: SetAliasDto) {
    await this.richMenuService.setRichMenuAlias(dto.channel, dto.variant, id);
    return { success: true, message: 'ตั้งค่า alias สำเร็จ' };
  }

  @Post('rich-menu/deploy-template')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  async deployRichMenuTemplate(@Body() dto: DeployTemplateDto) {
    const richMenuId = await this.richMenuService.deployFromTemplate(dto.templateKey);
    return {
      success: true,
      richMenuId,
      message: 'Generate + deploy rich menu จาก template สำเร็จ',
    };
  }

  @Get('rich-menu/call-center-phone')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  async getCallCenterPhone(@Query('channel') channel?: string) {
    const ch = this.parseChannel(channel);
    const phone = await this.richMenuService.getCallCenterPhone(ch);
    return { phone };
  }

  @Post('rich-menu/call-center-phone')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  async setCallCenterPhone(@Body() dto: SetCallCenterPhoneDto) {
    await this.richMenuService.setCallCenterPhone(dto.channel, dto.phone);
    return { success: true, message: 'บันทึกเบอร์ติดต่อเรียบร้อย' };
  }

  private parseChannel(channel?: string): 'shop' | 'finance' {
    if (channel === 'finance') return 'finance';
    if (channel === 'shop' || channel === undefined || channel === '') return 'shop';
    throw new BadRequestException('channel ต้องเป็น shop หรือ finance');
  }
}
