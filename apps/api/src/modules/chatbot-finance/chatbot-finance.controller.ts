import { Body, Controller, HttpCode, Logger, Post, UseGuards } from '@nestjs/common';
import { ChatbotFinanceService } from './services/chatbot-finance.service';
import { LineFinanceClientService } from './services/line-finance-client.service';
import { LineFinanceWebhookGuard } from './guards/line-finance-webhook.guard';
import { LineFinanceWebhookBody } from './dto/line-webhook.dto';

/**
 * Webhook + admin endpoints สำหรับ Finance Bot ("น้องเบส")
 *
 * Routes:
 *   POST /api/chatbot/finance/webhook   ← LINE Messaging API webhook
 *   POST /api/chatbot/finance/test/push ← (dev only) ทดสอบ push message
 */
@Controller('chatbot/finance')
export class ChatbotFinanceController {
  private readonly logger = new Logger(ChatbotFinanceController.name);

  constructor(
    private chatbotService: ChatbotFinanceService,
    private lineClient: LineFinanceClientService,
  ) {}

  @Post('webhook')
  @HttpCode(200)
  @UseGuards(LineFinanceWebhookGuard)
  async webhook(@Body() body: LineFinanceWebhookBody): Promise<{ ok: true }> {
    if (!body?.events?.length) return { ok: true };

    this.logger.log(`[Finance webhook] ${body.events.length} event(s)`);

    // Process events sequentially (LINE allows up to ~5 events per call)
    for (const event of body.events) {
      try {
        await this.chatbotService.handleEvent(event);
      } catch (err) {
        this.logger.error(
          `[Finance webhook] event error: ${err instanceof Error ? err.message : err}`,
        );
        // ห้าม throw — LINE ต้องการ 200 เสมอ มิฉะนั้นจะ retry
      }
    }

    return { ok: true };
  }

  /**
   * Dev-only: ทดสอบ push message (ใช้กับ Group ID เพื่อทดสอบ staff notify ในอนาคต)
   * TODO: ลบหรือใส่ JwtAuthGuard + RolesGuard ก่อน production
   */
  @Post('test/push')
  @HttpCode(200)
  async testPush(@Body() body: { to: string; text: string }): Promise<{ ok: boolean }> {
    if (!this.lineClient.isConfigured) {
      return { ok: false };
    }
    await this.lineClient.pushText(body.to, body.text);
    return { ok: true };
  }
}
