import { Headphones, Recycle, Smartphone, Tablet, type LucideIcon } from 'lucide-react';
import { categoryOptions } from '@/lib/constants';
import { cn } from '@/lib/utils';

const ICONS: Record<string, LucideIcon> = {
  PHONE_NEW: Smartphone,
  PHONE_USED: Recycle,
  TABLET: Tablet,
  ACCESSORY: Headphones,
};

/** ประเภทสินค้า — ปุ่มใหญ่ 4 ตัว (มือถือ 2×2) แทนดรอปดาวน์ · กดตัวที่เลือกอยู่ซ้ำไม่ล้างฟอร์ม */
export default function CategoryChips({
  value,
  onChange,
}: {
  value: string;
  onChange: (category: string) => void;
}) {
  return (
    <div role="group" aria-label="ประเภทสินค้า" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {categoryOptions.map((opt) => {
        const Icon = ICONS[opt.value] ?? Smartphone;
        const on = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={on}
            onClick={() => {
              if (!on) onChange(opt.value);
            }}
            className={cn(
              'flex min-h-14 items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm leading-snug transition-colors',
              on
                ? 'border-primary bg-primary/10 font-semibold text-primary ring-1 ring-primary'
                : 'border-input bg-card text-foreground hover:border-primary/60',
            )}
          >
            <Icon className="size-5 shrink-0" aria-hidden="true" />
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
