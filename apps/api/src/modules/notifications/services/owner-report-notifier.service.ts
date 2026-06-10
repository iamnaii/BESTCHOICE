import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { LineOaService } from '../../line-oa/line-oa.service';
import { buildDailyReportFlex } from '../../line-oa/flex-messages/daily-report.flex';
import { DashboardService } from '../../dashboard/dashboard.service';

/**
 * Owner-facing report bodies extracted from the scheduler: the daily LINE
 * summary push to OWNER users and the SLA pending-approval notification log
 * creation. The owning @Cron handlers stay on SchedulerService (decorated +
 * try/catch + reportCronFailure shell); only the inner work lives here.
 *
 * Plain class (not @Injectable) — constructed internally by SchedulerService.
 */
export class OwnerReportNotifierService {
  private readonly logger = new Logger(OwnerReportNotifierService.name);

  constructor(
    private prisma: PrismaService,
    private dashboardService: DashboardService,
    private lineOaService: LineOaService,
  ) {}

  /**
   * SLA alerts for contracts pending approval > 20min/60min (the body of handleSlaNotifications).
   */
  async runSlaNotifications() {
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
      } catch (err) {
        this.logger.error(`[SLA] Failed to create notification log: ${err}`);
        Sentry.captureException(err, { tags: { module: 'scheduler', action: 'sla-notification' } });
      }
    }

    this.logger.log(`SLA check complete: ${pendingContracts.length} contracts pending, ${sent} notifications sent`);
  }

  /**
   * Send daily summary report via LINE to all OWNER users (the body of handleDailyLineReport).
   */
  async sendDailyLineReport() {
    // Find OWNER users with LINE IDs configured
    const owners = await this.prisma.user.findMany({
      where: { role: 'OWNER', isActive: true, lineId: { not: null } },
      select: { name: true, lineId: true },
    });

    if (owners.length === 0) {
      this.logger.log('Daily LINE report: no OWNER users with LINE ID configured, skipping');
      return;
    }

    // Fetch KPIs from DashboardService
    const kpis = await this.dashboardService.getKPIs();

    // Count new contracts approved today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const [newContractsToday, pendingApprovals] = await Promise.all([
      this.prisma.contract.count({
        where: {
          createdAt: { gte: todayStart, lte: todayEnd },
          deletedAt: null,
        },
      }),
      this.prisma.contract.count({
        where: {
          workflowStatus: { in: ['PENDING_REVIEW', 'CREATING'] },
          reviewedAt: null,
          deletedAt: null,
        },
      }),
    ]);

    const dateLabel = new Date().toLocaleDateString('th-TH', {
      weekday: 'short',
      year: '2-digit',
      month: 'short',
      day: 'numeric',
    });

    const flex = buildDailyReportFlex({
      date: dateLabel,
      todayPaymentCount: kpis.financial.todayPaymentCount,
      todayPaymentAmount: kpis.financial.todayPayments,
      overdueCount: kpis.contracts.overdue,
      overdueAmount: kpis.financial.totalReceivable,
      defaultCount: kpis.contracts.default,
      newContractsToday,
      pendingApprovals,
    });

    let sent = 0;
    for (const owner of owners) {
      try {
        await this.lineOaService.sendFlexMessage(owner.lineId!, flex, 'line-staff');
        sent++;
      } catch (err) {
        this.logger.warn(`Daily LINE report: failed to send to ${owner.name}: ${err}`);
      }
    }

    this.logger.log(`Daily LINE report sent: ${sent}/${owners.length} OWNER users`);
  }
}
