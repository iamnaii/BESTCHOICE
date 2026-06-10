import { Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationsService } from './notifications.service';
import { OverdueService } from '../overdue/overdue.service';
import { ReorderPointsService } from '../inventory/reorder-points.service';
import { WarrantyService } from '../products/warranty.service';
import { ReportGeneratorService } from '../reports/report-generator.service';
import { PrismaService } from '../../prisma/prisma.service';
import { LineOaService } from '../line-oa/line-oa.service';
import { PaymentLinkService } from '../line-oa/payment-links/payment-link.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { PDPAService } from '../pdpa/pdpa.service';
import { DunningEngineService } from '../overdue/dunning-engine.service';
import { IntegrationConfigService } from '../integrations/integration-config.service';
import { CollectionsNotifierService } from './services/collections-notifier.service';
import { RetentionService } from './services/retention.service';
import { OwnerReportNotifierService } from './services/owner-report-notifier.service';

/**
 * Cron orchestrator facade. ALL 20 @Cron-decorated handlers + their decorators +
 * the centralized reportCronFailure reporter stay on this DI-instantiated
 * provider class (moving decorated methods into sub-services would un-register
 * the crons from @nestjs/schedule). The ~12 pure pass-through handlers stay
 * inline; the 6 logic-heavy handlers keep their try/catch + reportCronFailure
 * shell here and delegate their body to one of three internally-constructed
 * sub-services — Collections (status/dunning/payment-link notify), Retention
 * (best-effort cleanup writes), OwnerReport (daily LINE report + SLA log).
 */
@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  private readonly collectionsNotifier: CollectionsNotifierService;
  private readonly retention: RetentionService;
  private readonly ownerReportNotifier: OwnerReportNotifierService;

  constructor(
    private notificationsService: NotificationsService,
    private overdueService: OverdueService,
    private reorderPointsService: ReorderPointsService,
    private warrantyService: WarrantyService,
    private reportGeneratorService: ReportGeneratorService,
    private prisma: PrismaService,
    private lineOaService: LineOaService,
    private paymentLinkService: PaymentLinkService,
    private dashboardService: DashboardService,
    private pdpaService: PDPAService,
    private dunningEngineService: DunningEngineService,
    private integrationConfig: IntegrationConfigService,
  ) {
    this.collectionsNotifier = new CollectionsNotifierService(
      this.prisma,
      this.lineOaService,
      this.pdpaService,
      this.notificationsService,
      this.paymentLinkService,
    );
    this.retention = new RetentionService(this.prisma);
    this.ownerReportNotifier = new OwnerReportNotifierService(
      this.prisma,
      this.dashboardService,
      this.lineOaService,
    );
  }

  /**
   * Centralized error reporter for cron jobs.
   * Logs locally AND captures to Sentry so silent cron failures get noticed.
   * Tagged with the job name for grouping in Sentry.
   */
  private reportCronFailure(jobName: string, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error(`${jobName} failed: ${message}`);
    Sentry.captureException(error, {
      tags: { kind: 'cron-job', cron: jobName },
    });
  }

  /**
   * Run daily at midnight: calculate late fees for all overdue payments
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { timeZone: 'Asia/Bangkok' })
  async handleLateFeeCalculation() {
    this.logger.log('Starting daily late fee calculation...');
    try {
      const result = await this.overdueService.calculateLateFees();
      this.logger.log(`Late fee calculation complete: ${result.updated} payments updated`);
    } catch (error) {
      this.reportCronFailure('late-fee-calculation', error);
    }
  }

  /**
   * Run daily at 00:30: update contract statuses (ACTIVE->OVERDUE->DEFAULT)
   */
  @Cron('30 0 * * *', { timeZone: 'Asia/Bangkok' })
  async handleContractStatusUpdate() {
    this.logger.log('Starting daily contract status update...');
    try {
      const result = await this.overdueService.updateContractStatuses();
      this.logger.log(`Status update complete: ${result.overdueUpdated} overdue, ${result.defaultUpdated} default`);

      // Send LINE notifications to customers whose contracts changed status
      const changedIds = [...result.overdueIds, ...result.defaultIds];
      if (changedIds.length > 0) {
        await this.collectionsNotifier.notifyStatusChangedCustomers(changedIds);
      }
    } catch (error) {
      this.reportCronFailure('contract-status-update', error);
    }
  }

  /**
   * Run daily at 08:00: send payment reminders (3 days and 1 day before due)
   */
  @Cron('0 8 * * *', { timeZone: 'Asia/Bangkok' })
  async handlePaymentReminders() {
    this.logger.log('Starting daily payment reminders...');
    try {
      const result = await this.notificationsService.sendPaymentReminders();
      this.logger.log(`Payment reminders complete: ${result.sent} sent`);
    } catch (error) {
      this.reportCronFailure('payment-reminders', error);
    }
  }

  /**
   * Run daily at 09:00: send overdue notices (day 1, 3, 7)
   */
  @Cron('0 9 * * *', { timeZone: 'Asia/Bangkok' })
  async handleOverdueNotices() {
    this.logger.log('Starting daily overdue notices...');
    try {
      const result = await this.notificationsService.sendOverdueNotices();
      this.logger.log(`Overdue notices complete: ${result.sent} sent`);
    } catch (error) {
      this.reportCronFailure('overdue-notices', error);
    }
  }

  /**
   * Run daily at 09:30: notify branch managers about overdue contracts
   */
  @Cron('30 9 * * *', { timeZone: 'Asia/Bangkok' })
  async handleManagerNotifications() {
    this.logger.log('Starting manager notifications...');
    try {
      const result = await this.notificationsService.notifyManagersOverdue();
      this.logger.log(`Manager notifications complete: ${result.sent} sent for ${result.contracts} contracts`);
    } catch (error) {
      this.reportCronFailure('manager-notifications', error);
    }
  }

  /**
   * Run daily at 10:00: notify owner about defaulted contracts
   */
  @Cron('0 10 * * *', { timeZone: 'Asia/Bangkok' })
  async handleOwnerDefaultNotifications() {
    this.logger.log('Starting owner default notifications...');
    try {
      const result = await this.notificationsService.notifyOwnerDefault();
      this.logger.log(`Owner notifications complete: ${result.sent} sent for ${result.contracts} contracts`);
    } catch (error) {
      this.reportCronFailure('owner-default-notifications', error);
    }
  }

  /**
   * Run daily at 01:00: escalate dunning stages and send stage-specific notifications
   */
  @Cron('0 1 * * *', { timeZone: 'Asia/Bangkok' })
  async handleDunningEscalation() {
    this.logger.log('Starting daily dunning escalation...');
    try {
      const result = await this.overdueService.escalateDunningStages();

      await this.collectionsNotifier.notifyEscalatedDunning(result);
    } catch (error) {
      this.reportCronFailure('dunning-escalation', error);
    }
  }

  /**
   * Run daily at 07:00: check stock levels and send alerts for low stock
   */
  @Cron('0 7 * * *', { timeZone: 'Asia/Bangkok' })
  async handleStockLevelCheck() {
    this.logger.log('Starting daily stock level check...');
    try {
      const result = await this.reorderPointsService.checkStockLevels();
      this.logger.log(`Stock check complete: ${result.alertsCreated} alerts, ${result.notificationsSent} notifications`);
    } catch (error) {
      this.reportCronFailure('stock-level-check', error);
    }
  }

  /**
   * Run every 5 minutes: SLA alerts for contracts pending approval > 20min/60min
   */
  @Cron('*/5 * * * *', { timeZone: 'Asia/Bangkok' })
  async handleSlaNotifications() {
    this.logger.log('Starting SLA notification check...');
    try {
      await this.ownerReportNotifier.runSlaNotifications();
    } catch (error) {
      this.reportCronFailure('sla-notification-check', error);
    }
  }

  /**
   * Run daily at 08:15: execute configurable dunning rules
   * Runs AFTER payment reminders (08:00) and BEFORE overdue notices (09:00)
   */
  @Cron('15 8 * * *', { timeZone: 'Asia/Bangkok' })
  async handleDunningRuleExecution() {
    this.logger.log('Starting configurable dunning rule execution...');
    try {
      const result = await this.dunningEngineService.executeRules();
      this.logger.log(
        `Dunning rules complete: ${result.executed} executed, ${result.skipped} skipped, ${result.failed} failed`,
      );
    } catch (error) {
      this.reportCronFailure('dunning-rule-execution', error);
    }
  }

  /**
   * Run daily at 08:30: auto-send payment links 3 days before due
   */
  @Cron('30 8 * * *', { timeZone: 'Asia/Bangkok' })
  async handleAutoPaymentLinks() {
    this.logger.log('Starting auto payment link generation...');
    try {
      await this.collectionsNotifier.sendAutoPaymentLinks();
    } catch (error) {
      this.reportCronFailure('auto-payment-links', error);
    }
  }

  /**
   * Run every 5 minutes: process notification retry queue
   * Retries failed LINE/SMS notifications with exponential backoff
   */
  @Cron('*/5 * * * *', { timeZone: 'Asia/Bangkok' })
  async handleNotificationRetryQueue() {
    try {
      const result = await this.notificationsService.processRetryQueue();
      if (result.retried > 0) {
        this.logger.log(`Notification retry queue: ${result.succeeded} succeeded, ${result.failed} failed out of ${result.retried}`);
      }
    } catch (error) {
      this.reportCronFailure('notification-retry-queue', error);
    }
  }

  /**
   * Run weekly on Sunday at 09:00 ICT: data retention cleanup
   * - 5 years after COMPLETED/EARLY_PAYOFF → soft-delete contract data
   * - 2 years after CLOSED_BAD_DEBT/EXCHANGED → soft-delete contract data
   * - Clean expired customer access tokens
   */
  @Cron('0 9 * * 0', { timeZone: 'Asia/Bangkok' }) // Sunday 09:00 ICT
  async handleDataRetention() {
    this.logger.log('Starting weekly data retention cleanup...');
    try {
      await this.retention.runDataRetention();
    } catch (error) {
      this.reportCronFailure('data-retention', error);
    }
  }

  /**
   * Daily: Generate daily financial summary report.
   * Runs at 23:55 ICT to capture full day's data.
   */
  @Cron('55 23 * * *', { timeZone: 'Asia/Bangkok' }) // 23:55 ICT
  async handleDailyReport() {
    try {
      const report = await this.reportGeneratorService.generateDailySummary();
      this.logger.log(`Daily report: ฿${report.revenue.toLocaleString()}, ${report.paymentsCount} payments`);
    } catch (error) {
      this.reportCronFailure('daily-report', error);
    }
  }

  /**
   * Weekly: Generate weekly summary (every Monday at 00:05 ICT).
   */
  @Cron('5 0 * * 1', { timeZone: 'Asia/Bangkok' }) // Monday 00:05 ICT
  async handleWeeklyReport() {
    try {
      const report = await this.reportGeneratorService.generateWeeklySummary();
      this.logger.log(`Weekly report: ฿${report.totalRevenue.toLocaleString()} total revenue`);
    } catch (error) {
      this.reportCronFailure('weekly-report', error);
    }
  }

  /**
   * Daily: Mark expired warranties and log count.
   * Runs at 02:30 ICT to avoid overlap with backup cron.
   */
  @Cron('30 2 * * *', { timeZone: 'Asia/Bangkok' }) // 02:30 ICT
  async handleWarrantyExpiry() {
    try {
      const count = await this.warrantyService.markExpiredWarranties();
      if (count > 0) {
        this.logger.log(`Warranty check: ${count} products marked as warranty expired`);
      }
    } catch (error) {
      this.reportCronFailure('warranty-expiry', error);
    }
  }

  /**
   * Monthly on the 1st at 02:00: ChatMessage retention — soft-delete messages older than 6 months.
   * ChatMessage has a deletedAt field so we use soft-delete to preserve referential integrity.
   * DocumentAuditLog (no deletedAt) uses hard-delete in the companion cron below.
   */
  @Cron('0 2 1 * *', { timeZone: 'Asia/Bangkok' })
  async handleChatMessageRetention() {
    this.logger.log('Starting monthly ChatMessage retention cleanup...');
    try {
      await this.retention.runChatMessageRetention();
    } catch (error) {
      this.reportCronFailure('chat-message-retention', error);
    }
  }

  /**
   * Monthly on the 1st at 02:15: DocumentAuditLog retention — hard-delete entries older than 2 years.
   * DocumentAuditLog has no deletedAt column (append-only audit trail) so we hard-delete.
   * 2-year retention satisfies Thai e-commerce / PDPA audit trail requirements.
   */
  @Cron('15 2 1 * *', { timeZone: 'Asia/Bangkok' })
  async handleDocumentAuditLogRetention() {
    this.logger.log('Starting monthly DocumentAuditLog retention cleanup...');
    try {
      await this.retention.runDocumentAuditLogRetention();
    } catch (error) {
      this.reportCronFailure('document-audit-log-retention', error);
    }
  }

  /**
   * Daily at 20:00 ICT: Send daily summary report via LINE to all OWNER users
   */
  @Cron('0 20 * * *', { timeZone: 'Asia/Bangkok' }) // 20:00 ICT
  async handleDailyLineReport() {
    this.logger.log('Starting daily LINE report to OWNER users...');
    try {
      await this.ownerReportNotifier.sendDailyLineReport();
    } catch (error) {
      this.reportCronFailure('daily-line-report', error);
    }
  }

  /**
   * Run daily at 09:00 ICT — alert if SMS credit is low
   */
  @Cron('0 9 * * *', { timeZone: 'Asia/Bangkok' }) // 09:00 ICT
  async handleSmsCreditAlert() {
    this.logger.log('Checking SMS credit balance...');
    try {
      const credit = await this.notificationsService.checkSmsCredit();
      if (!credit.configured) return;
      if (credit.credit !== undefined && credit.credit < 100) {
        const staffTargets = (await this.integrationConfig.getValue('line-staff', 'notifyTargets')) || '';
        const targets = staffTargets.split(',').map((s) => s.trim()).filter(Boolean);
        for (const target of targets) {
          await this.notificationsService.sendFromTemplate(
            'staff.sms_credit_low',
            { credit: String(credit.credit) },
            target,
            { relatedId: 'sms-credit-alert' },
          );
        }
        this.logger.warn(`SMS credit low (${credit.credit}) — alerted ${targets.length} staff`);
      }
    } catch (error) {
      this.reportCronFailure('sms-credit-alert', error);
    }
  }
}
