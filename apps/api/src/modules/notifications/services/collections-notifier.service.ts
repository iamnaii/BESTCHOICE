import { Logger } from '@nestjs/common';
import { formatDateShort } from '../../../utils/thai-date.util';
import { PrismaService } from '../../../prisma/prisma.service';
import { LineOaService } from '../../line-oa/line-oa.service';
import { PaymentLinkService } from '../../line-oa/payment-links/payment-link.service';
import { buildOverdueNoticeFlex } from '../../line-oa/flex-messages/overdue-notice.flex';
import { buildPaymentReminderFlex } from '../../line-oa/flex-messages/payment-reminder.flex';
import { PDPAService } from '../../pdpa/pdpa.service';
import { NotificationsService } from '../notifications.service';
import { isSmsPaymentReminderDisabled } from '../../../utils/sms-payment-reminder.util';

/**
 * Collections-side LINE notification bodies extracted from the scheduler:
 * status-change overdue/default notices, dunning-stage notifications, and the
 * auto payment-link reminder. The owning @Cron handlers stay on SchedulerService
 * (decorated + try/catch + reportCronFailure shell); only the inner work lives here.
 *
 * Plain class (not @Injectable) — constructed internally by SchedulerService.
 */
export class CollectionsNotifierService {
  private readonly logger = new Logger(CollectionsNotifierService.name);

  constructor(
    private prisma: PrismaService,
    private lineOaService: LineOaService,
    private pdpaService: PDPAService,
    private notificationsService: NotificationsService,
    private paymentLinkService: PaymentLinkService,
  ) {}

  /**
   * Send LINE overdue/default notice to customers whose contracts just changed status
   */
  async notifyStatusChangedCustomers(contractIds: string[]) {
    const contracts = await this.prisma.contract.findMany({
      where: { id: { in: contractIds } },
      include: {
        customer: { select: { id: true, name: true, lineIdFinance: true, phone: true } },
        payments: {
          where: { status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] }, dueDate: { lt: new Date() } },
          orderBy: { installmentNo: 'asc' },
        },
      },
    });

    let sent = 0;
    for (const contract of contracts) {
      const lineId = contract.customer?.lineIdFinance;
      if (!lineId) continue;

      // Check PDPA consent before sending
      if (contract.customer?.id) {
        const hasConsent = await this.pdpaService.hasActiveConsent(contract.customer.id);
        if (!hasConsent) {
          this.logger.debug(`PDPA: skipping status notification for customer ${contract.customer.id}`);
          continue;
        }
      }

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
          dueDate: oldestDue ? formatDateShort(oldestDue) : '-',
          daysOverdue,
        });

        await this.lineOaService.sendFlexMessage(lineId, flex, 'line-finance');
        sent++;
      } catch (err) {
        this.logger.warn(`Failed to notify customer for contract ${contract.contractNumber}: ${err}`);
      }
    }

    this.logger.log(`Status change LINE notifications: ${sent} sent out of ${contracts.length} contracts`);
  }

  /**
   * Send stage-specific LINE notifications for the contracts escalated by
   * overdueService.escalateDunningStages (the escalation mutation stays on the
   * facade; this is the downstream notify loop body).
   */
  async notifyEscalatedDunning(
    result: {
      escalated: {
        contractId: string;
        contractNumber: string;
        daysOverdue: number;
        to: string;
      }[];
    },
  ) {
    // Batch-fetch all escalated contracts to avoid N+1 queries
    const escalatedIds = result.escalated.map((e) => e.contractId);
    const now = new Date();
    const contractsById = new Map(
      (
        await this.prisma.contract.findMany({
          where: { id: { in: escalatedIds } },
          include: {
            customer: { select: { name: true, lineIdFinance: true, phone: true } },
            payments: {
              where: { status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] }, dueDate: { lt: now } },
              orderBy: { installmentNo: 'asc' },
            },
          },
        })
      ).map((c) => [c.id, c]),
    );

    // Send stage-specific LINE notifications
    let notified = 0;
    for (const esc of result.escalated) {
      try {
        const contract = contractsById.get(esc.contractId);
        if (!contract?.customer?.lineIdFinance) continue;

        const totalOverdue = contract.payments.reduce(
          (sum, p) => sum + (Number(p.amountDue) - Number(p.amountPaid) + Number(p.lateFee)),
          0,
        );

        // Stage-specific messaging — template owns channel/category and
        // [BESTCHOICE FINANCE] prefix required by พ.ร.บ.การทวงถามหนี้ มาตรา 8.
        // Stage values map directly to template eventType:
        //   REMINDER → dunning.reminder
        //   NOTICE → dunning.notice
        //   FINAL_WARNING → dunning.final_warning
        //   LEGAL_ACTION → dunning.legal_action
        const eventType = `dunning.${esc.to.toLowerCase()}`;
        await this.notificationsService.sendFromTemplate(
          eventType,
          {
            name: contract.customer.name,
            amount: totalOverdue.toLocaleString(),
            contractNumber: esc.contractNumber,
            daysOverdue: String(esc.daysOverdue),
          },
          contract.customer.lineIdFinance,
          {
            relatedId: esc.contractId,
            customerId: contract.customerId,
            fallbackPhone: isSmsPaymentReminderDisabled()
              ? undefined
              : contract.customer.phone || undefined,
          },
        );
        notified++;
      } catch (err) {
        this.logger.warn(`Failed to send dunning notification for ${esc.contractNumber}: ${err}`);
      }
    }

    this.logger.log(`Dunning escalation complete: ${result.escalated.length} escalated, ${notified} notified`);
  }

  /**
   * Auto-send payment links 3 days before due (the body of handleAutoPaymentLinks).
   */
  async sendAutoPaymentLinks() {
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
          customer: { lineIdFinance: { not: null }, deletedAt: null },
        },
      },
      include: {
        contract: {
          include: {
            customer: { select: { name: true, lineIdFinance: true } },
          },
        },
      },
    });

    let sent = 0;
    for (const payment of payments) {
      const lineId = payment.contract.customer?.lineIdFinance;
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
          dueDate: formatDateShort(payment.dueDate),
          daysUntilDue: 3,
          paymentUrl: link.url,
        });

        await this.lineOaService.sendFlexMessage(lineId, flex, 'line-finance');
        sent++;
      } catch (err) {
        this.logger.warn(`Failed to send auto payment link for contract ${payment.contract.contractNumber}: ${err}`);
      }
    }

    this.logger.log(`Auto payment links complete: ${sent} sent out of ${payments.length} payments`);
  }
}
