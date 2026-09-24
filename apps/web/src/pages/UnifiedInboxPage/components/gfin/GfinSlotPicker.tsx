import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PRIMARY_SLOTS, SLOT_LABELS, SLOT_ORDER, type FinanceSlot } from './gfin';

/**
 * ไดอะล็อกเลือกช่องเอกสารของใบยื่น GFIN — เปิดตอนกดปุ่ม GFIN ข้างรูปในแชท หรือลากไฟล์/ข้อความ
 * มาวางที่แท็บ GFIN ของ RoomDossier (spec §6.3, mockup ขั้น 3 "8/9 ช่อง")
 */
export default function GfinSlotPicker({ open, onOpenChange, counts, onPick, title = 'ใส่ช่องไหนของใบยื่น GFIN?' }: {
  open: boolean; onOpenChange: (open: boolean) => void; counts: Record<FinanceSlot, number>; onPick: (slot: FinanceSlot) => void; title?: string;
}) {
  const [slot, setSlot] = useState<FinanceSlot | null>(null);
  const [showAll, setShowAll] = useState(false);
  /* component นี้ mount ครั้งเดียวตลอดอายุหน้า (เปิด/ปิดด้วย prop `open` ไม่ใช่ unmount) —
     ต้องรีเซ็ตทุกครั้งที่ *เปิด* ไม่ใช่แค่ตอนปิด ไม่งั้นข้อความ/ไฟล์ก่อนหน้าที่เคยเลือกไว้
     (เช่น "บัตรประชาชน") จะยังติดค้าง + ปุ่มยืนยันเปิดใช้งานทันทีในการเปิดครั้งถัดไป
     ทั้งที่ยังไม่ได้เลือกช่องของไฟล์ใหม่เลย — เสี่ยงยื่นไฟล์ผิดช่องแบบเงียบ ๆ */
  useEffect(() => { if (open) { setSlot(null); setShowAll(false); } }, [open]);
  const slots = showAll ? SLOT_ORDER : SLOT_ORDER.filter((s) => PRIMARY_SLOTS.includes(s) || counts[s] > 0);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setSlot(null); setShowAll(false); } onOpenChange(o); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <DialogDescription className="sr-only">เลือกช่องเอกสารที่จะใส่ไฟล์นี้ในใบยื่น GFIN</DialogDescription>
        <div role="radiogroup" aria-label="ช่องเอกสาร" className="grid max-h-[60vh] gap-1.5 overflow-y-auto">
          {slots.map((s) => {
            const on = slot === s;
            return (
              <button key={s} type="button" role="radio" aria-checked={on} onClick={() => setSlot(s)}
                className={cn('flex min-h-11 items-center justify-between rounded-lg border px-3 text-left text-sm leading-snug', on ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted')}>
                <span>{SLOT_LABELS[s]}</span>
                <span className="text-xs font-semibold text-muted-foreground">{`${counts[s]} → ${counts[s] + 1}`}</span>
              </button>
            );
          })}
        </div>
        {!showAll && <Button variant="ghost" size="sm" onClick={() => setShowAll(true)}>เพิ่มช่อง</Button>}
        <p className="m-0 text-xs leading-snug text-muted-foreground">ระบบคัดลอกรูปเก็บไว้ทันที ลิงก์ Facebook หมดอายุก็ไม่หาย · ลูกค้าไม่เห็น</p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>ยกเลิก</Button>
          <Button disabled={!slot} onClick={() => slot && onPick(slot)}>ใส่ช่องนี้</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
