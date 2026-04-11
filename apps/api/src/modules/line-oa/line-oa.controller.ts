import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { LineOaService } from './line-oa.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { PromptPayQrService } from './promptpay/promptpay-qr.service';

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

    await this.lineOaService.reloadConfig();
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

  @Post('test-send')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  async testSendMessage(@Body() body: { lineUserId?: string; messageType: string }) {
    let targetLineId = body.lineUserId;
    if (!targetLineId) {
      const config = await this.prisma.systemConfig.findUnique({ where: { key: 'owner_line_id' } });
      targetLineId = config?.value;
    }
    if (!targetLineId) {
      return { success: false, error: 'กรุณาใส่ LINE User ID หรือบันทึก owner_line_id ในการตั้งค่า' };
    }

    const sampleData = { customerName: 'ทดสอบ สมมุติ', contractNumber: 'BC-2026-0001', installmentNo: 3, totalInstallments: 12 };

    try {
      let flex;
      switch (body.messageType) {
        case 'payment_reminder':
          flex = this.lineOaService.buildPaymentReminder({ ...sampleData, amountDue: 3500, dueDate: '20/03/2026', daysUntilDue: 3 });
          break;
        case 'overdue_notice':
          flex = this.lineOaService.buildOverdueNotice({ ...sampleData, amountDue: 3500, lateFee: 150, totalOutstanding: 3650, dueDate: '10/03/2026', daysOverdue: 3 });
          break;
        case 'payment_success':
          flex = this.lineOaService.buildPaymentSuccess({ ...sampleData, amountPaid: 3500, paymentMethod: 'BANK_TRANSFER', paidDate: '13/03/2026', remainingInstallments: 9 });
          break;
        case 'balance_summary':
          flex = this.lineOaService.buildBalanceSummary({ customerName: sampleData.customerName, contracts: [{ contractNumber: sampleData.contractNumber, totalInstallments: 12, paidInstallments: 2, status: 'ACTIVE', totalOutstanding: 31500, nextDueDate: '20/04/2026', nextAmountDue: 3500 }] });
          break;
        default:
          return { success: false, error: `ไม่รู้จักประเภทข้อความ: ${body.messageType}` };
      }
      await this.lineOaService.sendFlexMessage(targetLineId, flex);
      this.logger.log(`[LINE] Test message '${body.messageType}' sent to ${targetLineId}`);
      return { success: true, message: `ส่งข้อความทดสอบ "${body.messageType}" สำเร็จ` };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'ส่งข้อความล้มเหลว' };
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
