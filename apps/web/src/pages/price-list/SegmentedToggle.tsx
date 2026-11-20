import { cn } from '@/lib/utils';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

/**
 * ปุ่มสลับแบบแบ่งช่อง — หน้าตาเดียวกับ `CustomerViewSwitch` (`pages/CustomersPage/components/CustomerViewSwitch.tsx`):
 * สูง 44px · รางสี muted · ช่องที่เลือกเป็นพื้น card ตัวหนังสือ primary · บอกสถานะด้วย `aria-pressed`
 */
export default function SegmentedToggle<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex min-h-11 gap-1 rounded-lg bg-muted/50 ring-1 ring-inset ring-border/80"
    >
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            data-ui-control="button"
            key={option.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex min-h-11 min-w-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-lg px-4 text-sm leading-snug transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              on
                ? 'bg-card font-semibold text-primary shadow-xs ring-1 ring-inset ring-primary/35'
                : 'font-medium text-muted-foreground hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
