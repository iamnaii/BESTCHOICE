import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationsService } from './notifications.service';
import { OverdueService } from '../overdue/overdue.service';
import { ReorderPointsService } from '../reorder-points/reorder-points.service';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private notificationsService: NotificationsService,
    private overdueService: OverdueService,
    private reorderPointsService: ReorderPointsService,
    private prisma: PrismaService,
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
    } catch (error) {
      this.logger.error(`Contract status update failed: ${error instanceof Error ? error.message : error}`);
    }
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
   * Run every 6 hours: SLA alerts for contracts pending approval > 24h/48h
   */
  @Cron('0 */6 * * *')
  async handleSlaNotifications() {
    this.logger.log('Starting SLA notification check...');
    try {
      const threshold24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const threshold48h = new Date(Date.now() - 48 * 60 * 60 * 1000);

      // Find contracts stuck in review/approval for > 24h
      const pendingContracts = await this.prisma.contract.findMany({
        where: {
          deletedAt: null,
          workflowStatus: { in: ['PENDING_REVIEW', 'CREATING'] },
          updatedAt: { lt: threshold24h },
        },
        include: {
          customer: { select: { name: true } },
          branch: { select: { id: true, name: true } },
        },
      });

      let sent = 0;
      for (const contract of pendingContracts) {
        const hoursWaiting = Math.round((Date.now() - contract.updatedAt.getTime()) / (1000 * 60 * 60));
        const isUrgent = contract.updatedAt < threshold48h;
        const severity = isUrgent ? 'URGENT' : 'WARNING';

        // Create notification log for branch manager
        try {
          const title = isUrgent
            ? `[ด่วน] สัญญา ${contract.contractNumber} รออนุมัติ ${hoursWaiting} ชม.`
            : `สัญญา ${contract.contractNumber} รออนุมัติ ${hoursWaiting} ชม.`;
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
}
