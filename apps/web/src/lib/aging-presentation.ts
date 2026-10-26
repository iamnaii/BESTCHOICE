/** Ledger aging counts days past the due date, not the age of an active contract.
 * Both the dashboard widget and full report consume /expenses/ledger/aging.
 * Current (not yet due) balances in the portfolio are a separate category.
 */
export const OVERDUE_BUCKETS = [
  {
    key: 'bucket_0_30',
    label: 'ค้าง 0–30 วัน',
    text: 'text-warning-strong',
    bar: 'bg-warning',
    badge: 'bg-warning/10 text-warning-strong',
  },
  {
    key: 'bucket_31_60',
    label: 'ค้าง 31–60 วัน',
    text: 'text-orange',
    bar: 'bg-orange',
    badge: 'bg-orange/10 text-orange',
  },
  {
    key: 'bucket_61_90',
    label: 'ค้าง 61–90 วัน',
    text: 'text-destructive',
    bar: 'bg-destructive',
    badge: 'bg-destructive/10 text-destructive',
  },
  {
    key: 'bucket_90_plus',
    label: 'ค้างเกิน 90 วัน',
    text: 'text-destructive font-bold',
    bar: 'bg-destructive',
    badge: 'bg-destructive/10 text-destructive font-bold',
  },
] as const;
