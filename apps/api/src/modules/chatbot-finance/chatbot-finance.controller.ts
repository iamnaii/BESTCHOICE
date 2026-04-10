import { Body, Controller, HttpCode, Logger, Post, UseGuards } from '@nestjs/common';
import { SkipCsrf } from '../../guards/skip-csrf.decorator';
import { ChatbotFinanceService } from './services/chatbot-finance.service';
import { LineFinanceClientService } from './services/line-finance-client.service';
import { AutoTriggerService } from './services/auto-trigger.service';
import { LineFinanceWebhookGuard } from './guards/line-finance-webhook.guard';
import { LineFinanceWebhookBody } from './dto/line-webhook.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PrismaService } from '../../prisma/prisma.service';

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
    private autoTrigger: AutoTriggerService,
    private prisma: PrismaService,
  ) {}

  @Post('webhook')
  @SkipCsrf()
  @HttpCode(200)
  @UseGuards(LineFinanceWebhookGuard)
  async webhook(@Body() body: LineFinanceWebhookBody): Promise<{ ok: true }> {
    if (!body?.events?.length) return { ok: true };

    this.logger.log(`[Finance webhook] ${body.events.length} event(s)`);

    // Process events sequentially (LINE allows up to ~5 events per call)
    for (const event of body.events) {
      // Dedup: skip redelivered or already-processed events (DB-based for multi-instance safety)
      if (event.deliveryContext?.isRedelivery) {
        this.logger.log(`[Finance webhook] Skip redelivery: ${event.webhookEventId}`);
        continue;
      }
      if (event.webhookEventId) {
        try {
          await this.prisma.processedWebhookEvent.create({
            data: { eventId: event.webhookEventId },
          });
        } catch {
          // Unique constraint violation → already processed
          this.logger.log(`[Finance webhook] Skip duplicate event: ${event.webhookEventId}`);
          continue;
        }
      }

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
   * Manual push message — requires OWNER (เพื่อทดสอบหรือส่ง broadcast พิเศษ)
   */
  @Post('test/push')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  async testPush(@Body() body: { to: string; text: string }): Promise<{ ok: boolean }> {
    if (!this.lineClient.isConfigured) {
      return { ok: false };
    }
    await this.lineClient.pushText(body.to, body.text);
    return { ok: true };
  }

  /**
   * Manual trigger reminders — รันได้นอก cron schedule (เช่น recovery หลัง outage)
   */
  @Post('test/run-reminders')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'FINANCE_MANAGER')
  async runReminders(): Promise<{ ok: true }> {
    this.logger.log('[Manual] Trigger: daily reminders');
    await this.autoTrigger.runDailyReminders();
    return { ok: true };
  }

  @Post('test/run-escalations')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'FINANCE_MANAGER')
  async runEscalations(): Promise<{ ok: true }> {
    this.logger.log('[Manual] Trigger: daily escalations');
    await this.autoTrigger.runDailyEscalations();
    return { ok: true };
  }
}
