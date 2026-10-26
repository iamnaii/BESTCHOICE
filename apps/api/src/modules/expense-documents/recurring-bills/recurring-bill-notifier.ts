import { Injectable, Logger } from '@nestjs/common';
import {
  RECURRING_BILL_NOTIFY_ROLES,
  formatCalendarDateTh,
  type CalendarDate,
} from '@installment/shared';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * ท่อแจ้งเตือนบิลประจำ (สเปก §7.4) — ก้อนนี้ประกอบข้อความ + หาผู้รับ แล้ว **บันทึก log เท่านั้น**
 * ก้อน 7 (A16 LINE แจ้งเตือนภายใน) เปลี่ยนเฉพาะ provider ของ `RECURRING_BILL_NOTIFIER` — ข้อความไม่เปลี่ยน
 */
export const RECURRING_BILL_NOTIFIER = 'RECURRING_BILL_NOTIFIER';
export const RECURRING_BILL_PAGE_PATH = '/expenses/recurring-bills';

export type RecurringBillEventKind = 'UPCOMING' | 'DUE_TODAY' | 'OVERDUE';

export interface RecurringBillEvent {
  kind: RecurringBillEventKind;
  occurrenceId: string;
  templateName: string;
  vendorName: string | null;
  branchName: string;
  dueDate: CalendarDate;
  /** > 0 = เกินกำหนดกี่วัน · 0 = วันนี้ · < 0 = อีกกี่วันถึงกำหนด */
  daysOverdue: number;
  /** ยอดประมาณเป็นสตริงทศนิยม (null = ไม่ทราบ) */
  amount: string | null;
  documentNumber: string | null;
  link: string;
}

export interface RecurringBillNotifier {
  notify(event: RecurringBillEvent): Promise<void>;
}

function formatAmount(amount: string | null): string {
  if (amount == null || amount === '' || Number.isNaN(Number(amount))) return 'ยอดประมาณ —';
  return `ยอดประมาณ ${Number(amount).toLocaleString('en-US', { maximumFractionDigits: 2 })} บาท`;
}

/** ข้อความ 5 บรรทัด ภาษาไทย ไม่มีอีโมจิ (กระดาน 2 ของ mockup) */
export function buildRecurringBillMessage(e: RecurringBillEvent): string {
  const head =
    e.kind === 'OVERDUE'
      ? `เกินกำหนด ${e.daysOverdue} วัน`
      : e.kind === 'DUE_TODAY'
        ? 'ครบกำหนดวันนี้'
        : `ครบกำหนดใน ${Math.max(0, -e.daysOverdue)} วัน`;
  const docLine = e.documentNumber ? `ร่างใบรายจ่าย ${e.documentNumber} รอจ่าย` : 'ยังไม่มีร่างใบรายจ่าย';
  return [
    `[บิลประจำ] ${head}`,
    `${e.templateName} (${e.branchName})`,
    `ครบกำหนด ${formatCalendarDateTh(e.dueDate)} · ${formatAmount(e.amount)}`,
    docLine,
    `เปิดหน้าบิลประจำ: ${e.link}`,
  ].join('\n');
}

@Injectable()
export class LoggingRecurringBillNotifier implements RecurringBillNotifier {
  private readonly logger = new Logger(LoggingRecurringBillNotifier.name);

  constructor(private readonly prisma: PrismaService) {}

  /** OWNER + ACCOUNTANT ทุกสาขา ที่ยังใช้งาน และไม่ใช่ผู้ใช้ระบบ (ผู้ใช้ระบบมี role OWNER — ต้องกัน) */
  async resolveRecipients(): Promise<Array<{ id: string; email: string }>> {
    return this.prisma.user.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        isSystemUser: false,
        role: { in: [...RECURRING_BILL_NOTIFY_ROLES] },
      },
      select: { id: true, email: true },
    });
  }

  async notify(event: RecurringBillEvent): Promise<void> {
    const recipients = await this.resolveRecipients();
    const message = buildRecurringBillMessage(event);
    this.logger.log(
      `[stub — ยังไม่ส่งจริง] ${event.kind} งวด ${event.occurrenceId} → ${recipients.length} ผู้รับ · ${message.split('\n')[0]} ${event.templateName}`,
    );
  }
}
