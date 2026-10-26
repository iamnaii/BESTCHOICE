import type { LucideIcon } from 'lucide-react';
import { CalendarClock, CircleCheck, Clock, FileText, Hourglass, SkipForward, TriangleAlert } from 'lucide-react';
import type { RecurringBillViewStatus } from '@installment/shared';
import type { RecurringBillRow } from '@/hooks/useRecurringBills';

/** ป้าย+ไอคอน+สี ตาม mockup กระดาน 1 — โทเคนจาก index.css เท่านั้น */
export const STATUS_META: Record<RecurringBillViewStatus, { label: string; icon: LucideIcon; className: string }> = {
  UPCOMING: { label: 'รอถึงรอบ', icon: Clock, className: 'bg-muted text-muted-foreground border-border' },
  PENDING: { label: 'รอจ่าย', icon: Hourglass, className: 'bg-primary/10 text-primary border-primary/20' },
  DUE_TODAY: { label: 'ครบกำหนดวันนี้', icon: CalendarClock, className: 'bg-warning/10 text-warning-strong border-warning/30' },
  OVERDUE: { label: 'เกินกำหนด', icon: TriangleAlert, className: 'bg-destructive/10 text-destructive border-destructive/20' },
  PAID: { label: 'จ่ายแล้ว', icon: CircleCheck, className: 'bg-success/10 text-success border-success/20' },
  PAID_UNPOSTED: { label: 'จ่ายแล้ว · ยังไม่ลงบัญชี', icon: FileText, className: 'bg-warning/10 text-warning-strong border-warning/30' },
  SKIPPED: { label: 'ข้ามงวดนี้', icon: SkipForward, className: 'bg-muted text-muted-foreground border-border' },
};

export function statusLabel(row: Pick<RecurringBillRow, 'status' | 'daysOverdue'>): string {
  return row.status === 'OVERDUE' ? `เกินกำหนด ${row.daysOverdue} วัน` : STATUS_META[row.status].label;
}

export function StatusBadge({ row }: { row: RecurringBillRow }) {
  const meta = STATUS_META[row.status];
  const Icon = meta.icon;
  return (
    <span data-testid="bill-status" className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${meta.className}`}>
      <Icon className="size-3.5" aria-hidden="true" />
      {statusLabel(row)}
    </span>
  );
}
