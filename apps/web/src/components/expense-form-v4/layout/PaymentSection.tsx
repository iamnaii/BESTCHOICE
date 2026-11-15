import { useId, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  picker: ReactNode;
  unpaid?: { active: boolean; onMarkUnpaid: () => void; onMarkPaid: () => void; backdatedHint: boolean };
  advanced?: { hasData: boolean; onClear: () => void; content: ReactNode };
  footer?: ReactNode;
}

const linkClass = 'min-h-11 px-1 text-sm font-medium leading-snug text-primary underline underline-offset-2';

/** ส่วนชำระเงินแบบ PEAK — โหมด พื้นฐาน/ขั้นสูง เป็น state ของหน้าจอ ไม่มีผลกับ payload */
export function PaymentSection({ picker, unpaid, advanced, footer }: Props) {
  const headingId = useId();
  const [mode, setMode] = useState<'basic' | 'advanced'>('basic');
  // ข้อมูลที่กรอกไว้ต้องมองเห็นเสมอ — มีข้อมูลปรับปรุง = ขั้นสูง
  const showAdvanced = !!advanced && (mode === 'advanced' || advanced.hasData);

  if (unpaid?.active) {
    return (
      <section aria-labelledby={headingId} className="border-t border-border py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm leading-snug">
            <h3 id={headingId} className="flex items-center gap-2 font-semibold">
              <Clock className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              ชำระเงิน
            </h3>
            <span className="text-muted-foreground">ยังไม่ชำระเงิน — ตั้งหนี้ไว้ก่อน</span>
          </div>
          <button type="button" className={linkClass} onClick={unpaid.onMarkPaid}>เพิ่มข้อมูลชำระเงิน</button>
        </div>
        {unpaid.backdatedHint && (
          <p className="mt-1 text-sm leading-snug text-muted-foreground">
            วันที่ใบกำกับไม่ใช่วันนี้ — เอกสารนี้ตั้งหนี้ไว้ก่อน
          </p>
        )}
        {advanced?.hasData && (
          <div role="status" className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2">
            <span className="flex items-center gap-2 text-sm leading-snug text-warning-strong">
              <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
              มีรายการปรับปรุงที่กรอกไว้ ซึ่งจะถูกบันทึกไปด้วย
            </span>
            <Button type="button" variant="outline" className="min-h-11" onClick={advanced.onClear}>ล้างรายการปรับปรุง</Button>
          </div>
        )}
      </section>
    );
  }

  return (
    <section aria-labelledby={headingId} className="border-t border-border py-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
          <h3 id={headingId} className="flex items-center gap-2 text-sm font-semibold leading-snug">
            <CheckCircle2 className="size-4 shrink-0 text-primary" aria-hidden="true" />
            ชำระเงิน
          </h3>
          {advanced && (
            <div role="radiogroup" aria-label="โหมดชำระเงิน" className="flex gap-4 text-sm leading-snug">
              <label className="flex min-h-11 items-center gap-1.5">
                <input
                  type="radio"
                  name={`${headingId}-mode`}
                  className="size-4 accent-primary"
                  checked={!showAdvanced}
                  disabled={advanced.hasData}
                  onChange={() => setMode('basic')}
                />
                พื้นฐาน
              </label>
              <label className="flex min-h-11 items-center gap-1.5">
                <input
                  type="radio"
                  name={`${headingId}-mode`}
                  className="size-4 accent-primary"
                  checked={showAdvanced}
                  onChange={() => setMode('advanced')}
                />
                ขั้นสูง
              </label>
            </div>
          )}
        </div>
        {unpaid && (
          <button type="button" className={linkClass} onClick={unpaid.onMarkUnpaid}>
            ยังไม่ชำระเงิน (ตั้งหนี้ไว้ก่อน)
          </button>
        )}
      </div>
      <div className="space-y-4 rounded-lg border border-dashed border-primary/30 bg-primary/5 p-4">
        {picker}
        {footer}
        {showAdvanced && advanced && (
          <div className="space-y-3 border-t border-primary/20 pt-4">
            {advanced.content}
            {advanced.hasData && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm leading-snug text-muted-foreground">
                  มีรายการปรับปรุงอยู่ จึงกลับไป "พื้นฐาน" ไม่ได้จนกว่าจะล้างรายการ
                </p>
                <Button type="button" variant="outline" className="min-h-11" onClick={advanced.onClear}>ล้างรายการปรับปรุง</Button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
