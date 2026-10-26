import {
  bkkCalendarDate,
  calendarDayDiff,
  type CalendarDate,
  type RecurringBillViewStatus,
} from '@installment/shared';
import { isExpenseDocumentPaid, type PaidCheckDocument } from './recurring-bill-paid.util';

export interface OccurrenceForView {
  status: string;
  paidById: string | null;
  dueDate: Date;
}

/** สถานะที่หน้าจอเห็น — คำนวณตอนอ่านจากแถวงวด + ใบที่ผูก + วันไทย (สเปก §8/§15.2) */
export function viewStatusOf(
  occ: OccurrenceForView,
  doc: PaidCheckDocument | null | undefined,
  today: CalendarDate,
): RecurringBillViewStatus {
  if (occ.status === 'SKIPPED') return 'SKIPPED';
  if (occ.status === 'PAID') {
    return occ.paidById && !isExpenseDocumentPaid(doc) ? 'PAID_UNPOSTED' : 'PAID';
  }
  const diff = calendarDayDiff(bkkCalendarDate(occ.dueDate), today);
  if (diff === 0) return 'DUE_TODAY';
  if (diff > 0) return 'OVERDUE';
  return 'PENDING';
}
