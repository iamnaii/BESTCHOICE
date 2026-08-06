import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatBaht } from '../utils/buildCustomerSummary';

interface Props {
  cashPrice: string | number | null;
  installmentPrice: string | number | null;
  /** B0 stamp เมื่อราคาถูกเติมจาก PricingTemplate — เคลียร์เมื่อมีคนแก้ราคาด้วยมือ */
  priceAutofilledAt: string | null;
  canEdit: boolean;
  onEdit: () => void;
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
  canEdit,
  onEdit,
}: Props) {
  const cash = toNum(cashPrice);
  const installment = toNum(installmentPrice);

  return (
    <Card className="mb-5 lg:mb-7.5 rounded-xl border border-border/50 bg-card shadow-sm">
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
      <CardContent>
        <div className="grid grid-cols-2 gap-5">
          <div>
            <div className="text-xs text-muted-foreground mb-0.5 leading-snug">ราคาเงินสด</div>
            <div className="text-lg font-semibold text-primary tabular-nums font-mono">
              {cash != null ? `${formatBaht(cash)} ฿` : '-'}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-0.5 leading-snug">ราคาผ่อน (ตั้งต้น)</div>
            <div className="text-lg font-semibold text-foreground tabular-nums font-mono">
              {installment != null ? `${formatBaht(installment)} ฿` : '-'}
            </div>
          </div>
        </div>
        {cash == null && installment == null && (
          <p className="mt-3 text-sm text-muted-foreground leading-snug">
            ยังไม่กำหนดราคา — แจ้งผู้จัดการก่อนเสนอลูกค้า
          </p>
        )}
      </CardContent>
    </Card>
  );
}
