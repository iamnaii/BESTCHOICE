import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * ชิปเลือกหนึ่งตัวของการเดินทางลูกค้า — สไตล์ลอก CallResultChips (pages/CollectionsPage/components/CallResultChips.tsx)
 * ตัวเดียวทุกจุด: ตัวเลือกบันทึกการติดต่อ · เหตุผลติดป้ายหลุด · ป้าย/การ์ดรู้จักร้านจากไหน · dialog สร้างลูกค้า
 *
 * - `busy` = ชิปที่เพิ่งแตะและกำลังบันทึก: หมุน Loader2 + ดูเป็นชิปที่เลือก (บอร์ด MobileSheet b)
 *   และไม่จางแม้ disabled — ถ้าปล่อย disabled:opacity-40 สปินเนอร์จะจางจนมองไม่เห็น (ชิปอื่นจางตามปกติ)
 * - จอต่ำกว่า lg (1024px เท่ากับ useIsMobile) สูง 44px ตาม Q17 — inline-flex items-center ให้ข้อความอยู่กลางความสูงนั้น
 * - type="button" เสมอ: อยู่ใน <form> ของ dialog สร้างลูกค้าได้ แตะแล้วต้องไม่ส่งฟอร์ม
 */
export interface ChoiceChipProps {
  active: boolean;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}

export function ChoiceChip({ active, busy = false, disabled = false, onClick, children }: ChoiceChipProps) {
  const pressed = active || busy;
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-busy={busy || undefined}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs leading-snug transition-colors max-lg:h-11 max-lg:px-4 max-lg:text-sm',
        !busy && 'disabled:cursor-not-allowed disabled:opacity-40',
        pressed
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-input bg-card text-foreground hover:bg-accent',
      )}
    >
      {busy && <Loader2 className="size-3 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}

export interface ChoiceChipRowProps {
  /** ป้ายแถว เช่น "ช่องทาง" / "ผล" — มีป้าย = แถวเป็น role="group" ชื่อตามป้าย */
  label?: string;
  /** คำใบ้ตัวเล็กต่อท้ายป้าย เช่น "เลือกช่องทางก่อน" (แสดงเมื่อมีป้ายเท่านั้น) */
  hint?: string;
  children: ReactNode;
}

export function ChoiceChipRow({ label, hint, children }: ChoiceChipRowProps) {
  return (
    <div role={label ? 'group' : undefined} aria-label={label}>
      {label && (
        <div className="mb-1.5 text-xs font-medium leading-snug text-muted-foreground">
          {label}
          {hint && <span className="ml-1 text-2xs font-normal text-muted-foreground/80">{hint}</span>}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5 max-lg:gap-2">{children}</div>
    </div>
  );
}
