import { ShieldCheck, ShieldOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatBaht, warrantyLabel, type RateView } from './format';

/** ป้ายประกันของแถวมือ 2 ที่ราคาต่างกัน — ไอคอน + คำ (ไม่บอกด้วยสีอย่างเดียว) · null = ไม่มีป้าย */
export function WarrantyBadge({ hasWarranty }: { hasWarranty: boolean | null }) {
  const label = warrantyLabel(hasWarranty);
  if (!label) return null;
  const Icon = hasWarranty ? ShieldCheck : ShieldOff;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium leading-snug',
        hasWarranty ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {label}
    </span>
  );
}

/** กล่องเรทหนึ่งเรทในการ์ด (จอแคบ) — "ดาวน์ 3,900 · ผ่อน 3,139 × 12 งวด" หรือข้อความเมื่อไม่มีเรท */
export function RateBlock({ title, view }: { title: string; view: RateView }) {
  return (
    <div
      role="group"
      aria-label={title}
      className={cn('rounded-lg bg-muted/50 px-3 py-2 tabular-nums', !view.ok && 'text-muted-foreground')}
    >
      <p className="text-xs leading-snug text-muted-foreground">{title}</p>
      {view.ok ? (
        <p className="text-sm leading-snug text-foreground">
          ดาวน์ <span className="text-base font-semibold">{formatBaht(view.terms.downAmount)}</span> · ผ่อน <span className="text-base font-semibold">{formatBaht(view.terms.monthly)}</span> × {view.terms.months} งวด
        </p>
      ) : (
        <p className="text-sm leading-snug">{view.text}</p>
      )}
    </div>
  );
}
