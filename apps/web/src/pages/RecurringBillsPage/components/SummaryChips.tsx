import type { RecurringBillViewStatus } from '@installment/shared';
import type { RecurringBillSummary } from '@/hooks/useRecurringBills';
import { formatNumberDecimal } from '@/utils/formatters';
import { STATUS_META } from './StatusBadge';

const CHIPS: Array<{ key: Exclude<keyof RecurringBillSummary, 'amountRemaining'>; status: RecurringBillViewStatus }> = [
  { key: 'pending', status: 'PENDING' },
  { key: 'upcoming', status: 'UPCOMING' },
  { key: 'dueToday', status: 'DUE_TODAY' },
  { key: 'overdue', status: 'OVERDUE' },
  { key: 'paid', status: 'PAID' },
  { key: 'paidUnposted', status: 'PAID_UNPOSTED' },
  { key: 'skipped', status: 'SKIPPED' },
];

export function SummaryChips({ summary }: { summary: RecurringBillSummary }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {CHIPS.map((c) => (
        <span key={c.key} data-testid={`chip-${c.key}`} className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${STATUS_META[c.status].className}`}>
          {STATUS_META[c.status].label} <b className="font-semibold tabular-nums">{summary[c.key]}</b>
        </span>
      ))}
      <span data-testid="amount-remaining" className="ml-auto text-sm text-muted-foreground">
        ยังต้องจ่ายเดือนนี้ (ประมาณ) <b className="font-semibold tabular-nums text-foreground">{formatNumberDecimal(summary.amountRemaining)}</b> บาท
      </span>
    </div>
  );
}
