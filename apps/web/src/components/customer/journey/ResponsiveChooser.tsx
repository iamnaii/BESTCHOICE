import type { ReactElement, ReactNode } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/useIsMobile';

/**
 * เปลือกตัวเลือกของการเดินทางลูกค้า — จอกว้าง = Popover ชิดขวาของปุ่ม · ต่ำกว่า 1024px = Sheet ด้านล่าง
 * (บอร์ด Main b / MobileSheet · precedent Sheet ล่าง: UnifiedInboxPage/components/customer360/CustomerContractDialogs.tsx)
 *
 * - `open` ควบคุมโดยผู้เรียก: ผู้เรียกปิดเองหลังบันทึกสำเร็จ และล้าง state ภายใน (ขั้นถามติดป้ายหลุด ฯลฯ) ตอนปิด
 * - `trigger` ต้องเป็น element เดียวที่รับ props ได้ (เช่น <Button>) — ใส่ผ่าน Trigger asChild ทั้งสองแบบ
 *   จึงได้ data-state="open" ตอนเปิด (Button outline เป็นพื้น accent เอง)
 * - Popover ของ Radix มี role="dialog" แต่ไม่มีชื่อ ⇒ aria-label = หัวข้อ · ค่าเริ่มต้น w-72 ทำชิปผล 7 ตัวล้นเกิน 3 แถว จึงใช้ w-80
 * - useIsMobile คืน false ในเรนเดอร์แรกแล้วค่อยปรับ — ไม่มีผลเพราะตัวเลือกเปิดจากการแตะเท่านั้น
 */
export interface ResponsiveChooserProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  trigger: ReactElement;
  children: ReactNode;
}

export function ResponsiveChooser({ open, onOpenChange, title, trigger, children }: ResponsiveChooserProps) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent side="bottom" className="rounded-t-2xl max-h-[80vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription className="sr-only">เลือกจากตัวเลือกด้านล่าง</SheetDescription>
          </SheetHeader>
          {children}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" className="w-80" aria-label={title}>
        <div className="mb-3 text-sm font-semibold leading-snug">{title}</div>
        {children}
      </PopoverContent>
    </Popover>
  );
}
