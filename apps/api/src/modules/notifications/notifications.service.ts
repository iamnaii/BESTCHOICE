import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { SendNotificationDto } from './dto/create-notification.dto';
import type { LineChannelKey } from './dto/create-notification.dto';
import { FlexTemplatesService } from '../line-oa/flex-templates.service';
import { QuickReplyService } from '../line-oa/quick-reply.service';
import { IntegrationConfigService } from '../integrations/integration-config.service';
import { ComplianceService } from './compliance.service';
import { NotificationTemplateService } from './notification-template.service';
import { NotificationTransportService } from './services/notification-transport.service';
import { NotificationDispatchService } from './services/notification-dispatch.service';
import { NotificationReminderService } from './services/notification-reminder.service';
import { NotificationStatsService } from './services/notification-stats.service';

/**
 * Facade over the decomposed notification sub-services. Preserves the public
 * 15-method surface + the 7-arg constructor that 16 external consumer modules
 * and 12 spec files depend on. The four sub-services are plain classes built
 * internally here (not DI-registered) — Transport (provider transport core),
 * Dispatch (send hub + retry queue), Reminder (cron dunning), Stats (read-side
 * analytics) — wired with cross-refs in build order.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  /** Sub-services exposed read-only so DB-backed specs can retarget spies. */
  readonly transport: NotificationTransportService;
  readonly dispatch: NotificationDispatchService;
  readonly reminder: NotificationReminderService;
  readonly stats: NotificationStatsService;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private flexTemplates: FlexTemplatesService,
    private quickReplyService: QuickReplyService,
    private integrationConfig: IntegrationConfigService,
    private compliance: ComplianceService,
    private templateService: NotificationTemplateService,
  ) {
    this.transport = new NotificationTransportService(
      this.prisma,
      this.configService,
      this.integrationConfig,
    );
    this.dispatch = new NotificationDispatchService(
      this.transport,
      this.prisma,
      this.compliance,
      this.templateService,
    );
    this.reminder = new NotificationReminderService(
      this.prisma,
      this.dispatch,
      this.transport,
      this.flexTemplates,
      this.quickReplyService,
    );
    this.stats = new NotificationStatsService(this.prisma, this.transport);
  }

  // ============================================================
  // NOTIFICATION SENDING (→ dispatch)
  // ============================================================

  send(dto: SendNotificationDto): Promise<{ id: string; status: string; errorMsg?: string; blockReason?: string }> {
    return this.dispatch.send(dto);
  }

  sendFromTemplate(
    eventType: string,
    data: Record<string, string>,
    recipient: string,
    options: {
      relatedId?: string;
      customerId?: string;
      bypassCompliance?: boolean;
      fallbackPhone?: string;
    } = {},
  ): Promise<{ id: string | null; status: string; blockReason?: string }> {
    return this.dispatch.sendFromTemplate(eventType, data, recipient, options);
  }

  sendBulk(eventType: string, contractIds: string[]) {
    return this.dispatch.sendBulk(eventType, contractIds);
  }

  processRetryQueue(): Promise<{ retried: number; succeeded: number; failed: number }> {
    return this.dispatch.processRetryQueue();
  }

  // ============================================================
  // TRANSPORT (→ transport)
  // ============================================================

  /** Public wrapper for queue worker to send SMS */
  sendSmsFromQueue(recipient: string, message: string): Promise<string | undefined> {
    return this.transport.sendSmsFromQueue(recipient, message);
  }

  /** Public wrapper for queue worker to send a LINE push (defaults to the finance OA) */
  sendLineFromQueue(
    recipient: string,
    message: string,
    channelKey: LineChannelKey = 'line-finance',
  ): Promise<void> {
    return this.transport.sendLineFromQueue(recipient, message, channelKey);
  }

  checkSmsCredit(): Promise<{ configured: boolean; credit?: number; error?: string }> {
    return this.transport.checkSmsCredit();
  }

  handleSmsDeliveryReport(body: Record<string, unknown>): Promise<{ received: boolean }> {
    return this.transport.handleSmsDeliveryReport(body);
  }

  // ============================================================
  // SCHEDULING (CRON-BASED) (→ reminder)
  // ============================================================

  sendPaymentReminders() {
    return this.reminder.sendPaymentReminders();
  }

  sendOverdueNotices() {
    return this.reminder.sendOverdueNotices();
  }

  notifyManagersOverdue() {
    return this.reminder.notifyManagersOverdue();
  }

  notifyOwnerDefault() {
    return this.reminder.notifyOwnerDefault();
  }

  // ============================================================
  // NOTIFICATION LOGS / STATS (→ stats)
  // ============================================================

  findLogs(filters: { channel?: string; status?: string; relatedId?: string; limit?: number }) {
    return this.stats.findLogs(filters);
  }

  getLogStats() {
    return this.stats.getLogStats();
  }

  getComplianceStats(days = 7) {
    return this.stats.getComplianceStats(days);
  }
}
