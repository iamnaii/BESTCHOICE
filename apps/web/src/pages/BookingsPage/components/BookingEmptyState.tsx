import { Banknote, CalendarDays, Clock, Pencil, ShoppingCart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import InlineHelp from '@/components/ui/InlineHelp';

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
          รับมัดจำจองเครื่อง แล้วหักจากยอดขายเมื่อลูกค้ามารับ
        </p>
        {canCreate && (
          <Button size="lg" className="mt-1.5" onClick={onCreate}>
            สร้างใบจองแรก
          </Button>
        )}
      </div>
      <InlineHelp label="วิธีใช้งานใบจอง" className="w-full max-w-4xl">
        <ol className="grid gap-5 py-3 md:grid-cols-3">
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
      </InlineHelp>
      <p className="flex max-w-prose items-start gap-2 text-xs leading-relaxed text-muted-foreground">
        <Clock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        อายุเริ่มต้น 7 วัน (ปรับได้) · รับมัดจำแล้วล็อกเครื่อง · หมดอายุริบมัดจำ ·
        ยกเลิกก่อนหมดอายุคืนมัดจำเต็มจำนวน
      </p>
    </section>
  );
}
