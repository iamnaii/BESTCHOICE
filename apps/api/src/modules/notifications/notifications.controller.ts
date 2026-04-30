import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Request,
  UseGuards,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { NotificationCategory } from '@prisma/client';
import { NotificationsService } from './notifications.service';
import { NotificationTemplateService } from './notification-template.service';
import { SendNotificationDto, BulkNotificationDto } from './dto/create-notification.dto';
import {
  CreateNotificationTemplateDto,
  UpdateNotificationTemplateDto,
  PreviewTemplateDto,
  TestSendTemplateDto,
} from './dto/notification-template.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Notifications')
@ApiBearerAuth('JWT')
@Controller('notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
export class NotificationsController {
  private readonly logger = new Logger(NotificationsController.name);

  constructor(
    private notificationsService: NotificationsService,
    private templateService: NotificationTemplateService,
  ) {}

  // ============================================================
  // SEND NOTIFICATIONS
  // ============================================================

  @Post('send')
  @Roles('OWNER', 'BRANCH_MANAGER')
  send(@Body() dto: SendNotificationDto) {
    return this.notificationsService.send(dto);
  }

  @Post('send-from-template')
  @Roles('OWNER', 'BRANCH_MANAGER')
  sendFromTemplate(
    @Body()
    body: {
      eventType: string;
      data: Record<string, string>;
      recipient: string;
      relatedId?: string;
      customerId?: string;
    },
  ) {
    return this.notificationsService.sendFromTemplate(body.eventType, body.data, body.recipient, {
      relatedId: body.relatedId,
      customerId: body.customerId,
    });
  }

  // ============================================================
  // NOTIFICATION LOGS
  // ============================================================

  @Get('logs')
  @Roles('OWNER', 'BRANCH_MANAGER')
  findLogs(
    @Query('channel') channel?: string,
    @Query('status') status?: string,
    @Query('relatedId') relatedId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.notificationsService.findLogs({
      channel,
      status,
      relatedId,
      limit: limit ? parseInt(limit) : undefined,
    });
  }

  @Get('logs/stats')
  @Roles('OWNER', 'BRANCH_MANAGER')
  getLogStats() {
    return this.notificationsService.getLogStats();
  }

  @Get('compliance/stats')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  getComplianceStats() {
    return this.notificationsService.getComplianceStats(7);
  }

  // ============================================================
  // TEMPLATES (DB-backed via NotificationTemplateService)
  // ============================================================

  @Get('templates')
  @Roles('OWNER', 'BRANCH_MANAGER')
  async listTemplates(@Query('category') category?: string) {
    const filter = category ? { category: category as NotificationCategory } : undefined;
    return this.templateService.findAll(filter);
  }

  @Get('templates/:eventType')
  @Roles('OWNER', 'BRANCH_MANAGER')
  async getTemplate(@Param('eventType') eventType: string) {
    const tpl = await this.templateService.findByEventType(eventType);
    if (!tpl) throw new NotFoundException(`Template ${eventType} not found`);
    return tpl;
  }

  @Post('templates')
  @Roles('OWNER')
  async createTemplate(@Body() dto: CreateNotificationTemplateDto, @Request() req: any) {
    return this.templateService.create(dto, req.user?.id);
  }

  @Patch('templates/:eventType')
  @Roles('OWNER')
  async updateTemplate(
    @Param('eventType') eventType: string,
    @Body() dto: UpdateNotificationTemplateDto,
    @Request() req: any,
  ) {
    return this.templateService.update(eventType, dto, req.user?.id);
  }

  @Delete('templates/:eventType')
  @Roles('OWNER')
  async deleteTemplate(@Param('eventType') eventType: string, @Request() req: any) {
    return this.templateService.softDelete(eventType, req.user?.id);
  }

  @Post('templates/:eventType/preview')
  @Roles('OWNER', 'BRANCH_MANAGER')
  async previewTemplate(
    @Param('eventType') eventType: string,
    @Body() dto: PreviewTemplateDto,
  ) {
    return this.templateService.renderPreview(eventType, dto.data);
  }

  @Post('templates/:eventType/test-send')
  @Roles('OWNER', 'BRANCH_MANAGER')
  async testSendTemplate(
    @Param('eventType') eventType: string,
    @Body() dto: TestSendTemplateDto,
    @Request() req: any,
  ) {
    const adminUser = req.user;
    const tpl = await this.templateService.findByEventType(eventType);
    if (!tpl) throw new NotFoundException(`Template ${eventType} not found`);

    // Resolve recipient based on template's channel
    let recipient: string | null = null;
    if (tpl.channel === 'LINE') {
      recipient = adminUser.lineId ?? null;
    } else if (tpl.channel === 'SMS') {
      recipient = adminUser.phone ?? null;
    }

    if (!recipient) {
      throw new BadRequestException(`Cannot test-send: admin has no ${tpl.channel} contact`);
    }

    // Use the template's sample data (or override if provided)
    const data = dto.data ?? (tpl.sampleData as Record<string, string> | null) ?? {};

    // Render the message + send raw with [TEST] prefix
    const rendered = await this.templateService.renderPreview(eventType, data);

    return this.notificationsService.send({
      channel: tpl.channel,
      channelKey: tpl.channelKey as any,
      recipient,
      subject: `[TEST] ${tpl.subject ?? tpl.name}`,
      message: `[TEST] ${rendered.rendered}`,
      customerId: adminUser.id,
      category: tpl.category,
      bypassCompliance: true, // test sends bypass time/frequency gates
    });
  }

  @Post('bulk')
  @Roles('OWNER', 'BRANCH_MANAGER')
  sendBulk(@Body() dto: BulkNotificationDto) {
    return this.notificationsService.sendBulk(dto.templateId, dto.contractIds);
  }

  @Get('sms-status')
  @Roles('OWNER')
  checkSmsStatus() {
    return this.notificationsService.checkSmsCredit();
  }

  @Get('sms/credit')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  getSmsCredit() {
    return this.notificationsService.checkSmsCredit();
  }

  // ============================================================
  // CRON / SCHEDULING ENDPOINTS
  // ============================================================

  @Post('cron/payment-reminders')
  @Roles('OWNER')
  sendPaymentReminders() {
    return this.notificationsService.sendPaymentReminders();
  }

  @Post('cron/overdue-notices')
  @Roles('OWNER')
  sendOverdueNotices() {
    return this.notificationsService.sendOverdueNotices();
  }

  @Post('cron/notify-managers')
  @Roles('OWNER')
  notifyManagers() {
    return this.notificationsService.notifyManagersOverdue();
  }

  @Post('cron/notify-owner-default')
  @Roles('OWNER')
  notifyOwnerDefault() {
    return this.notificationsService.notifyOwnerDefault();
  }
}
