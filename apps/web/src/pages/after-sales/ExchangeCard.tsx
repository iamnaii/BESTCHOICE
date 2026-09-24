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

  // P-M.1 (fix round 1) — เลิกประมาณ "วันที่ N" เอง ใช้สแนปช็อตตอนแจ้งปัญหาที่ API ส่งมาตรงๆ
  // (`warrantySnapshot.daysRemainingIn7Day`) แทน: ยังเหลือ (> 0) = อยู่ในกรอบ; หมด/ไม่มีค่า =
  // พ้นกรอบแล้ว (ครอบคลุมเคส REPAIR-origin ที่ยืนยันผ่าน bypass นอกกรอบ 7 วันด้วย — เดิม badge
  // เก่าอ้าง "อยู่ในกรอบ" ทุกเคส SAME_MODEL โดยไม่เช็คว่าจริงไหม)
  const daysRemaining = data.warrantySnapshot.daysRemainingIn7Day;
  const stillInWindow = Number.isFinite(daysRemaining) && daysRemaining > 0;

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
            {stillInWindow ? (
              <span className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-2.5 py-0.5 text-xs font-semibold leading-snug text-primary">
                อยู่ในกรอบ 7 วัน · เหลือ {daysRemaining} วัน
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full border border-warning/40 bg-warning/10 px-2.5 py-0.5 text-xs font-semibold leading-snug text-warning-strong">
                พ้นกรอบ 7 วัน — ผจก. ยืนยันได้
              </span>
            )}
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
