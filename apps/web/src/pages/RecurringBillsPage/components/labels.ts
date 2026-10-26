import { bkkCalendarDate, formatCalendarDateTh } from '@installment/shared';
import { formatNumberDecimal } from '@/utils/formatters';
import type { RecurringBillDocument, RecurringBillRow } from '@/hooks/useRecurringBills';

const THAI_MONTH_ABBR = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
export const THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const pad2 = (n: number) => String(n).padStart(2, '0');

/** "28 ต.ค. 69" — ตัวเดียวกับที่ข้อความ LINE/ชื่องานใช้ (shared) จึงอ่านตรงกันทุกช่องทาง */
export function fmtDateTh(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return formatCalendarDateTh(bkkCalendarDate(d));
}

export function monthTitle(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${THAI_MONTHS[m - 1] ?? month} ${y + 543}`;
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}

export function currentMonthKey(now = new Date()): string {
  const t = bkkCalendarDate(now);
  return `${t.year}-${pad2(t.month)}`;
}

export function todayKey(now = new Date()): string {
  const t = bkkCalendarDate(now);
  return `${t.year}-${pad2(t.month)}-${pad2(t.day)}`;
}

export function recurrenceLabel(row: Pick<RecurringBillRow, 'recurrence' | 'dueDate'>): string {
  switch (row.recurrence) {
    case 'MONTHLY':
      return 'รายเดือน';
    case 'QUARTERLY':
      return 'ราย 3 เดือน';
    case 'YEARLY':
      return `รายปี ทุก ${THAI_MONTH_ABBR[bkkCalendarDate(new Date(row.dueDate)).month - 1]}`;
    default:
      return 'ไม่มีรอบ';
  }
}

export const PENDING_FAMILY: ReadonlySet<RecurringBillRow['status']> = new Set(['PENDING', 'DUE_TODAY', 'OVERDUE']);

export function isLiveDocument(doc: RecurringBillDocument | null): doc is RecurringBillDocument {
  return !!doc && !doc.deletedAt && doc.status !== 'VOIDED';
}

/** ป้ายใต้เลขที่ใบ — ตามสถานะใบจริง (§15.2) */
export function docStatusLabel(row: RecurringBillRow): string {
  const doc = row.document;
  if (!doc) {
    if (row.status === 'UPCOMING') return 'ยังไม่มี';
    return PENDING_FAMILY.has(row.status) || row.status === 'PAID_UNPOSTED' ? 'ไม่มีร่าง' : '—';
  }
  if (doc.deletedAt) return 'ร่างถูกลบ';
  switch (doc.status) {
    case 'DRAFT':
      if (row.status === 'PAID_UNPOSTED') return 'ร่าง · รอลงบัญชี';
      if (row.status === 'SKIPPED') return 'ร่าง · ควรลบ';
      return 'ร่าง · ยังไม่โพสต์';
    case 'PENDING_APPROVAL':
      return 'รออนุมัติ';
    case 'APPROVED':
      return 'อนุมัติแล้ว · รอโพสต์';
    case 'ACCRUAL':
      return 'ตั้งหนี้แล้ว · ยังไม่จ่าย';
    case 'POSTED':
      return doc.paidAt ? `จ่ายแล้ว · ${formatNumberDecimal(doc.totalAmount ?? '0')}` : 'บันทึกแล้ว';
    case 'VOIDED':
      return 'ยกเลิกแล้ว';
    default:
      return doc.status;
  }
}

/** บรรทัดอธิบายใต้ป้ายสถานะ */
export function statusDetail(row: RecurringBillRow): string {
  const by = (name: string | null) => `บันทึกเองโดย ${name ?? '—'}${row.paidNote ? ` — "${row.paidNote}"` : ''}`;
  switch (row.status) {
    case 'PAID':
      return `${fmtDateTh(row.paidAt)} · ${row.paidById ? by(row.paidByName) : 'จากใบรายจ่าย'}`;
    case 'PAID_UNPOSTED':
      return `${fmtDateTh(row.paidAt)} · ${by(row.paidByName)}${isLiveDocument(row.document) ? ` · งาน: ลงบัญชีใบ ${row.document.number}` : ''}`;
    case 'OVERDUE':
      return 'เตือน LINE ทุกวัน · งาน HIGH ใน /todos';
    case 'DUE_TODAY':
      return 'เตือน LINE วันนี้ · งาน HIGH ใน /todos';
    case 'PENDING':
      return `${row.documentMissing ? 'ไม่มีร่าง' : 'สร้างร่างแล้ว'} · งาน MEDIUM ใน /todos`;
    case 'UPCOMING':
      return row.awaitingSystem ? 'รอระบบสร้างร่าง (รอบ 08:05 น.)' : `ระบบจะสร้างร่าง ${fmtDateTh(row.windowOpensOn)}`;
    case 'SKIPPED':
      return `โดย ${row.skippedByName ?? 'ระบบ'} ${fmtDateTh(row.skippedAt)}${row.skipReason ? ` — "${row.skipReason}"` : ''}`;
  }
}

export function dueDetail(row: RecurringBillRow): string {
  if (row.status === 'OVERDUE') return `เกิน ${row.daysOverdue} วัน`;
  if (row.status === 'DUE_TODAY') return 'วันนี้';
  if ((row.status === 'PENDING' || row.status === 'UPCOMING') && row.daysUntilDue > 0) return `อีก ${row.daysUntilDue} วัน`;
  return `ทุกวันที่ ${bkkCalendarDate(new Date(row.dueDate)).day}`;
}
