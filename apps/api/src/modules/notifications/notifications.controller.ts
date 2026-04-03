import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Logger } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import {
  SendNotificationDto,
  CreateNotificationTemplateDto,
  UpdateNotificationTemplateDto,
  BulkNotificationDto,
} from './dto/create-notification.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Notifications')
@ApiBearerAuth('JWT')
@Controller('notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
export class NotificationsController {
  private readonly logger = new Logger(NotificationsController.name);

  constructor(private notificationsService: NotificationsService) {}

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
    @Body() body: { templateId: string; data: Record<string, string>; recipient: string; relatedId?: string },
  ) {
    return this.notificationsService.sendFromTemplate(
      body.templateId,
      body.data,
      body.recipient,
      body.relatedId,
    );
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

  // ============================================================
  // TEMPLATES
  // ============================================================

  @Get('templates')
  @Roles('OWNER', 'BRANCH_MANAGER')
  findTemplates() {
    return this.notificationsService.findTemplates();
  }

  @Get('templates/:id')
  @Roles('OWNER', 'BRANCH_MANAGER')
  findTemplate(@Param('id') id: string) {
    return this.notificationsService.findTemplate(id);
  }

  @Post('templates')
  @Roles('OWNER')
  createTemplate(@Body() dto: CreateNotificationTemplateDto) {
    return this.notificationsService.createTemplate(dto);
  }

  @Patch('templates/:id')
  @Roles('OWNER')
  updateTemplate(@Param('id') id: string, @Body() dto: UpdateNotificationTemplateDto) {
    return this.notificationsService.updateTemplate(id, dto);
  }

  @Delete('templates/:id')
  @Roles('OWNER')
  deleteTemplate(@Param('id') id: string) {
    return this.notificationsService.deleteTemplate(id);
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

  // ============================================================
  // SMS SETTINGS
  // ============================================================

  @Get('sms-settings')
  @Roles('OWNER')
  getSmsSettings() {
    return this.notificationsService.getSmsSettings();
  }

  @Post('sms-settings')
  @Roles('OWNER')
  async saveSmsSettings(@Body() body: Record<string, string>) {
    const result = await this.notificationsService.saveSmsSettings(body);
    this.logger.log('[SMS] Settings updated by admin');
    return result;
  }

  @Post('sms-settings/test-connection')
  @Roles('OWNER')
  async testSmsConnection() {
    const result = await this.notificationsService.checkSmsCredit();
    return {
      success: result.configured && !result.error,
      credit: result.credit,
      error: result.error,
    };
  }

  @Post('sms-settings/test-send')
  @Roles('OWNER')
  async testSmsSend(@Body() body: { phone: string }) {
    if (!body.phone) {
      return { success: false, error: 'กรุณาระบุเบอร์โทรศัพท์' };
    }
    return this.notificationsService.sendTestSms(body.phone);
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
