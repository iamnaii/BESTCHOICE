import { Banknote, FileWarning, Receipt, Users, Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DocType } from './types';

interface Props {
  value: DocType;
  onChange: (t: DocType) => void;
  invoiceDateIsToday: boolean;
}

const TABS: { type: DocType; label: string; sub: string; Icon: typeof Receipt }[] = [
  { type: 'EXPENSE_SAMEDAY', label: 'Same-day', sub: 'จ่ายวันเดียวกับใบกำกับ', Icon: Banknote },
  { type: 'EXPENSE_ACCRUAL', label: 'ตั้งหนี้', sub: 'รับใบ ยังไม่จ่าย', Icon: FileWarning },
  { type: 'VENDOR_SETTLEMENT', label: 'จ่ายเจ้าหนี้', sub: 'อ้างถึง ACCRUAL', Icon: Wallet },
  { type: 'PAYROLL', label: 'เงินเดือน', sub: 'จ่ายเงินเดือนพนักงาน', Icon: Users },
  { type: 'CREDIT_NOTE', label: 'ใบลดหนี้', sub: 'ผู้ขายคืนเงิน', Icon: Receipt },
];

export function TypeTabs({ value, onChange, invoiceDateIsToday }: Props) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-5 gap-2">
        {TABS.map(({ type, label, sub, Icon }) => {
          const active = value === type;
          return (
            <button
              type="button"
              key={type}
              onClick={() => onChange(type)}
              className={cn(
                'flex items-start gap-2 rounded-lg border p-3 text-left transition-colors',
                active
                  ? 'border-primary bg-primary/5 ring-2 ring-primary/30'
                  : 'border-border bg-card hover:bg-accent',
              )}
              aria-pressed={active}
            >
              <Icon className={cn('size-4 mt-0.5 shrink-0', active ? 'text-primary' : 'text-muted-foreground')} />
              <div className="min-w-0">
                <div className="text-sm font-medium leading-snug">{label}</div>
                <div className="text-xs text-muted-foreground leading-snug truncate">{sub}</div>
              </div>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground pl-1">
        Smart Default: invoice_date = today → SAMEDAY / invoice_date &lt; today → ACCRUAL
        {invoiceDateIsToday && value === 'EXPENSE_ACCRUAL' && (
          <span className="text-warning"> · ตั้งหนี้แล้วทั้งที่วันที่เป็นวันนี้</span>
        )}
      </p>
    </div>
  );
}
