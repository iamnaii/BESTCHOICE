import { Logger } from '@nestjs/common';
import { formatDateShort } from '../../../utils/thai-date.util';
import { isSmsPaymentReminderDisabled } from '../../../utils/sms-payment-reminder.util';
import { PrismaService } from '../../../prisma/prisma.service';
import { FlexTemplatesService } from '../../line-oa/flex-templates.service';
import { QuickReplyService } from '../../line-oa/quick-reply.service';
import { NotificationCategory } from '../notification-category.enum';
import { NotificationTransportService } from './notification-transport.service';
import { NotificationDispatchService } from './notification-dispatch.service';

/**
 * Cron-driven dunning lifecycle — payment reminders (upcoming due dates),
 * overdue notices (past-due), manager/owner escalation summaries. Owns the
 * shared per-payment dedup guard (`alreadyNotifiedToday`) and the PDPA-consent
 * gate (`ensurePdpaConsentOrLogSkip`).
 *
 * Plain class (not @Injectable) — constructed internally by NotificationsService.
 */
export class NotificationReminderService {
  private readonly logger = new Logger(NotificationReminderService.name);

  constructor(
    private prisma: PrismaService,
    private dispatch: NotificationDispatchService,
    private transport: NotificationTransportService,
    private flexTemplates: FlexTemplatesService,
    private quickReplyService: QuickReplyService,
  ) {}

  /**
   * Send payment reminders for upcoming due dates (run daily)
   * Sends reminders exactly 3 days and 1 day before due date
   */
  /**
   * True when a notice with this subject was already logged for this payment
   * today — the per-payment dedup guard shared by the reminder + overdue crons.
   */
  private async alreadyNotifiedToday(
    paymentId: string,
    subject: string,
    today: Date,
  ): Promise<boolean> {
    const prev = await this.prisma.notificationLog.findFirst({
      where: { relatedId: paymentId, subject, sentAt: { gte: today } },
    });
    return !!prev;
  }

  /**
   * PDPA gate shared by the reminder + overdue crons: returns true when the
   * customer has GRANTED consent. Otherwise logs an IN_APP SKIPPED row (so the
   * skip stays auditable) and returns false.
   */
  private async ensurePdpaConsentOrLogSkip(
    customerId: string,
    paymentId: string,
    subject: string,
  ): Promise<boolean> {
    const consent = await this.prisma.pDPAConsent.findFirst({
      where: { customerId, status: 'GRANTED', deletedAt: null },
      select: { id: true },
    });
    if (consent) return true;
    await this.prisma.notificationLog.create({
      data: {
        channel: 'IN_APP',
        recipient: customerId,
        subject,
        message: `ข้ามการแจ้งเตือน — ลูกค้าไม่มี PDPA consent`,
        status: 'SKIPPED',
        relatedId: paymentId,
      },
    });
    return false;
  }

  async sendPaymentReminders() {
    const now = new Date();
    const today = new Date(now.toISOString().split('T')[0]);

    // Fetch payments due in exactly 0 (today), 1, or 3 days (filter at DB level)
    const day0End = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    const day1 = new Date(today.getTime() + 1 * 24 * 60 * 60 * 1000);
    const day1End = new Date(day1.getTime() + 24 * 60 * 60 * 1000);
    const day3 = new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000);
    const day3End = new Date(day3.getTime() + 24 * 60 * 60 * 1000);

    const upcomingPayments = await this.prisma.payment.findMany({
      where: {
        status: 'PENDING',
        OR: [
          { dueDate: { gte: today, lt: day0End } },
          { dueDate: { gte: day1, lt: day1End } },
          { dueDate: { gte: day3, lt: day3End } },
        ],
        contract: { status: 'ACTIVE', deletedAt: null },
      },
      include: {
        contract: {
          include: {
            customer: { select: { id: true, name: true, phone: true, lineIdFinance: true } },
            _count: { select: { payments: true } },
          },
        },
      },
    });

    let sent = 0;
    for (const payment of upcomingPayments) {
      const customer = payment.contract.customer;
      const daysUntil = Math.max(
        0,
        Math.round((new Date(payment.dueDate).getTime() - today.getTime()) / (1000 * 60 * 60 * 24)),
      );

      // Dedup + PDPA guards (shared with sendOverdueNotices)
      if (await this.alreadyNotifiedToday(payment.id, 'แจ้งเตือนค่างวด', today)) continue;
      if (!(await this.ensurePdpaConsentOrLogSkip(customer.id, payment.id, 'แจ้งเตือนค่างวด'))) {
        continue;
      }

      // SMS branch + flex-fallback fallback uses the same plain-text body
      const smsMessage = `สวัสดีค่ะ คุณ${customer.name}\nแจ้งเตือน: ค่างวดที่ ${payment.installmentNo} สัญญา ${payment.contract.contractNumber}\nจำนวน ${Number(payment.amountDue).toLocaleString()} บาท\nครบกำหนดชำระ${daysUntil === 0 ? 'วันนี้' : `อีก ${daysUntil} วัน`} (${formatDateShort(payment.dueDate)})\nกรุณาชำระตามกำหนด ขอบคุณค่ะ`;

      // Try LINE Flex Message first, fallback to template, then SMS
      if (customer.lineIdFinance) {
        try {
          const flex = this.flexTemplates.paymentReminder({
            contractNumber: payment.contract.contractNumber,
            installmentNo: payment.installmentNo,
            amount: Number(payment.amountDue),
            dueDate: formatDateShort(payment.dueDate),
          });
          // Attach Quick Reply so customer can pay quickly or see balance
          flex.quickReply = { items: this.quickReplyService.afterPayment() };
          await this.transport.sendLineFlexMessage(customer.lineIdFinance, flex, 'line-finance');
          await this.prisma.notificationLog.create({
            data: {
              channel: 'LINE',
              channelKey: 'line-finance',
              recipient: customer.lineIdFinance,
              subject: 'แจ้งเตือนค่างวด',
              message: `งวด ${payment.installmentNo} จำนวน ${Number(payment.amountDue).toLocaleString()} บาท อีก ${daysUntil} วัน`,
              status: 'SENT',
              relatedId: payment.id,
              sentAt: new Date(),
            },
          });
          sent++;
        } catch (err) {
          this.logger.warn(`Flex message failed, falling back to template text: ${err instanceof Error ? err.message : err}`);
          // Pick template by daysUntil. Fall back to legacy inline send for
          // day-0 (no dedicated template exists for "due today").
          const eventType =
            daysUntil === 3
              ? 'payment.due_in_3_days'
              : daysUntil === 1
                ? 'payment.due_in_1_day'
                : null;
          if (eventType) {
            await this.dispatch.sendFromTemplate(
              eventType,
              {
                name: customer.name,
                amount: Number(payment.amountDue).toLocaleString(),
                installmentNo: String(payment.installmentNo),
                dueDate: formatDateShort(payment.dueDate),
              },
              customer.lineIdFinance,
              {
                relatedId: payment.id,
                customerId: customer.id,
              },
            );
          } else {
            // Day-0 (due today) — preserve legacy text path
            await this.dispatch.send({
              channel: 'LINE',
              channelKey: 'line-finance',
              recipient: customer.lineIdFinance,
              message: smsMessage,
              relatedId: payment.id,
              fallbackPhone: isSmsPaymentReminderDisabled() ? undefined : (customer.phone || undefined),
              customerId: customer.id,
              category: NotificationCategory.REMINDER,
            });
          }
          sent++;
        }
      } else if (customer.phone) {
        if (isSmsPaymentReminderDisabled()) {
          this.logger.warn(`[SMS-REMINDER-OFF] Skipping payment reminder SMS for payment ${payment.id}`);
        } else {
          // SMS branch — template is LINE-only so keep raw send()
          await this.dispatch.send({
            channel: 'SMS',
            recipient: customer.phone,
            message: smsMessage,
            relatedId: payment.id,
            customerId: customer.id,
            category: NotificationCategory.REMINDER,
          });
          sent++;
        }
      }
    }

    this.logger.log(`Payment reminders sent: ${sent}/${upcomingPayments.length}`);
    return { sent, total: upcomingPayments.length, timestamp: now };
  }

  /**
   * Send overdue notices (run daily)
   * Sends notices exactly 1, 3, and 7 days after due date
   */
  async sendOverdueNotices() {
    const now = new Date();
    const today = new Date(now.toISOString().split('T')[0]);

    // Only fetch payments overdue by exactly 1, 3, or 7 days (filter at DB level)
    const dueDates = [1, 3, 7].map((days) => {
      const start = new Date(today.getTime() - days * 24 * 60 * 60 * 1000);
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
      return { gte: start, lt: end };
    });

    const overduePayments = await this.prisma.payment.findMany({
      where: {
        status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] },
        OR: dueDates.map((dueDate) => ({ dueDate })),
        contract: { status: { in: ['ACTIVE', 'OVERDUE'] }, deletedAt: null },
      },
      include: {
        contract: {
          include: {
            customer: { select: { id: true, name: true, phone: true, lineIdFinance: true } },
            _count: { select: { payments: true } },
          },
        },
      },
    });

    let sent = 0;
    for (const payment of overduePayments) {
      const customer = payment.contract.customer;
      const daysOverdue = Math.floor(
        (now.getTime() - new Date(payment.dueDate).getTime()) / (1000 * 60 * 60 * 24),
      );

      // Dedup + PDPA guards (shared with sendPaymentReminders)
      if (await this.alreadyNotifiedToday(payment.id, 'แจ้งค้างชำระ', today)) continue;
      if (!(await this.ensurePdpaConsentOrLogSkip(customer.id, payment.id, 'แจ้งค้างชำระ'))) {
        continue;
      }

      const outstanding = Number(payment.amountDue) - Number(payment.amountPaid) + Number(payment.lateFee);
      // SMS branch + flex-fallback fallback uses the same plain-text body
      const smsMessage = `แจ้งเตือน: คุณ${customer.name}\nค่างวดที่ ${payment.installmentNo} สัญญา ${payment.contract.contractNumber}\nเลยกำหนดชำระ ${daysOverdue} วัน\nยอดค้างชำระ ${outstanding.toLocaleString()} บาท (รวมค่าปรับ)\nกรุณาชำระโดยเร็ว`;

      // Try LINE Flex Message first, fallback to template, then SMS
      if (customer.lineIdFinance) {
        try {
          const flex = this.flexTemplates.overdueNotice({
            contractNumber: payment.contract.contractNumber,
            overdueInstallments: daysOverdue,
            totalAmount: outstanding,
            lateFee: Number(payment.lateFee),
          });
          // Attach Quick Reply so customer can pay immediately or see balance
          flex.quickReply = { items: this.quickReplyService.afterPayment() };
          await this.transport.sendLineFlexMessage(customer.lineIdFinance, flex, 'line-finance');
          await this.prisma.notificationLog.create({
            data: {
              channel: 'LINE',
              channelKey: 'line-finance',
              recipient: customer.lineIdFinance,
              subject: 'แจ้งค้างชำระ',
              message: `งวด ${payment.installmentNo} ค้าง ${outstanding.toLocaleString()} บาท เลยกำหนด ${daysOverdue} วัน`,
              status: 'SENT',
              relatedId: payment.id,
              sentAt: new Date(),
            },
          });
          sent++;
        } catch (err) {
          this.logger.warn(`Flex message failed, falling back to template text: ${err instanceof Error ? err.message : err}`);
          // Pick template by daysOverdue (1, 3, or 7) — the cron only fetches
          // payments at exactly those offsets so other values shouldn't occur,
          // but fall back defensively to the day-1 template if so.
          const eventType =
            daysOverdue >= 7
              ? 'payment.overdue_day_7'
              : daysOverdue >= 3
                ? 'payment.overdue_day_3'
                : 'payment.overdue_day_1';
          await this.dispatch.sendFromTemplate(
            eventType,
            {
              name: customer.name,
              amount: outstanding.toLocaleString(),
              installmentNo: String(payment.installmentNo),
              contractNumber: payment.contract.contractNumber,
            },
            customer.lineIdFinance,
            {
              relatedId: payment.id,
              customerId: customer.id,
            },
          );
          sent++;
        }
      } else if (customer.phone) {
        if (isSmsPaymentReminderDisabled()) {
          this.logger.warn(`[SMS-REMINDER-OFF] Skipping overdue notice SMS for payment ${payment.id}`);
        } else {
          // SMS branch — template is LINE-only so keep raw send()
          await this.dispatch.send({
            channel: 'SMS',
            recipient: customer.phone,
            message: smsMessage,
            relatedId: payment.id,
            customerId: customer.id,
            category: NotificationCategory.DUNNING,
          });
          sent++;
        }
      }
    }

    this.logger.log(`Overdue notices sent: ${sent}/${overduePayments.length}`);
    return { sent, total: overduePayments.length, timestamp: now };
  }

  /**
   * Notify managers about overdue contracts (run daily)
   */
  async notifyManagersOverdue() {
    const overdueContracts = await this.prisma.contract.findMany({
      where: {
        status: 'OVERDUE',
        deletedAt: null,
      },
      include: {
        customer: { select: { name: true } },
        branch: {
          select: {
            id: true,
            name: true,
            users: {
              where: { role: 'BRANCH_MANAGER', isActive: true },
              select: { name: true, email: true },
            },
          },
        },
      },
    });

    let sent = 0;
    // Group by branch to send one summary per manager
    const branchGroups = new Map<string, { manager: { name: string; email: string }; contracts: string[] }>();
    for (const contract of overdueContracts) {
      for (const manager of contract.branch.users) {
        const key = manager.email;
        if (!branchGroups.has(key)) {
          branchGroups.set(key, { manager, contracts: [] });
        }
        branchGroups.get(key)!.contracts.push(
          `${contract.contractNumber}: ${contract.customer.name}`,
        );
      }
    }

    for (const [, { manager, contracts }] of branchGroups) {
      await this.dispatch.send({
        channel: 'IN_APP',
        recipient: manager.email,
        subject: `สัญญาค้างชำระ ${contracts.length} รายการ`,
        message: `สัญญาค้างชำระที่ต้องติดตาม:\n${contracts.map((c) => `- ${c}`).join('\n')}`,
        category: NotificationCategory.STAFF,
      });
      sent++;
    }

    return { sent, contracts: overdueContracts.length };
  }

  /**
   * Notify owner about defaulted contracts (run daily)
   */
  async notifyOwnerDefault() {
    const defaultContracts = await this.prisma.contract.findMany({
      where: { status: 'DEFAULT', deletedAt: null },
      include: {
        customer: { select: { name: true } },
        branch: { select: { name: true } },
      },
    });

    const owners = await this.prisma.user.findMany({
      where: { role: 'OWNER', isActive: true },
      select: { email: true, name: true },
    });

    let sent = 0;
    for (const owner of owners) {
      if (defaultContracts.length > 0) {
        const contractList = defaultContracts
          .map((c) => `- ${c.contractNumber}: ${c.customer.name} (${c.branch.name})`)
          .join('\n');

        await this.dispatch.send({
          channel: 'IN_APP',
          recipient: owner.email,
          subject: `สัญญา DEFAULT ${defaultContracts.length} รายการ`,
          message: `สัญญาที่อยู่ในสถานะ DEFAULT:\n${contractList}`,
          category: NotificationCategory.STAFF,
        });
        sent++;
      }
    }

    return { sent, contracts: defaultContracts.length };
  }
}
