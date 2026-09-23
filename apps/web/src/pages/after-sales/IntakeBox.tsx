import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  OUTCOME_LABEL,
  SOURCE_LABEL,
  WARRANTY_LABEL,
  dayOf,
  type LookupResult,
} from './after-sales';

interface IntakeBoxProps {
  /**
   * เรียกแทนการนำทางด้วย Link เมื่อผู้เรียกต้องการคุมขั้นตอนเอง (Task 10 ฝัง
   * IntakeBox เป็นขั้นที่ 1 ของวิซาร์ด "แจ้งปัญหาเครื่อง" แทนการเปลี่ยนหน้า) —
   * หน้าหลัก /after-sales (Task 9) ไม่ส่ง prop นี้ ปุ่มจึงเป็นลิงก์ไป
   * /after-sales/new?imei= ตามปกติ
   */
  onOpenCase?: (imei: string) => void;
}

const PURCHASE_PHOTO_KEYS = ['front', 'back', 'left', 'right', 'top', 'bottom'] as const;

/** ป้ายสถานะประกัน — โทเคนเดียวกับ chip เขียว/เทาที่ใช้ทั้งไฟล์ (ไม่ยืมสี STAGE_TILE ตรงๆ
 * เพราะประกันไม่ใช่ขั้นตอนของเคส — คงกฎ "ห้ามบอกสถานะด้วยสีอย่างเดียว" ด้วยข้อความในป้ายเอง) */
const WARRANTY_TILE: Record<string, string> = {
  IN_7DAY_DEFECT: 'border-warning/40 bg-warning/10 text-warning-strong',
  IN_SHOP_WARRANTY: 'border-primary/20 bg-primary/10 text-primary',
  IN_MANUFACTURER: 'border-primary/20 bg-primary/10 text-primary',
  OUT_OF_WARRANTY: 'border-border bg-muted text-muted-foreground',
  WALK_IN: 'border-border bg-muted text-muted-foreground',
};

export default function IntakeBox({ onOpenCase }: IntakeBoxProps) {
  const [searchParams] = useSearchParams();
  const [imei, setImei] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // ?check=1 (ลิงก์เก่าจากหน้าเช็คประกันที่ยุบมารวมแล้ว) = โฟกัสช่องอัตโนมัติ
  useEffect(() => {
    if (searchParams.get('check') === '1') inputRef.current?.focus();
  }, [searchParams]);

  const lookup = useMutation({
    mutationFn: async (value: string) =>
      (await api.get<LookupResult>('/after-sales/lookup', { params: { imei: value } })).data,
  });

  const trimmed = imei.trim();
  const result = lookup.data;
  const resultShown = !!result;
  const encodedImei = encodeURIComponent(trimmed);
  const continueHref = result?.openCase
    ? `/after-sales/${result.openCase.id}`
    : `/after-sales/new?imei=${encodedImei}`;
  const continueLabel = 'แจ้งปัญหาเครื่อง ต่อเลย';

  return (
    <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 sm:p-5">
      <h2 className="text-base font-semibold leading-snug">เช็คก่อนรับเรื่อง</h2>
      <p className="mt-0.5 text-sm leading-snug text-muted-foreground">
        กรอกเลข IMEI หรือเลขเครื่อง — ระบบจะบอกว่าอยู่ในประกันแบบไหนและทำอะไรได้บ้าง
      </p>

      <form
        className="mt-3 flex flex-col gap-2.5 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (trimmed && !lookup.isPending) lookup.mutate(trimmed);
        }}
      >
        <input
          ref={inputRef}
          id="after-sales-imei"
          aria-label="เลข IMEI หรือเลขเครื่อง"
          value={imei}
          onChange={(e) => setImei(e.target.value)}
          placeholder="กรอกเลข IMEI 15 หลัก"
          className="h-14 w-full flex-1 rounded-lg border border-input bg-background px-4 text-lg leading-snug text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-ring/30"
        />
        <div className="flex gap-2.5">
          <Button
            type="submit"
            variant="outline"
            size="lg"
            className="h-14 flex-1 sm:flex-none"
            disabled={!trimmed || lookup.isPending}
          >
            เช็คประกัน
          </Button>
          {onOpenCase ? (
            <Button
              type="button"
              variant={resultShown ? 'outline' : 'primary'}
              size="lg"
              className="h-14 flex-1 sm:flex-none"
              onClick={() => onOpenCase(trimmed)}
            >
              แจ้งปัญหาเครื่อง
            </Button>
          ) : (
            <Button
              asChild
              variant={resultShown ? 'outline' : 'primary'}
              size="lg"
              className="h-14 flex-1 sm:flex-none"
            >
              <Link to={`/after-sales/new?imei=${encodedImei}`}>แจ้งปัญหาเครื่อง</Link>
            </Button>
          )}
        </div>
      </form>

      {lookup.isError && (
        <p role="alert" className="mt-3 text-sm leading-snug text-destructive">
          เช็คประกันไม่สำเร็จ — ลองใหม่อีกครั้ง
        </p>
      )}

      {result && (
        <div className="mt-4 rounded-lg border border-border bg-card p-4">
          {!result.found ? (
            <p className="text-sm leading-snug text-foreground">
              ไม่พบเครื่องในระบบ — รับซ่อมได้ (ลูกค้าจ่าย)
            </p>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold leading-snug ${
                    WARRANTY_TILE[result.warranty.status] ?? WARRANTY_TILE.WALK_IN
                  }`}
                >
                  {WARRANTY_LABEL[result.warranty.status] ?? result.warranty.status}
                </span>
                <span className="text-sm font-semibold leading-snug">
                  {result.customer?.name ?? 'ไม่ทราบชื่อลูกค้า'}
                </span>
              </div>

              <p className="text-sm leading-snug text-foreground">
                {[result.product?.brand, result.product?.model, result.product?.storage]
                  .filter(Boolean)
                  .join(' ') || 'ไม่ทราบรุ่นเครื่อง'}
                {' · '}
                {SOURCE_LABEL[result.source]}
              </p>

              {result.warranty.purchasedAt && (
                <p className="text-xs leading-snug text-muted-foreground">
                  ลูกค้ารับเครื่องไป {dayOf(result.warranty.purchasedAt)} · กรอบ 7 วัน เหลือ{' '}
                  {result.warranty.daysRemainingIn7Day} วัน · ประกันร้านถึง{' '}
                  {result.warranty.shopWarrantyEndDate
                    ? dayOf(result.warranty.shopWarrantyEndDate)
                    : '—'}{' '}
                  · ประกันศูนย์ถึง{' '}
                  {result.warranty.manufacturerWarrantyEndDate
                    ? dayOf(result.warranty.manufacturerWarrantyEndDate)
                    : '—'}
                </p>
              )}

              {result.outcomes.some((o) => o.enabled) && (
                <p className="text-xs leading-snug text-muted-foreground">
                  ทำได้ตอนนี้:{' '}
                  {result.outcomes
                    .filter((o) => o.enabled)
                    .map((o) => OUTCOME_LABEL[o.outcome])
                    .join(' · ')}
                </p>
              )}

              <p className="text-xs leading-snug text-muted-foreground">
                รูปตอนซื้อ:{' '}
                {result.purchasePhotos
                  ? PURCHASE_PHOTO_KEYS.filter((k) => !!result.purchasePhotos?.[k]).length
                  : 0}{' '}
                มุม
              </p>

              {result.openCase && (
                <div className="flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-sm leading-snug text-warning-strong">
                  <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>
                    เครื่องนี้มีเคสที่ยังไม่ปิด {result.openCase.caseNumber} —{' '}
                    <Link
                      to={`/after-sales/${result.openCase.id}`}
                      className="font-semibold underline"
                    >
                      เปิดดูเคสนี้
                    </Link>
                  </p>
                </div>
              )}

              <div className="flex flex-wrap gap-2 pt-1">
                {onOpenCase ? (
                  <Button
                    type="button"
                    variant="primary"
                    size="lg"
                    onClick={() => onOpenCase(trimmed)}
                  >
                    {continueLabel}
                  </Button>
                ) : (
                  <Button asChild variant="primary" size="lg">
                    <Link to={continueHref}>{continueLabel}</Link>
                  </Button>
                )}
                <Button type="button" variant="outline" size="lg" onClick={() => lookup.reset()}>
                  แค่เช็ค พอแล้ว
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
