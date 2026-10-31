import { Logger } from '@nestjs/common';
import { formatDateShort } from '../../../utils/thai-date.util';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  FINANCE_LINE_RECIPIENT_SELECT,
  financeLineRecipient,
} from '../../line-oa/services/otp-verified-customer';
import { LineOaService } from '../../line-oa/line-oa.service';
import { PaymentLinkService } from '../../line-oa/payment-links/payment-link.service';
import { buildOverdueNoticeFlex } from '../../line-oa/flex-messages/overdue-notice.flex';
import { buildPaymentReminderFlex } from '../../line-oa/flex-messages/payment-reminder.flex';
import { PDPAService } from '../../pdpa/pdpa.service';
import { NotificationCategory } from '../notification-category.enum';
import {
  AUTO_PAY_LINK_DAYS_BEFORE_DUE,
  AUTO_PAY_LINK_SUBJECT,
  autoPayLinkPaymentWhere,
  botNoticeSentToday,
  paymentNoticeSentToday,
} from '../payment-notice-dedupe';
import { NotificationsService } from '../notifications.service';
import { recordNoticeLog } from '../notice-log';
import { findContractsInLegacyLinkGrace, recordLegacyLinkGraceSkip } from '../legacy-link-grace';
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
        customer: {
          select: { id: true, name: true, ...FINANCE_LINE_RECIPIENT_SELECT, phone: true },
        },
        payments: {
          where: {
            status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] },
            dueDate: { lt: new Date() },
          },
          orderBy: { installmentNo: 'asc' },
        },
      },
    });

    // Task 30 ข้อ 2 — สัญญานำเข้าที่ลูกค้าผูก LINE ยังไม่ครบ 7 วัน: ไม่แจ้งสถานะค้างชำระทาง LINE
    const legacyGrace = await findContractsInLegacyLinkGrace(
      this.prisma,
      contracts.map((c) => c.id),
    );

    let sent = 0;
    for (const contract of contracts) {
      // ปลายทาง = แถว OTP ของลูกค้า (Task 22 I-1 ง) ไม่ใช่คอลัมน์ line_id_finance
      const lineId = financeLineRecipient(contract.customer);
      if (!lineId) continue;

      if (legacyGrace.has(contract.id)) {
        await recordLegacyLinkGraceSkip(this.prisma, {
          recipient: lineId,
          subject: 'แจ้งสถานะสัญญาค้างชำระ',
          message: `สัญญา ${contract.contractNumber} เปลี่ยนสถานะ — ระงับช่วงผ่อนผันหลังผูก LINE`,
          relatedId: contract.id,
          customerId: contract.customer.id,
        });
        continue;
      }

      // Check PDPA consent before sending
      if (contract.customer?.id) {
        const hasConsent = await this.pdpaService.hasActiveConsent(contract.customer.id);
        if (!hasConsent) {
          this.logger.debug(
            `PDPA: skipping status notification for customer ${contract.customer.id}`,
          );
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
        this.logger.warn(
          `Failed to notify customer for contract ${contract.contractNumber}: ${err}`,
        );
      }
    }

    this.logger.log(
      `Status change LINE notifications: ${sent} sent out of ${contracts.length} contracts`,
    );
  }

  /**
   * Send stage-specific LINE notifications for the contracts escalated by
   * overdueService.escalateDunningStages (the escalation mutation stays on the
   * facade; this is the downstream notify loop body).
   */
  async notifyEscalatedDunning(result: {
    escalated: {
      contractId: string;
      contractNumber: string;
      daysOverdue: number;
      to: string;
    }[];
  }) {
    // Batch-fetch all escalated contracts to avoid N+1 queries
    const escalatedIds = result.escalated.map((e) => e.contractId);
    const now = new Date();
    const contractsById = new Map(
      (
        await this.prisma.contract.findMany({
          where: { id: { in: escalatedIds } },
          include: {
            customer: { select: { name: true, ...FINANCE_LINE_RECIPIENT_SELECT, phone: true } },
            payments: {
              where: {
                status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] },
                dueDate: { lt: now },
              },
              orderBy: { installmentNo: 'asc' },
            },
          },
        })
      ).map((c) => [c.id, c]),
    );

    // Send stage-specific LINE notifications
    let notified = 0;
    // ถูกระงับ (BLOCKED — ช่วงผ่อนผันหลังผูก LINE ของสัญญานำเข้า / template ปิด) ไม่นับเป็นแจ้งแล้ว (Task 30 รอบ 2 ข้อ 5)
    let suppressed = 0;
    for (const esc of result.escalated) {
      try {
        const contract = contractsById.get(esc.contractId);
        const lineId = financeLineRecipient(contract?.customer);
        if (!contract || !lineId) continue;

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
        const sendResult = await this.notificationsService.sendFromTemplate(
          eventType,
          {
            name: contract.customer.name,
            amount: totalOverdue.toLocaleString(),
            contractNumber: esc.contractNumber,
            daysOverdue: String(esc.daysOverdue),
          },
          lineId,
          {
            relatedId: esc.contractId,
            customerId: contract.customerId,
            fallbackPhone: isSmsPaymentReminderDisabled()
              ? undefined
              : contract.customer.phone || undefined,
          },
        );
        if (sendResult.status === 'BLOCKED') suppressed++;
        else notified++;
      } catch (err) {
        this.logger.warn(`Failed to send dunning notification for ${esc.contractNumber}: ${err}`);
      }
    }

    this.logger.log(
      `Dunning escalation complete: ${result.escalated.length} escalated, ${notified} notified, ${suppressed} suppressed`,
    );
    return { escalated: result.escalated.length, notified, suppressed };
  }

  /**
   * Auto-send payment links 3 days before due (the body of handleAutoPaymentLinks · 08:30).
   *
   * Task 30 รอบ 2 ข้อ 1 — วัน T-3 การ์ดนี้เป็นข้อความเดียวของงวด: ค้นงวดด้วย `autoPayLinkPaymentWhere` (เงื่อนไขเดียวกับที่ A1 08:00 ใช้เว้นให้) ·
   * งวดที่ได้ข้อความเตือนวันนี้แล้ว (บอทสั่งรันก่อน / สั่งรันซ้ำ) = ข้าม · ส่งแล้วลงแถว SENT หมวด REMINDER (บอท 09:00 / A1 ที่สั่งรันซ้ำเห็น) ·
   * ส่งไม่ผ่านลงแถว FAILED (บอท 09:00 ส่งเตือนแทน · A1 ที่สั่งรันซ้ำเลิกเว้น) — `payment-notice-dedupe.ts`
   */
  async sendAutoPaymentLinks(now: Date = new Date()) {
    const payments = await this.prisma.payment.findMany({
      where: autoPayLinkPaymentWhere(now),
      include: {
        contract: {
          include: {
            customer: { select: { id: true, name: true, ...FINANCE_LINE_RECIPIENT_SELECT } },
          },
        },
      },
    });

    let sent = 0;
    let alreadyReminded = 0;
    for (const payment of payments) {
      const lineId = financeLineRecipient(payment.contract.customer);
      if (!lineId) continue;
      const customerId = payment.contract.customer.id;

      if (
        (await paymentNoticeSentToday(this.prisma, 'REMINDER', payment.id, now)) ||
        (await botNoticeSentToday(this.prisma, 'REMINDER', customerId, payment.id, now))
      ) {
        alreadyReminded++;
        continue;
      }

      const amountDue =
        Number(payment.amountDue) + Number(payment.lateFee) - Number(payment.amountPaid);
      // แถวหลักฐาน — ไม่เก็บ URL ลิงก์ชำระ (โทเคนในลิงก์ใช้จ่ายได้)
      const logRow = {
        channel: 'LINE' as const,
        channelKey: 'line-finance',
        recipient: lineId,
        subject: AUTO_PAY_LINK_SUBJECT,
        message: `งวด ${payment.installmentNo} สัญญา ${payment.contract.contractNumber} ยอด ${amountDue.toLocaleString()} บาท — การ์ดลิงก์ชำระ`,
        relatedId: payment.id,
        customerId,
        category: NotificationCategory.REMINDER,
      };

      try {
        // Create payment link
        const link = await this.paymentLinkService.createPaymentLink(
          payment.contractId,
          payment.installmentNo,
        );

        // Send LINE reminder with payment link
        const flex = buildPaymentReminderFlex({
          customerName: payment.contract.customer?.name || '-',
          contractNumber: payment.contract.contractNumber,
          installmentNo: payment.installmentNo,
          totalInstallments: payment.contract.totalMonths,
          amountDue,
          dueDate: formatDateShort(payment.dueDate),
          daysUntilDue: AUTO_PAY_LINK_DAYS_BEFORE_DUE,
          paymentUrl: link.url,
        });

        await this.lineOaService.sendFlexMessage(lineId, flex, 'line-finance');
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Failed to send auto payment link for contract ${payment.contract.contractNumber}: ${errorMsg}`,
        );
        await recordNoticeLog(
          this.prisma,
          {
            ...logRow,
            status: 'FAILED',
            errorMsg,
            sentAt: null,
          },
          this.logger,
        );
        continue;
      }
      sent++;
      await recordNoticeLog(
        this.prisma,
        { ...logRow, status: 'SENT', sentAt: new Date() },
        this.logger,
      );
    }

    this.logger.log(
      `Auto payment links complete: ${sent} sent out of ${payments.length} payments (already reminded today: ${alreadyReminded})`,
    );
  }
}
