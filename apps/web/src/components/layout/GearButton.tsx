import { Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

/** ปุ่มนี้เป็น "ทางเข้า" โหมดตั้งค่าอย่างเดียว (ทางออกอยู่ที่ ExitSettingsBar ด้านบนเมนู)
 *  จึงไม่มีสถานะ active และไม่ประกาศ aria-pressed — ไม่งั้น screen reader อ่านว่าเป็น
 *  สวิตช์ที่กดไม่ลงตลอดกาล และตาก็อ่านไฮไลต์เขียวเป็น "คุณอยู่ตรงนี้" แทนที่จะเป็นปุ่ม */
interface GearButtonProps {
  onClick: () => void;
}

export function GearButton({ onClick }: GearButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="ตั้งค่ากลาง"
      className={cn(
        'flex items-center gap-2.5 w-full px-4 py-2.5 border-t border-sidebar-border text-[13px] font-semibold leading-snug transition-colors duration-150',
        'text-muted-foreground hover:text-foreground hover:bg-sidebar-hover',
      )}
    >
      <Settings className="size-4 shrink-0" aria-hidden="true" />
      <span>ตั้งค่ากลาง</span>
    </button>
  );
}
