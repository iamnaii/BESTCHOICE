import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { LineStaffWebhookGuard } from '../chatbot-finance/guards/line-staff-webhook.guard';
import type { LineWebhookBody } from '../line-oa/dto/webhook-event.dto';
import { StaffLineLinkService } from './staff-line-link.service';

/**
 * Webhook ของ "ไลน์พนักงาน" (Staff OA) — ใช้ผูกบัญชีพนักงานด้วยรหัส 6 หลักเท่านั้น (สเปก §13.1)
 * ตั้ง Webhook URL ใน LINE Developers = `${BASE}/api/webhooks/line-staff` (Integration Hub แสดงให้)
 */
@Controller('webhooks/line-staff')
export class StaffLineWebhookController {
  constructor(private readonly link: StaffLineLinkService) {}

  @Post()
  @HttpCode(200)
  @UseGuards(LineStaffWebhookGuard)
  async receive(@Body() body: LineWebhookBody): Promise<{ ok: true }> {
    if (Array.isArray(body?.events) && body.events.length > 0) await this.link.handleWebhookEvents(body.events);
    return { ok: true };
  }
}
