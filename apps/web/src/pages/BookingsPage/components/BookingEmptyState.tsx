import { Banknote, CalendarDays, Clock, Pencil, ShoppingCart } from 'lucide-react';
import { Button } from '@/components/ui/button';

const STEPS = [
  {
    icon: Pencil,
    title: 'สร้างใบจอง',
    text: 'เลือกลูกค้า เลือกเครื่องในสต็อก ระบุมัดจำและวันหมดอายุ',
  },
  {
    icon: Banknote,
    title: 'รับมัดจำ',
    text: 'บันทึกเงินสด/โอน/QR เงินเข้าสมุดเงินหน้าร้านของสาขา',
  },
  {
    icon: ShoppingCart,
    title: 'รับส่วนต่างและขาย',
    text: 'ลูกค้ามารับเครื่อง จ่ายส่วนที่เหลือ ออกใบขายโดยหักมัดจำ',
  },
] as const;

/** หน้าว่าง 1B — prod ยังไม่มีใบจองเลย นี่คือจอแรกที่ทีมเห็น */
export default function BookingEmptyState({
  canCreate,
  onCreate,
}: {
  canCreate: boolean;
  onCreate: () => void;
}) {
  return (
    <section className="flex flex-col items-center gap-7 rounded-lg border border-border bg-card px-6 pb-10 pt-14 shadow-card">
      <div className="flex max-w-lg flex-col items-center gap-2.5 text-center">
        <span className="inline-flex size-16 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          <CalendarDays className="size-7" />
        </span>
        <h2 className="mt-2 text-lg font-semibold">ยังไม่มีใบจอง</h2>
        <p className="text-sm leading-snug text-muted-foreground">
          ใบจองใช้รับมัดจำเครื่องไว้ให้ลูกค้า เมื่อลูกค้ามารับและจ่ายส่วนที่เหลือ
          ระบบปิดเป็นใบขายให้โดยนำมัดจำมาหักยอดอัตโนมัติ
        </p>
        {canCreate && (
          <Button size="lg" className="mt-1.5" onClick={onCreate}>
            สร้างใบจองแรก
          </Button>
        )}
      </div>
      <ol className="grid w-full max-w-4xl gap-6 border-t border-border pt-7 md:grid-cols-3">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex gap-3">
            <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <s.icon className="size-4" />
            </span>
            <div className="leading-snug">
              <div className="text-sm font-semibold">
                {i + 1}. {s.title}
              </div>
              <div className="mt-0.5 text-[13px] text-muted-foreground">{s.text}</div>
            </div>
          </li>
        ))}
      </ol>
      <p className="flex items-center gap-1.5 text-xs leading-snug text-muted-foreground">
        <Clock className="size-3.5" />
        ใบจองใช้ได้ 7 วันโดยค่าเริ่มต้น (แก้ได้ทุกใบ) · เลยกำหนดแล้วมัดจำที่รับไว้จะถูกริบ ·
        ยกเลิกก่อนหมดอายุคืนมัดจำเต็มจำนวน
      </p>
    </section>
  );
}
