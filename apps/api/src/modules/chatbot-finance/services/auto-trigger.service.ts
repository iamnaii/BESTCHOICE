import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { LineFinanceClientService } from './line-finance-client.service';
import { ChatSessionService } from './chat-session.service';
import { TEMPLATES, ReminderPayload } from '../constants/reminder-templates';
import {
  AutoTriggerType,
  LineChannelType,
  MessageRole,
  Payment,
  TriggerStatus,
} from '@prisma/client';

const LATE_FEE_PER_DAY = 50;
const TIMEZONE = 'Asia/Bangkok';

interface PaymentWithLink {
  payment: Payment;
  customerId: string;
  customerName: string;
  lineUserId: string;
}

/**
 * Auto-Trigger Service — ส่ง reminders อัตโนมัติตาม cron schedule
 *
 * Cron jobs (Asia/Bangkok):
 *   09:00 ทุกวัน — scan + ส่ง T-5, T-3, T-1, T
 *   10:00 ทุกวัน — scan + ส่ง T+1, T+3 escalations
 *
 * Idempotency: ใช้ ChatAutoTrigger table เป็น marker
 *   - ก่อนส่ง: เช็คว่ามี trigger record (PENDING/SENT) สำหรับ payment+type นี้แล้วหรือยัง
 *   - หลังส่ง: mark SENT
 */
@Injectable()
export class AutoTriggerService {
  private readonly logger = new Logger(AutoTriggerService.name);

  constructor(
    private prisma: PrismaService,
    private lineClient: LineFinanceClientService,
    private sessions: ChatSessionService,
  ) {}

  // ─── Daily reminders 09:00 ─────────────────────────────────

  @Cron('0 9 * * *', { timeZone: TIMEZONE })
  async runDailyReminders(): Promise<void> {
    this.logger.log('[AutoTrigger] === Daily reminders 09:00 ===');
    await this.processOffset(5, AutoTriggerType.REMINDER_T_MINUS_5, TEMPLATES.T_MINUS_5);
    await this.processOffset(3, AutoTriggerType.REMINDER_T_MINUS_3, TEMPLATES.T_MINUS_3);
    await this.processOffset(1, AutoTriggerType.REMINDER_T_MINUS_1, TEMPLATES.T_MINUS_1);
    await this.processOffset(0, AutoTriggerType.REMINDER_T_DAY, TEMPLATES.T_DAY);
  }

  // ─── Daily escalations 10:00 ───────────────────────────────

  @Cron('0 10 * * *', { timeZone: TIMEZONE })
  async runDailyEscalations(): Promise<void> {
    this.logger.log('[AutoTrigger] === Daily escalations 10:00 ===');
    await this.processOffset(-1, AutoTriggerType.ESCALATION_T_PLUS_1, TEMPLATES.T_PLUS_1);
    await this.processOffset(-3, AutoTriggerType.ESCALATION_T_PLUS_3, TEMPLATES.T_PLUS_3);
  }

  // ─── Core logic ───────────────────────────────────────────

  /**
   * @param dayOffset วันที่ครบกำหนดเทียบกับวันนี้ (5 = อีก 5 วัน, -1 = เมื่อวาน)
   */
  private async processOffset(
    dayOffset: number,
    type: AutoTriggerType,
    template: (p: ReminderPayload) => string,
  ): Promise<void> {
    const targetDate = new Date();
    targetDate.setHours(0, 0, 0, 0);
    targetDate.setDate(targetDate.getDate() + dayOffset);
    const nextDay = new Date(targetDate);
    nextDay.setDate(nextDay.getDate() + 1);

    // หา payments ที่ครบกำหนดในวันนั้น + ยังไม่จ่าย
    const payments = await this.prisma.payment.findMany({
      where: {
        dueDate: { gte: targetDate, lt: nextDay },
        status: { in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] },
        deletedAt: null,
        contract: { deletedAt: null, status: { in: ['ACTIVE', 'OVERDUE', 'DEFAULT'] } },
      },
      include: {
        contract: {
          include: {
            customer: {
              select: {
                id: true,
                name: true,
                lineLinks: {
                  where: { channel: LineChannelType.FINANCE, unlinkedAt: null },
                  select: { lineUserId: true },
                },
              },
            },
          },
        },
      },
    });

    if (!payments.length) {
      this.logger.log(`[AutoTrigger] ${type}: 0 payments`);
      return;
    }

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const payment of payments) {
      const lineLink = payment.contract.customer.lineLinks[0];
      if (!lineLink) {
        skipped++;
        continue;
      }

      // Idempotency check
      const existing = await this.prisma.chatAutoTrigger.findFirst({
        where: {
          customerId: payment.contract.customerId,
          triggerType: type,
          payload: {
            path: ['paymentId'],
            equals: payment.id,
          },
        },
      });
      if (existing) {
        skipped++;
        continue;
      }

      const result = await this.sendReminder({
        payment,
        type,
        template,
        customerId: payment.contract.customerId,
        customerName: payment.contract.customer.name,
        lineUserId: lineLink.lineUserId,
        dayOffset,
      });

      if (result === 'sent') sent++;
      else if (result === 'failed') failed++;
    }

    this.logger.log(`[AutoTrigger] ${type}: sent=${sent} skipped=${skipped} failed=${failed}`);
  }

  private async sendReminder(args: {
    payment: Payment;
    type: AutoTriggerType;
    template: (p: ReminderPayload) => string;
    customerId: string;
    customerName: string;
    lineUserId: string;
    dayOffset: number;
  }): Promise<'sent' | 'failed'> {
    const amount = Number(args.payment.amountDue) - Number(args.payment.amountPaid);
    const daysOverdue = args.dayOffset < 0 ? Math.abs(args.dayOffset) : 0;
    const fineAmount = daysOverdue * LATE_FEE_PER_DAY;

    const payload: ReminderPayload = {
      customerName: args.customerName,
      amount,
      dueDate: this.formatThaiDate(args.payment.dueDate),
      installmentNumber: args.payment.installmentNo,
      daysOverdue,
      fineAmount,
      totalAmount: amount + fineAmount,
    };

    const text = args.template(payload);

    // สร้าง trigger record (PENDING ก่อน) — กัน duplicate concurrent runs
    const trigger = await this.prisma.chatAutoTrigger.create({
      data: {
        customerId: args.customerId,
        triggerType: args.type,
        scheduledFor: new Date(),
        status: TriggerStatus.PENDING,
        payload: {
          paymentId: args.payment.id,
          contractId: args.payment.contractId,
          installmentNo: args.payment.installmentNo,
          amount,
          dueDate: args.payment.dueDate.toISOString(),
        },
      },
    });

    try {
      await this.lineClient.pushText(args.lineUserId, text);

      // บันทึกใน ChatMessage (role=AUTO_TRIGGER)
      const session = await this.sessions.getOrCreate(args.lineUserId);
      const msg = await this.sessions.saveMessage({
        sessionId: session.id,
        role: MessageRole.AUTO_TRIGGER,
        text,
        intent: args.type,
      });

      await this.prisma.chatAutoTrigger.update({
        where: { id: trigger.id },
        data: {
          status: TriggerStatus.SENT,
          sentAt: new Date(),
          messageId: msg.id,
        },
      });

      return 'sent';
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[AutoTrigger] send failed for ${args.lineUserId}: ${errMsg}`);
      await this.prisma.chatAutoTrigger.update({
        where: { id: trigger.id },
        data: { status: TriggerStatus.FAILED, errorMessage: errMsg },
      });
      return 'failed';
    }
  }

  // ─── helpers ─────────────────────────────────────────────

  private formatThaiDate(date: Date): string {
    const months = [
      'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
      'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
    ];
    const day = date.getDate();
    const month = months[date.getMonth()];
    const year = date.getFullYear() + 543;
    return `${day} ${month} ${year}`;
  }
}
