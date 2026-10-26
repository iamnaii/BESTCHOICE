import { addCalendarDays, bkkCalendarDate } from '@installment/shared';
import { isTemplatesEnabled } from '../templates-flag.util';
import { RECURRING_BILL_PAGE_PATH } from './recurring-bill-notifier';
import { bkkMidnightOf } from './recurring-bills.service';

export const RECURRING_BILLS_ALERT_HORIZON_DAYS = 3;

export interface RecurringBillsAlert {
  type: 'recurring_bills_due';
  severity: 'warning' | 'critical';
  message: string;
  link: string;
  count: number;
}

type AlertPrisma = {
  systemConfig: { findFirst(args: never): Promise<{ value: string | null } | null> };
  recurringBillOccurrence: { findMany(args: never): Promise<Array<{ dueDate: Date }>> };
};

/**
 * การ์ดแดชบอร์ด (spec §8): งวด PENDING ที่ครบกำหนดภายใน 3 วัน (รวมที่เกินแล้ว)
 * ส้ม = ยังไม่มีเกิน · แดง = มีเกินกำหนด · count = ทั้งหมด · สวิตช์ `templates_enabled` ปิด = ไม่มีการ์ด
 * รับ prisma เป็นพารามิเตอร์ (ไม่ใช้ DI) ให้ DashboardOpsService เรียกได้โดยไม่ต้อง import โมดูล
 */
export async function computeRecurringBillsAlert(
  prisma: AlertPrisma,
  now: Date = new Date(),
  branchId?: string,
): Promise<RecurringBillsAlert | null> {
  if (!(await isTemplatesEnabled(prisma as never))) return null;
  const today = bkkCalendarDate(now);
  const horizon = bkkMidnightOf(addCalendarDays(today, RECURRING_BILLS_ALERT_HORIZON_DAYS));
  const rows = await prisma.recurringBillOccurrence.findMany({
    where: {
      status: 'PENDING',
      dueDate: { lte: horizon },
      ...(branchId ? { template: { branchId } } : {}),
    },
    select: { dueDate: true },
  } as never);
  if (rows.length === 0) return null;
  const todayMidnight = bkkMidnightOf(today).getTime();
  const overdue = rows.filter((r) => r.dueDate.getTime() < todayMidnight).length;
  const total = rows.length;
  return {
    type: 'recurring_bills_due',
    severity: overdue > 0 ? 'critical' : 'warning',
    message: `บิลประจำ ${total} รายการครบกำหนดใน ${RECURRING_BILLS_ALERT_HORIZON_DAYS} วัน${overdue > 0 ? ` · เกินกำหนด ${overdue}` : ''}`,
    link: RECURRING_BILL_PAGE_PATH,
    count: total,
  };
}
