// Fix Report v1.0 P2-1 — DocTypePicker chip cards.
//
// 5 chip cards with Smart Default heuristic surfaced inline:
//
//   - When `invoiceDateIsToday`, the "Same-day" card shows a "แนะนำ" badge.
//   - When the invoice date is in the past, the "ตั้งหนี้" card shows it.
//   - The badge is purely advisory — the user is free to override at any time;
//     the actual auto-flip from SAMEDAY → ACCRUAL when the invoice-date moves
//     off today still lives in ExpenseFormV4 (one-way: never reverts manual
//     ACCRUAL).

import { Banknote, Coins, FileWarning, Receipt, Users, Wallet, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DocType } from './types';

interface Props {
  value: DocType;
  onChange: (t: DocType) => void;
  invoiceDateIsToday: boolean;
}

interface TabDef {
  type: DocType;
  label: string;
  sub: string;
  Icon: typeof Receipt;
}

const TABS: TabDef[] = [
  { type: 'EXPENSE_SAMEDAY', label: 'Same-day', sub: 'จ่ายวันเดียวกับใบกำกับ', Icon: Banknote },
  { type: 'EXPENSE_ACCRUAL', label: 'ตั้งหนี้', sub: 'รับใบ ยังไม่จ่าย', Icon: FileWarning },
  { type: 'VENDOR_SETTLEMENT', label: 'จ่ายเจ้าหนี้', sub: 'อ้างถึง ACCRUAL', Icon: Wallet },
  { type: 'PAYROLL', label: 'เงินเดือน', sub: 'จ่ายเงินเดือนพนักงาน', Icon: Users },
  { type: 'CREDIT_NOTE', label: 'ใบลดหนี้', sub: 'ผู้ขายคืนเงิน', Icon: Receipt },
  { type: 'PETTY_CASH_REIMBURSEMENT', label: 'Petty Cash', sub: 'เบิกชดเชยเงินสดย่อย', Icon: Coins },
];

export function DocTypePicker({ value, onChange, invoiceDateIsToday }: Props) {
  const recommended: DocType = invoiceDateIsToday ? 'EXPENSE_SAMEDAY' : 'EXPENSE_ACCRUAL';

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        {TABS.map(({ type, label, sub, Icon }) => {
          const active = value === type;
          const isRecommended = recommended === type && value !== type;
          return (
            <button
              type="button"
              key={type}
              onClick={() => onChange(type)}
              className={cn(
                'relative flex items-start gap-2 rounded-lg border p-3 text-left transition-colors',
                active
                  ? 'border-primary bg-primary/5 ring-2 ring-primary/30'
                  : isRecommended
                    ? 'border-primary/40 bg-primary/[0.02] hover:bg-primary/5'
                    : 'border-border bg-card hover:bg-accent',
              )}
              aria-pressed={active}
            >
              <Icon
                className={cn(
                  'size-4 mt-0.5 shrink-0',
                  active ? 'text-primary' : 'text-muted-foreground',
                )}
              />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium leading-snug">{label}</span>
                  {isRecommended && (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                      <Sparkles className="size-2.5" />
                      แนะนำ
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground leading-snug truncate">{sub}</div>
              </div>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground pl-1">
        Smart Default: invoice_date = today → SAMEDAY · invoice_date &lt; today → ACCRUAL
        {invoiceDateIsToday && value === 'EXPENSE_ACCRUAL' && (
          <span className="text-warning"> · ตั้งหนี้แล้วทั้งที่วันที่เป็นวันนี้</span>
        )}
      </p>
    </div>
  );
}
