import { cn } from '@/lib/utils';
import type { CustomerView, CustomerViewCounts } from '../types';

/**
 * สวิตช์ ลูกค้า | ผู้สนใจ — port จาก `StockViewSwitch` (`StockListTab.tsx:66-113`)
 * สูง 44px รางสี muted ปุ่มที่เลือกเป็นพื้น card ตัวหนังสือ primary
 */

const VIEW_OPTIONS: Array<{ key: CustomerView; label: string }> = [
  { key: 'customers', label: 'ลูกค้า' },
  { key: 'prospects', label: 'ผู้สนใจ' },
];

const HINT: Record<CustomerView, string> = {
  customers: 'ซื้อกับเราแล้ว — ผ่อน เงินสด หรือไฟแนนซ์นอก',
  prospects: 'ยังไม่เคยซื้อ — มาจากแชท บอทขาย หรือหน้าร้าน',
};

export default function CustomerViewSwitch({
  view,
  setView,
  counts,
  className,
}: {
  view: CustomerView;
  setView: (view: CustomerView) => void;
  counts?: CustomerViewCounts;
  className?: string;
}) {
  return (
    <div className={cn('mb-4 flex min-w-0 flex-wrap items-center gap-3', className)}>
      <div
        role="group"
        aria-label="แสดงรายชื่อ"
        className="flex h-11 gap-1 rounded-lg border border-border/80 bg-muted/50 p-1"
      >
        {VIEW_OPTIONS.map((option) => {
          const on = view === option.key;
          const count = counts ? counts[option.key] : null;
          return (
            <button
              key={option.key}
              type="button"
              aria-pressed={on}
              onClick={() => setView(option.key)}
              className={cn(
                'flex min-w-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 text-sm leading-snug transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                on
                  ? 'bg-card font-semibold text-primary shadow-xs ring-1 ring-primary/35'
                  : 'font-medium text-muted-foreground hover:text-foreground',
              )}
            >
              {option.label}
              {count != null && (
                <span
                  className={cn(
                    'inline-flex h-5 items-center rounded-full px-1.5 font-mono text-xs font-semibold tabular-nums',
                    on ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
                  )}
                >
                  {count.toLocaleString()}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p className="ml-auto text-xs leading-snug text-muted-foreground">{HINT[view]}</p>
    </div>
  );
}
