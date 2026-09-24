import { ArrowRight } from 'lucide-react';
import { baht, EXCHANGE_KIND_LABEL, TIER_LABEL, type CaseDetail } from './after-sales';

/**
 * การ์ด "เครื่องเดิม → เครื่องใหม่" (Task 11 — mockup กระดาน 4-5 `CaseExchange.dc.html`) —
 * มีเฉพาะเมื่อ `data.exchange` ไม่เป็น null (เคสที่เลือกทางออกเปลี่ยนเครื่องแล้ว ไม่ว่าจะอยู่ stage ไหน)
 */
export default function ExchangeCard({ data }: { data: CaseDetail }) {
  const ex = data.exchange;
  if (!ex) return null;

  const old = ex.oldProduct;
  const next = ex.newProduct;

  // "วันที่ N" ของกรอบ 7 วัน — ประมาณจาก daysRemainingIn7Day (เหลือกี่วันจาก 7) เมื่อยังอยู่ในกรอบ
  // เท่านั้น ไม่ใช่ตัวเลขที่ backend ส่งมาตรงๆ — เป็นค่าประมาณเพื่อการแสดงผล ไม่ใช่ตัวตัดสินสิทธิ์
  const dayOfWindow =
    ex.kind === 'SAME_MODEL' &&
    data.warrantySnapshot.status === 'IN_7DAY_DEFECT' &&
    Number.isFinite(data.warrantySnapshot.daysRemainingIn7Day)
      ? Math.min(7, Math.max(1, 8 - data.warrantySnapshot.daysRemainingIn7Day))
      : null;

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4 sm:p-5">
      <h2 className="text-base font-semibold leading-snug">เครื่องเดิม → เครื่องใหม่</h2>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2.5">
        <div className="space-y-1 rounded-lg border border-border bg-muted p-3">
          <p className="text-xs font-semibold leading-snug text-muted-foreground">เครื่องเดิม</p>
          <p className="text-sm font-semibold leading-snug text-foreground">
            {old ? [old.brand, old.model, old.storage].filter(Boolean).join(' ') : '—'}
          </p>
          <p className="text-xs leading-snug text-muted-foreground">
            IMEI {old?.imeiSerial ?? '—'}
          </p>
        </div>
        <ArrowRight aria-hidden className="h-5 w-5 shrink-0 text-muted-foreground" />
        <div className="space-y-1 rounded-lg border border-primary/20 bg-primary/5 p-3">
          <p className="text-xs font-semibold leading-snug text-primary">เครื่องใหม่</p>
          <p className="text-sm font-semibold leading-snug text-foreground">
            {next ? [next.brand, next.model, next.storage].filter(Boolean).join(' ') : '—'}
          </p>
          <p className="text-xs leading-snug text-muted-foreground">
            IMEI {next?.imeiSerial ?? '—'}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {ex.kind === 'SAME_MODEL' && (
          <>
            <span className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-2.5 py-0.5 text-xs font-semibold leading-snug text-primary">
              อยู่ในกรอบ 7 วัน{dayOfWindow ? ` · วันที่ ${dayOfWindow}` : ''}
            </span>
            <span className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-2.5 py-0.5 text-xs font-semibold leading-snug text-primary">
              รุ่น+ความจุตรงกัน
            </span>
          </>
        )}
        {ex.kind === 'PRICED' && (
          <span className="inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-semibold leading-snug text-foreground">
            {EXCHANGE_KIND_LABEL.PRICED}
            {ex.approvalTier ? ` · ${TIER_LABEL[ex.approvalTier]}` : ''}
          </span>
        )}
        {ex.buybackPrice && (
          <span className="inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-semibold leading-snug text-foreground">
            ราคารับซื้อ {baht(ex.buybackPrice)}
          </span>
        )}
      </div>
    </section>
  );
}
