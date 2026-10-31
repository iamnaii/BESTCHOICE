import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
  STATUS_NOTICE_IN_PLACE_OF_ESCALATION_SUBJECT,
  STATUS_NOTICE_SUBJECT,
  autoPayLinkPaymentWhere,
  botNoticeSentToday,
  findContractsDunnedToday,
  paymentNoticeSentToday,
} from '../payment-notice-dedupe';
import { NotificationsService } from '../notifications.service';
import { recordNoticeLog } from '../notice-log';
import { findContractsInLegacyLinkGrace, recordLegacyLinkGraceSkip } from '../legacy-link-grace';
import { isSmsPaymentReminderDisabled } from '../../../utils/sms-payment-reminder.util';
import { isWithinBusinessHours } from '../../../utils/business-hours.util';
import { bangkokStartOfDay } from '../../../utils/date.util';

/** เวลาส่งข้อความผลรอบกลางคืน (A3/A4) — ต้องอยู่ในช่วงเวลาทำการของ `isWithinBusinessHours` */
export const OVERNIGHT_COLLECTIONS_NOTICES_CRON = '5 8 * * *';

/** งวดที่ถึงกำหนดแล้วและยังค้าง — นิยามเดียวของ A3 (แจ้งสถานะ) และ A4 (ขั้นทวง) */
function dueUnpaidPaymentsWhere(now: Date): Prisma.PaymentWhereInput {
  return { status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] }, dueDate: { lt: now } };
}

/**
 * ยอดค้างที่ถึงกำหนดแล้ว (ค่างวดคงค้าง + ค่าปรับ) ของงวดจาก `dueUnpaidPaymentsWhere` — ≤ 0 = ไม่มีอะไรต้องทวง ·
 * ใช้ตัดสินทั้ง A3 และ A4 (รีวิวรอบ 3 I1: ลูกค้าที่จ่ายระหว่างคืนสัญญายังเป็น OVERDUE/DEFAULT เพราะไม่มีทางไหนคืนสถานะเป็น ACTIVE ⇒
 * ตัดสินจากสถานะสัญญาไม่ได้ ต้องดูยอดค้าง)
 */
function dueOutstanding(
  payments: { amountDue: Prisma.Decimal; amountPaid: Prisma.Decimal; lateFee: Prisma.Decimal }[],
): number {
  return payments.reduce(
    (sum, p) => sum + (Number(p.amountDue) - Number(p.amountPaid) + Number(p.lateFee)),
    0,
  );
}

/**
 * Collections-side LINE notification bodies extracted from the scheduler:
 * status-change overdue/default notices, dunning-stage notifications, and the
 * auto payment-link reminder. The owning @Cron handlers stay on SchedulerService
 * (decorated + try/catch + reportCronFailure shell); only the inner work lives here.
 *
 * Task 30 รอบ 3 — A3 (แจ้งสถานะ) และ A4 (ขั้นทวง) ไม่ส่งตอนกลางคืนแล้ว: รอบ 00:30 / 01:00 เปลี่ยนสถานะ/ขั้นทวงตามเดิม
 * แต่ข้อความออกจาก `sendOvernightCollectionsNotices` (08:05) ซึ่งอ่านผลของคืนนั้นจาก AuditLog ของรอบระบบ
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
   * Task 30 รอบ 3 — ข้อความผลรอบกลางคืนส่งตอนเช้า (`OVERNIGHT_COLLECTIONS_NOTICES_CRON`): รอบ 00:30 (ACTIVE→OVERDUE / →DEFAULT) และ 01:00
   * (เลื่อนขั้นทวง) เดิมส่ง Flex ทวงถึงลูกค้าทันทีกลางดึก ไม่ผ่านช่วงเวลาทำการ (พ.ร.บ.ทวงถามหนี้ · ด่านเดียวกับ dispatch `isWithinBusinessHours`).
   * รอบกลางคืนยังเปลี่ยนสถานะ/ขั้นตามเดิม (งานอื่นตอนดึกพึ่งสถานะนั้น) — ข้อความอ่านผลจาก AuditLog `STATUS_CHANGE` / `DUNNING_ESCALATION`
   * ของรอบระบบ (`ip_address = 'system-cron'`) ตั้งแต่เที่ยงคืนไทยวันนี้:
   * - ไม่อยู่ในเวลาทำการ (ใช้กรอบวันหยุด 08:00–18:00 ซึ่งแคบกว่า) = ไม่ส่ง
   * - สัญญาที่จ่ายแล้วระหว่างคืน (ไม่มียอดค้างที่ถึงกำหนดแล้ว — `dueOutstanding` นิยามเดียวของทั้งสองทาง) = ไม่แจ้งทั้งสถานะและขั้นทวง ·
   *   การจ่ายไม่คืนสถานะสัญญาเป็น ACTIVE (รีวิวรอบ 3 I1) · สัญญาที่ออกจาก OVERDUE/DEFAULT แล้ว (เช่น ยกเลิก/ยึดคืน) = ไม่แจ้งสถานะ
   * - สัญญาที่ได้ข้อความทวงระดับสัญญาแล้ววันนี้ (`findContractsDunnedToday` — SENT / คิวส่งซ้ำ ทุกช่องทาง) = ข้าม — สั่งรันซ้ำไม่ส่งซ้ำ และหนึ่งสัญญา
   *   ได้ไม่เกินหนึ่งข้อความจากแจ้งสถานะ/ขั้นทวง · A2 09:00 / บอททวง 10:00 เว้นงวดของสัญญาที่ได้ข้อความจากรอบนี้ (รอบ 4 I2)
   */
  async sendOvernightCollectionsNotices(now: Date = new Date()) {
    if (!isWithinBusinessHours(now, true)) {
      this.logger.warn('Overnight collections notices skipped — outside business hours');
      return { statusNotices: 0, dunningNotices: 0 };
    }
    const since = bangkokStartOfDay(now);
    const rows = await this.prisma.auditLog.findMany({
      where: {
        action: { in: ['STATUS_CHANGE', 'DUNNING_ESCALATION'] },
        entity: 'contract',
        ipAddress: 'system-cron',
        createdAt: { gte: since },
      },
      select: { action: true, entityId: true, newValue: true },
      orderBy: { createdAt: 'asc' },
    });
    const valueOf = (v: unknown) =>
      v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
    const statusIds = new Set<string>();
    const escalations = new Map<string, { to: string; daysOverdue: number }>();
    for (const row of rows) {
      const value = valueOf(row.newValue);
      if (row.action === 'STATUS_CHANGE' && (value.to === 'OVERDUE' || value.to === 'DEFAULT')) {
        statusIds.add(row.entityId);
      } else if (row.action === 'DUNNING_ESCALATION' && typeof value.dunningStage === 'string') {
        escalations.set(row.entityId, {
          to: value.dunningStage,
          daysOverdue: Number(value.daysOverdue ?? 0),
        });
      }
    }
    const contractIds = [...new Set([...statusIds, ...escalations.keys()])];
    if (contractIds.length === 0) return { statusNotices: 0, dunningNotices: 0 };

    const contracts = await this.prisma.contract.findMany({
      where: { id: { in: contractIds }, deletedAt: null },
      select: { id: true, contractNumber: true, status: true },
    });
    const byId = new Map(contracts.map((c) => [c.id, c]));
    // ข้อความทวงระดับสัญญาวันนี้ — นิยามเดียวกับที่ A2/บอททวงใช้เว้นให้ (`payment-notice-dedupe.ts` รอบ 4 I2) · นับคิวส่งซ้ำด้วย
    const dunnedToday = () => findContractsDunnedToday(this.prisma, contractIds, now);

    let skip = await dunnedToday();
    const statusTargets = [...statusIds].filter((id) => {
      const status = byId.get(id)?.status;
      return (status === 'OVERDUE' || status === 'DEFAULT') && !skip.has(id);
    });
    // สัญญาที่เลื่อนขั้นคืนเดียวกัน: แจ้งสถานะคือข้อความเดียวของสัญญา (ขั้นทวงถูกข้ามข้างล่าง) — แถวลงหัวข้อ "แทนข้อความขั้นทวง"
    // ให้เพดานความถี่นับเหมือนแถวขั้นทวงที่มันแทน (รอบ 4 m4)
    if (statusTargets.length > 0) {
      await this.notifyStatusChangedCustomers(
        statusTargets,
        new Set(statusTargets.filter((id) => escalations.has(id))),
      );
    }

    skip = await dunnedToday();
    const escalated = [...escalations.entries()]
      .filter(([id]) => byId.has(id) && !skip.has(id))
      .map(([id, e]) => ({
        contractId: id,
        contractNumber: byId.get(id)!.contractNumber,
        daysOverdue: e.daysOverdue,
        to: e.to,
      }));
    const dunning =
      escalated.length > 0
        ? await this.notifyEscalatedDunning({ escalated })
        : { escalated: 0, notified: 0, suppressed: 0 };
    return { statusNotices: statusTargets.length, dunningNotices: dunning.notified };
  }

  /**
   * Send LINE overdue/default notice to customers whose contracts just changed status
   *
   * @param inPlaceOfEscalation สัญญาที่แจ้งสถานะนี้ส่ง**แทน**ข้อความขั้นทวงของคืนเดียวกัน — แถว log ลงหัวข้อที่เพดานความถี่นับ ·
   *   สัญญาอื่นลง `STATUS_NOTICE_SUBJECT` ที่เพดานไม่นับ (เดิมแจ้งสถานะไม่ลงแถว — `FREQUENCY_CAP_EXEMPT_SUBJECTS` รอบ 4 m4)
   */
  async notifyStatusChangedCustomers(
    contractIds: string[],
    inPlaceOfEscalation: ReadonlySet<string> = new Set(),
  ) {
    const contracts = await this.prisma.contract.findMany({
      where: { id: { in: contractIds } },
      include: {
        customer: {
          select: { id: true, name: true, ...FINANCE_LINE_RECIPIENT_SELECT, phone: true },
        },
        payments: { where: dueUnpaidPaymentsWhere(new Date()), orderBy: { installmentNo: 'asc' } },
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

      const totalOverdue = dueOutstanding(contract.payments);
      // จ่ายแล้วระหว่างรอ (รอบเช้า — สัญญายังเป็น OVERDUE/DEFAULT) = ไม่มีอะไรต้องแจ้ง (รอบ 4 · รีวิวรอบ 3 I1)
      if (totalOverdue <= 0) continue;

      if (legacyGrace.has(contract.id)) {
        await recordLegacyLinkGraceSkip(this.prisma, {
          recipient: lineId,
          subject: STATUS_NOTICE_SUBJECT,
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
      } catch (err) {
        this.logger.warn(
          `Failed to notify customer for contract ${contract.contractNumber}: ${err}`,
        );
        continue;
      }
      sent++;
      // แถว SENT หมวด DUNNING — หลักฐานการส่ง + ให้รอบเช้าที่สั่งรันซ้ำไม่ส่งซ้ำ (Task 30 รอบ 3)
      await recordNoticeLog(
        this.prisma,
        {
          channel: 'LINE',
          channelKey: 'line-finance',
          recipient: lineId,
          subject: inPlaceOfEscalation.has(contract.id)
            ? STATUS_NOTICE_IN_PLACE_OF_ESCALATION_SUBJECT
            : STATUS_NOTICE_SUBJECT,
          message: `สัญญา ${contract.contractNumber} สถานะ ${contract.status}`,
          status: 'SENT',
          relatedId: contract.id,
          customerId: contract.customer.id,
          category: NotificationCategory.DUNNING,
          sentAt: new Date(),
        },
        this.logger,
      );
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
            payments: { where: dueUnpaidPaymentsWhere(now), orderBy: { installmentNo: 'asc' } },
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

        const totalOverdue = dueOutstanding(contract.payments);
        // จ่ายแล้วระหว่างรอ (รอบเช้า — Task 30 รอบ 3) = ไม่มีอะไรต้องทวง
        if (totalOverdue <= 0) continue;

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
