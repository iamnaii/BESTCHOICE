import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationsService } from './notifications.service';
import { OverdueService } from '../overdue/overdue.service';
import { ReorderPointsService } from '../reorder-points/reorder-points.service';
import { WarrantyService } from '../products/warranty.service';
import { ReportGeneratorService } from '../reports/report-generator.service';
import { PrismaService } from '../../prisma/prisma.service';
import { LineOaService } from '../line-oa/line-oa.service';
import { PaymentLinkService } from '../line-oa/payment-links/payment-link.service';
import { buildOverdueNoticeFlex } from '../line-oa/flex-messages/overdue-notice.flex';
import { buildPaymentReminderFlex } from '../line-oa/flex-messages/payment-reminder.flex';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private notificationsService: NotificationsService,
    private overdueService: OverdueService,
    private reorderPointsService: ReorderPointsService,
    private warrantyService: WarrantyService,
    private reportGeneratorService: ReportGeneratorService,
    private prisma: PrismaService,
    private lineOaService: LineOaService,
    private paymentLinkService: PaymentLinkService,
  ) {}

  /**
   * Run daily at midnight: calculate late fees for all overdue payments
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleLateFeeCalculation() {
    this.logger.log('Starting daily late fee calculation...');
    try {
      const result = await this.overdueService.calculateLateFees();
      this.logger.log(`Late fee calculation complete: ${result.updated} payments updated`);
    } catch (error) {
      this.logger.error(`Late fee calculation failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  /**
   * Run daily at 00:30: update contract statuses (ACTIVE->OVERDUE->DEFAULT)
   */
  @Cron('30 0 * * *')
  async handleContractStatusUpdate() {
    this.logger.log('Starting daily contract status update...');
    try {
      const result = await this.overdueService.updateContractStatuses();
      this.logger.log(`Status update complete: ${result.overdueUpdated} overdue, ${result.defaultUpdated} default`);

      // Send LINE notifications to customers whose contracts changed status
      const changedIds = [...result.overdueIds, ...result.defaultIds];
      if (changedIds.length > 0) {
        await this.notifyStatusChangedCustomers(changedIds);
      }
    } catch (error) {
      this.logger.error(`Contract status update failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  /**
   * Send LINE overdue/default notice to customers whose contracts just changed status
   */
  private async notifyStatusChangedCustomers(contractIds: string[]) {
    const contracts = await this.prisma.contract.findMany({
      where: { id: { in: contractIds } },
      include: {
        customer: { select: { name: true, lineId: true, phone: true } },
        payments: {
          where: { status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] }, dueDate: { lt: new Date() } },
          orderBy: { installmentNo: 'asc' },
        },
      },
    });

    let sent = 0;
    for (const contract of contracts) {
      const lineId = contract.customer?.lineId;
      if (!lineId) continue;

      try {
        const totalOverdue = contract.payments.reduce(
          (sum, p) => sum + (Number(p.amountDue) - Number(p.amountPaid) + Number(p.lateFee)),
          0,
        );
        const oldestDue = contract.payments[0]?.dueDate;
        const daysOverdue = oldestDue
          ? Math.floor((Date.now() - oldestDue.getTime()) / (1000 * 60 * 60 * 24))
          : 0;

        const lateFee = contract.payments.reduce((sum, p) => sum + Number(p.lateFee), 0);
        const flex = buildOverdueNoticeFlex({
          customerName: contract.customer?.name || '-',
          contractNumber: contract.contractNumber,
          installmentNo: contract.payments[0]?.installmentNo || 0,
          totalInstallments: contract.totalMonths,
          amountDue: totalOverdue,
          lateFee,
          totalOutstanding: totalOverdue,
          dueDate: oldestDue?.toLocaleDateString('th-TH') || '-',
          daysOverdue,
        });

        await this.lineOaService.sendFlexMessage(lineId, flex);
        sent++;
      } catch (err) {
        this.logger.warn(`Failed to notify customer for contract ${contract.contractNumber}: ${err}`);
      }
    }

    this.logger.log(`Status change LINE notifications: ${sent} sent out of ${contracts.length} contracts`);
  }

  /**
   * Run daily at 08:00: send payment reminders (3 days and 1 day before due)
   */
  @Cron('0 8 * * *')
  async handlePaymentReminders() {
    this.logger.log('Starting daily payment reminders...');
    try {
      const result = await this.notificationsService.sendPaymentReminders();
      this.logger.log(`Payment reminders complete: ${result.sent} sent`);
    } catch (error) {
      this.logger.error(`Payment reminders failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  /**
   * Run daily at 09:00: send overdue notices (day 1, 3, 7)
   */
  @Cron('0 9 * * *')
  async handleOverdueNotices() {
    this.logger.log('Starting daily overdue notices...');
    try {
      const result = await this.notificationsService.sendOverdueNotices();
      this.logger.log(`Overdue notices complete: ${result.sent} sent`);
    } catch (error) {
      this.logger.error(`Overdue notices failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  /**
   * Run daily at 09:30: notify branch managers about overdue contracts
   */
  @Cron('30 9 * * *')
  async handleManagerNotifications() {
    this.logger.log('Starting manager notifications...');
    try {
      const result = await this.notificationsService.notifyManagersOverdue();
      this.logger.log(`Manager notifications complete: ${result.sent} sent for ${result.contracts} contracts`);
    } catch (error) {
      this.logger.error(`Manager notifications failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  /**
   * Run daily at 10:00: notify owner about defaulted contracts
   */
  @Cron('0 10 * * *')
  async handleOwnerDefaultNotifications() {
    this.logger.log('Starting owner default notifications...');
    try {
      const result = await this.notificationsService.notifyOwnerDefault();
      this.logger.log(`Owner notifications complete: ${result.sent} sent for ${result.contracts} contracts`);
    } catch (error) {
      this.logger.error(`Owner notifications failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  /**
   * Run daily at 01:00: escalate dunning stages and send stage-specific notifications
   */
  @Cron('0 1 * * *')
  async handleDunningEscalation() {
    this.logger.log('Starting daily dunning escalation...');
    try {
      const result = await this.overdueService.escalateDunningStages();

      // Send stage-specific LINE notifications
      let notified = 0;
      for (const esc of result.escalated) {
        try {
          const contract = await this.prisma.contract.findUnique({
            where: { id: esc.contractId },
            include: {
              customer: { select: { name: true, lineId: true, phone: true } },
              payments: {
                where: { status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] }, dueDate: { lt: new Date() } },
                orderBy: { installmentNo: 'asc' },
              },
            },
          });
          if (!contract?.customer?.lineId) continue;

          const totalOverdue = contract.payments.reduce(
            (sum, p) => sum + (Number(p.amountDue) - Number(p.amountPaid) + Number(p.lateFee)),
            0,
          );

          // Stage-specific messaging
          const stageMessages: Record<string, string> = {
            REMINDER: `แจ้งเตือน: คุณ${contract.customer.name} มียอดค้างชำระ ${totalOverdue.toLocaleString()} บาท สัญญา ${esc.contractNumber} กรุณาชำระโดยเร็ว`,
            NOTICE: `แจ้งค้างชำระ: คุณ${contract.customer.name} มียอดค้างชำระ ${totalOverdue.toLocaleString()} บาท ค้างชำระ ${esc.daysOverdue} วัน กรุณาติดต่อชำระเงินทันที`,
            FINAL_WARNING: `เตือนครั้งสุดท้าย: คุณ${contract.customer.name} ค้างชำระ ${esc.daysOverdue} วัน ยอด ${totalOverdue.toLocaleString()} บาท หากไม่ชำระภายใน 30 วัน จะดำเนินการตามกฎหมาย`,
            LEGAL_ACTION: `แจ้งดำเนินการ: สัญญา ${esc.contractNumber} ค้างชำระเกิน 60 วัน ทางร้านจะดำเนินการยึดคืนสินค้า กรุณาติดต่อร้านทันที`,
          };

          const message = stageMessages[esc.to];
          if (message) {
            await this.notificationsService.send({
              channel: 'LINE',
              recipient: contract.customer.lineId,
              subject: `Dunning: ${esc.to}`,
              message,
              relatedId: esc.contractId,
              fallbackPhone: contract.customer.phone || undefined,
            });
            notified++;
          }
        } catch (err) {
          this.logger.warn(`Failed to send dunning notification for ${esc.contractNumber}: ${err}`);
        }
      }

      this.logger.log(`Dunning escalation complete: ${result.escalated.length} escalated, ${notified} notified`);
    } catch (error) {
      this.logger.error(`Dunning escalation failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  /**
   * Run daily at 07:00: check stock levels and send alerts for low stock
   */
  @Cron('0 7 * * *')
  async handleStockLevelCheck() {
    this.logger.log('Starting daily stock level check...');
    try {
      const result = await this.reorderPointsService.checkStockLevels();
      this.logger.log(`Stock check complete: ${result.alertsCreated} alerts, ${result.notificationsSent} notifications`);
    } catch (error) {
      this.logger.error(`Stock level check failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  /**
   * Run every 5 minutes: SLA alerts for contracts pending approval > 20min/60min
   */
  @Cron('*/5 * * * *')
  async handleSlaNotifications() {
    this.logger.log('Starting SLA notification check...');
    try {
      const threshold20min = new Date(Date.now() - 20 * 60 * 1000);
      const threshold60min = new Date(Date.now() - 60 * 60 * 1000);

      // Find contracts stuck in review/approval for > 20min
      const pendingContracts = await this.prisma.contract.findMany({
        where: {
          deletedAt: null,
          workflowStatus: { in: ['PENDING_REVIEW', 'CREATING'] },
          updatedAt: { lt: threshold20min },
        },
        include: {
          customer: { select: { name: true } },
          branch: { select: { id: true, name: true } },
        },
      });

      let sent = 0;
      for (const contract of pendingContracts) {
        const isUrgent = contract.updatedAt < threshold60min;
        const severity = isUrgent ? 'URGENT' : 'WARNING';

        // Create notification log for branch manager
        try {
          const minutesWaiting = Math.round((Date.now() - contract.updatedAt.getTime()) / (1000 * 60));
          const title = isUrgent
            ? `[ด่วน] สัญญา ${contract.contractNumber} รออนุมัติ ${minutesWaiting} นาที`
            : `สัญญา ${contract.contractNumber} รออนุมัติ ${minutesWaiting} นาที`;
          await this.prisma.notificationLog.create({
            data: {
              channel: 'LINE',
              recipient: contract.branchId || '',
              subject: title,
              message: `ลูกค้า: ${contract.customer?.name || '-'} สาขา: ${contract.branch?.name || '-'} สถานะ: ${contract.workflowStatus} (${severity})`,
              status: 'PENDING',
              relatedId: contract.id,
            },
          });
          sent++;
        } catch {
          // Skip if notification log creation fails
        }
      }

      this.logger.log(`SLA check complete: ${pendingContracts.length} contracts pending, ${sent} notifications sent`);
    } catch (error) {
      this.logger.error(`SLA notification check failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  /**
   * Run daily at 08:30: auto-send payment links 3 days before due
   */
  @Cron('30 8 * * *')
  async handleAutoPaymentLinks() {
    this.logger.log('Starting auto payment link generation...');
    try {
      const threeDaysFromNow = new Date();
      threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
      const startOfDay = new Date(threeDaysFromNow.getFullYear(), threeDaysFromNow.getMonth(), threeDaysFromNow.getDate());
      const endOfDay = new Date(startOfDay);
      endOfDay.setDate(endOfDay.getDate() + 1);

      // Find PENDING payments due in 3 days with LINE-linked customers
      const payments = await this.prisma.payment.findMany({
        where: {
          status: 'PENDING',
          dueDate: { gte: startOfDay, lt: endOfDay },
          contract: {
            deletedAt: null,
            status: { in: ['ACTIVE'] },
            customer: { lineId: { not: null }, deletedAt: null },
          },
        },
        include: {
          contract: {
            include: {
              customer: { select: { name: true, lineId: true } },
            },
          },
        },
      });

      let sent = 0;
      for (const payment of payments) {
        const lineId = payment.contract.customer?.lineId;
        if (!lineId) continue;

        try {
          // Create payment link
          const link = await this.paymentLinkService.createPaymentLink(
            payment.contractId,
            payment.installmentNo,
          );

          const amountDue = Number(payment.amountDue) + Number(payment.lateFee) - Number(payment.amountPaid);

          // Send LINE reminder with payment link
          const flex = buildPaymentReminderFlex({
            customerName: payment.contract.customer?.name || '-',
            contractNumber: payment.contract.contractNumber,
            installmentNo: payment.installmentNo,
            totalInstallments: payment.contract.totalMonths,
            amountDue,
            dueDate: payment.dueDate.toLocaleDateString('th-TH'),
            daysUntilDue: 3,
            paymentUrl: link.url,
          });

          await this.lineOaService.sendFlexMessage(lineId, flex);
          sent++;
        } catch (err) {
          this.logger.warn(`Failed to send auto payment link for contract ${payment.contract.contractNumber}: ${err}`);
        }
      }

      this.logger.log(`Auto payment links complete: ${sent} sent out of ${payments.length} payments`);
    } catch (error) {
      this.logger.error(`Auto payment links failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  /**
   * Run every 5 minutes: process notification retry queue
   * Retries failed LINE/SMS notifications with exponential backoff
   */
  @Cron('*/5 * * * *')
  async handleNotificationRetryQueue() {
    try {
      const result = await this.notificationsService.processRetryQueue();
      if (result.retried > 0) {
        this.logger.log(`Notification retry queue: ${result.succeeded} succeeded, ${result.failed} failed out of ${result.retried}`);
      }
    } catch (error) {
      this.logger.error(`Notification retry queue failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  /**
   * Run weekly on Sunday at 02:00: data retention cleanup
   * - 5 years after COMPLETED/EARLY_PAYOFF → soft-delete contract data
   * - 2 years after CLOSED_BAD_DEBT/EXCHANGED → soft-delete contract data
   * - Clean expired customer access tokens
   */
  @Cron('0 2 * * 0')
  async handleDataRetention() {
    this.logger.log('Starting weekly data retention cleanup...');
    try {
      const now = new Date();
      const fiveYearsAgo = new Date(now.getFullYear() - 5, now.getMonth(), now.getDate());
      const twoYearsAgo = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate());

      // Soft-delete completed contracts older than 5 years
      const completedAnonymized = await this.prisma.contract.updateMany({
        where: {
          status: { in: ['COMPLETED', 'EARLY_PAYOFF'] },
          updatedAt: { lt: fiveYearsAgo },
          deletedAt: null,
        },
        data: { deletedAt: now },
      });

      // Soft-delete closed bad debt contracts older than 2 years
      const cancelledAnonymized = await this.prisma.contract.updateMany({
        where: {
          status: { in: ['CLOSED_BAD_DEBT', 'EXCHANGED'] },
          updatedAt: { lt: twoYearsAgo },
          deletedAt: null,
        },
        data: { deletedAt: now },
      });

      // Clean expired customer access tokens
      let tokensCleared = 0;
      try {
        const result = await this.prisma.customerAccessToken.deleteMany({
          where: { expiresAt: { lt: now } },
        });
        tokensCleared = result.count;
      } catch {
        // CustomerAccessToken table might not exist yet
      }

      // Clean expired PDPA consents (withdrawn > 1 year)
      let consentsCleared = 0;
      try {
        const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
        const result = await this.prisma.pDPAConsent.deleteMany({
          where: { status: 'REVOKED', revokedAt: { lt: oneYearAgo } },
        });
        consentsCleared = result.count;
      } catch {
        // PDPAConsent table might not exist yet
      }

      this.logger.log(
        `Data retention complete: ${completedAnonymized.count} completed, ${cancelledAnonymized.count} cancelled soft-deleted, ` +
        `${tokensCleared} expired tokens, ${consentsCleared} withdrawn consents cleaned`,
      );
    } catch (error) {
      this.logger.error(`Data retention cleanup failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  /**
   * Daily: Generate daily financial summary report.
   * Runs at 23:55 ICT (16:55 UTC) to capture full day's data.
   */
  @Cron('55 16 * * *') // 23:55 ICT
  async handleDailyReport() {
    try {
      const report = await this.reportGeneratorService.generateDailySummary();
      this.logger.log(`Daily report: ฿${report.revenue.toLocaleString()}, ${report.paymentsCount} payments`);
    } catch (error) {
      this.logger.error(`Daily report generation failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  /**
   * Weekly: Generate weekly summary (every Monday at 00:05 ICT).
   */
  @Cron('5 17 * * 0') // Monday 00:05 ICT (Sunday 17:05 UTC)
  async handleWeeklyReport() {
    try {
      const report = await this.reportGeneratorService.generateWeeklySummary();
      this.logger.log(`Weekly report: ฿${report.totalRevenue.toLocaleString()} total revenue`);
    } catch (error) {
      this.logger.error(`Weekly report generation failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  /**
   * Daily: Mark expired warranties and log count.
   * Runs at 02:30 ICT (19:30 UTC previous day) to avoid overlap with backup cron.
   */
  @Cron('30 19 * * *') // 02:30 ICT
  async handleWarrantyExpiry() {
    try {
      const count = await this.warrantyService.markExpiredWarranties();
      if (count > 0) {
        this.logger.log(`Warranty check: ${count} products marked as warranty expired`);
      }
    } catch (error) {
      this.logger.error(`Warranty expiry check failed: ${error instanceof Error ? error.message : error}`);
    }
  }
}
