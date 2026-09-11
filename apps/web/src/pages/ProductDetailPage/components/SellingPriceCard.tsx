import { Check, ChevronRight, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { formatBaht } from '../utils/buildCustomerSummary';
import type { ProductReadinessCheck } from '../hooks/useProductReadiness';

interface LegacyPrice {
  id: string;
  label: string;
  amount: string;
  isDefault: boolean;
}

interface Props {
  cashPrice: string | number | null;
  installmentPrice: string | number | null;
  /** B0 stamp เมื่อราคาถูกเติมจาก PricingTemplate — เคลียร์เมื่อมีคนแก้ราคาด้วยมือ */
  priceAutofilledAt: string | null;
  /**
   * true เมื่อ `cashPrice`/`installmentPrice` ที่ได้รับมาไม่ได้มาจากคอลัมน์จริง แต่ fallback
   * ไปหาแถว `prices[]` แบบเก่า (คอลัมน์ดิบเป็น null/ไม่บวก) — caller (index.tsx) เป็นคนคำนวณ
   * โดยเทียบผลลัพธ์ของ getPositiveDisplayPrices กับคอลัมน์ดิบ. คนละสถานะกับ priceAutofilledAt
   * (นั่นคือระบบเติมให้ "เข้าคอลัมน์แล้ว" — นี่คือ "ยังไม่เข้าคอลัมน์เลย เว็บเลยไม่เห็น")
   */
  cashIsFallback?: boolean;
  installmentIsFallback?: boolean;
  canEdit: boolean;
  onEdit: () => void;
  /** สถานะขึ้นเว็บ (readiness) — บรรทัดล่างของการ์ด · ไม่ส่ง = ไม่โชว์บรรทัดนี้ */
  readiness?: { isReady: boolean; checks: ProductReadinessCheck[] } | null;
  onGoOnline?: () => void;
  /** ราคาในระบบเดิม (prices[]) — โชว์เป็นลิงก์เล็กเฉพาะเมื่อมีแถว (กำลังเลิกใช้ตาม owner decision §1.1) */
  legacyPrices?: LegacyPrice[];
}

function toNum(v: string | number | null): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export default function SellingPriceCard({
  cashPrice,
  installmentPrice,
  priceAutofilledAt,
  cashIsFallback,
  installmentIsFallback,
  canEdit,
  onEdit,
  readiness,
  onGoOnline,
  legacyPrices,
}: Props) {
  const cash = toNum(cashPrice);
  const installment = toNum(installmentPrice);
  const isFallback = Boolean(cashIsFallback || installmentIsFallback);
  const firstBlocker = readiness?.checks.find((c) => !c.ok && c.severity !== 'info');

  return (
    <Card className="rounded-xl border border-border/50 bg-card shadow-sm">
      <CardHeader>
        <CardTitle>ราคาขาย</CardTitle>
        <div className="flex items-center gap-2">
          {priceAutofilledAt && (
            <Badge variant="warning" appearance="light" size="sm">
              เติมอัตโนมัติจากตารางราคากลาง
            </Badge>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="text-sm text-primary hover:text-primary/80 font-medium leading-snug"
            >
              แก้ราคา
            </button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-muted-foreground mb-1 leading-snug">ราคาเงินสด</div>
            <div className="font-mono text-2xl font-semibold tabular-nums text-primary">
              {cash != null ? `${formatBaht(cash)} ฿` : '-'}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1 leading-snug">ราคาผ่อน (ตั้งต้น)</div>
            <div className="font-mono text-2xl font-semibold tabular-nums text-foreground">
              {installment != null ? `${formatBaht(installment)} ฿` : '-'}
            </div>
          </div>
        </div>
        {cash == null && installment == null && (
          <p className="text-sm text-muted-foreground leading-snug">
            ยังไม่กำหนดราคา — แจ้งผู้จัดการก่อนเสนอลูกค้า
          </p>
        )}
        {isFallback && (
          <p className="text-sm text-warning leading-snug">
            ราคาจากระบบเดิม — ยังไม่ได้ตั้งราคาขายใหม่ เครื่องนี้จะยังไม่ขึ้นเว็บ
          </p>
        )}

        {readiness && (
          <div className="flex items-center justify-between gap-3 border-t border-border pt-3 text-[13px] leading-snug">
            <span className="inline-flex items-center gap-1.5">
              {readiness.isReady ? (
                <Check className="size-3.5 text-success" aria-hidden />
              ) : (
                <X className="size-3.5 text-warning" aria-hidden />
              )}
              <span>
                {readiness.isReady
                  ? 'ขึ้นเว็บแล้ว · ลิงก์ส่งลูกค้าใช้ได้'
                  : `ยังขึ้นเว็บไม่ได้${firstBlocker ? ` · ${firstBlocker.label}` : ''}`}
              </span>
            </span>
            {onGoOnline && (
              <button
                type="button"
                onClick={onGoOnline}
                className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline"
              >
                ขึ้นเว็บ
                <ChevronRight className="size-3.5" aria-hidden />
              </button>
            )}
          </div>
        )}

        {legacyPrices && legacyPrices.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground leading-snug"
              >
                ราคาในระบบเดิม ({legacyPrices.length})
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 space-y-2">
              <div className="text-xs text-muted-foreground leading-snug">
                ราคาในระบบเดิม — อ่านอย่างเดียว (กำลังเลิกใช้)
              </div>
              {legacyPrices.map((price) => (
                <div key={price.id} className="flex items-center justify-between gap-3 text-sm leading-snug">
                  <span className="flex items-center gap-2">
                    <span>{price.label}</span>
                    {price.isDefault && (
                      <Badge variant="primary" appearance="light" size="sm">
                        ค่าเริ่มต้น
                      </Badge>
                    )}
                  </span>
                  <span className="font-mono font-semibold tabular-nums">
                    {formatBaht(Number(price.amount))} ฿
                  </span>
                </div>
              ))}
            </PopoverContent>
          </Popover>
        )}
      </CardContent>
    </Card>
  );
}
