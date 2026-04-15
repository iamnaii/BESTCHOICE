import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import { saleTypeConfig } from '@/lib/constants';
import type { SaleType } from '@/lib/constants';
import type { Product, Customer } from '../types';

interface SaleSummaryProps {
  saleType: SaleType;
  selectedProduct: Product | null;
  selectedCustomer: Customer | null;
  bundleProducts: Product[];
  sellingPrice: string;
  discount: string;
  netAmount: number;
  amountReceived: string;
  changeAmount: number;
  transferAmount: number;
  downPayment: string;
  financeCompany: string;
  contractNumber: string;
  isSubmitting: boolean;
  canSubmit: boolean;
  onSubmit: () => void;
  onReset: () => void;
}

export default function SaleSummary({
  saleType,
  selectedProduct,
  selectedCustomer,
  bundleProducts,
  sellingPrice,
  discount,
  netAmount,
  amountReceived,
  changeAmount,
  transferAmount,
  downPayment,
  financeCompany,
  contractNumber,
  isSubmitting,
  canSubmit,
  onSubmit,
  onReset,
}: SaleSummaryProps) {
  const { copy } = useCopyToClipboard();

  return (
    <Card className="sticky top-20 border-border/60 shadow-md overflow-hidden">
      {/* Card accent header */}
      <div className="h-1.5 w-full bg-linear-to-r from-primary to-primary/60" />
      <CardHeader>
        <div className="flex items-center justify-between w-full">
          <div className="text-sm font-semibold text-foreground">สรุปรายการ</div>
          <div
            className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${saleTypeConfig[saleType].bg} ${saleTypeConfig[saleType].color}`}
          >
            {saleTypeConfig[saleType].label}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Product info */}
        {selectedProduct ? (
          <div className="mb-4 p-3.5 rounded-xl bg-muted/50 border border-border/50">
            <div className="text-2xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
              สินค้าหลัก
            </div>
            <div className="text-sm font-semibold text-foreground">
              {selectedProduct.brand} {selectedProduct.model}
            </div>
            {selectedProduct.imeiSerial && (
              <div className="flex items-center gap-1 mt-1">
                <span className="text-2xs text-muted-foreground font-mono">
                  {selectedProduct.imeiSerial}
                </span>
                <button
                  onClick={() => {
                    copy(selectedProduct.imeiSerial!);
                    toast.success('คัดลอกแล้ว');
                  }}
                  className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="คัดลอก IMEI"
                >
                  <Copy className="size-3" />
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="mb-4 p-3.5 rounded-xl bg-muted/30 border border-dashed border-border/60 text-center">
            <div className="text-xs text-muted-foreground">ยังไม่ได้เลือกสินค้า</div>
          </div>
        )}

        {/* Bundle products info */}
        {bundleProducts.length > 0 && (
          <div className="mb-3 p-3 rounded-xl bg-success/5 border border-success/20">
            <div className="text-2xs font-semibold text-success uppercase tracking-wider mb-1.5">
              ของแถม ({bundleProducts.length} รายการ)
            </div>
            {bundleProducts.map((p) => (
              <div key={p.id} className="text-xs text-success flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-success inline-block shrink-0" />
                <span>
                  {p.brand} {p.model}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Customer info */}
        {selectedCustomer ? (
          <div className="mb-4 p-3.5 rounded-xl bg-muted/50 border border-border/50">
            <div className="text-2xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
              ลูกค้า
            </div>
            <div className="text-sm font-semibold text-foreground">{selectedCustomer.name}</div>
            <div className="flex items-center gap-1 mt-0.5">
              <span className="text-xs text-muted-foreground">{selectedCustomer.phone}</span>
              <button
                onClick={() => {
                  copy(selectedCustomer.phone);
                  toast.success('คัดลอกแล้ว');
                }}
                className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                aria-label="คัดลอกเบอร์โทร"
              >
                <Copy className="size-3" />
              </button>
            </div>
          </div>
        ) : (
          <div className="mb-4 p-3.5 rounded-xl bg-muted/30 border border-dashed border-border/60 text-center">
            <div className="text-xs text-muted-foreground">ยังไม่ได้เลือกลูกค้า</div>
          </div>
        )}

        {/* Price breakdown */}
        <div className="space-y-2 pt-3 border-t border-border/50">
          <div className="flex justify-between items-center text-sm">
            <span className="text-muted-foreground">ราคาขาย</span>
            <span className="font-medium tabular-nums">
              {(parseFloat(sellingPrice) || 0).toLocaleString()} ฿
            </span>
          </div>
          {parseFloat(discount) > 0 && (
            <div className="flex justify-between items-center text-sm text-destructive">
              <span>ส่วนลด</span>
              <span className="tabular-nums">-{parseFloat(discount).toLocaleString()} ฿</span>
            </div>
          )}
          <div className="flex justify-between items-center pt-2 border-t border-border/50">
            <span className="text-sm font-semibold text-foreground">ยอดสุทธิ</span>
            <span className="text-lg font-bold text-primary tabular-nums">
              {netAmount.toLocaleString()} ฿
            </span>
          </div>
        </div>

        {/* Cash change */}
        {saleType === 'CASH' && parseFloat(amountReceived) > 0 && (
          <div className="space-y-2 mt-3 pt-3 border-t border-border/50">
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">เงินรับ</span>
              <span className="tabular-nums">
                {parseFloat(amountReceived).toLocaleString()} ฿
              </span>
            </div>
            <div
              className={`flex justify-between items-center text-sm font-bold ${changeAmount >= 0 ? 'text-success' : 'text-destructive'}`}
            >
              <span>เงินทอน</span>
              <span className="text-base tabular-nums">{changeAmount.toLocaleString()} ฿</span>
            </div>
          </div>
        )}

        {/* External finance summary */}
        {saleType === 'EXTERNAL_FINANCE' && (
          <div className="mt-3 pt-3 border-t border-border/50 space-y-2">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              สรุปไฟแนนซ์
            </div>
            {financeCompany && (
              <div className="flex justify-between items-center text-xs">
                <span className="text-muted-foreground">บริษัท</span>
                <span className="font-semibold text-foreground">{financeCompany}</span>
              </div>
            )}
            {contractNumber && (
              <div className="flex justify-between items-center text-xs">
                <span className="text-muted-foreground">เลขที่สัญญา</span>
                <span className="font-mono font-medium text-foreground">{contractNumber}</span>
              </div>
            )}
            {parseFloat(downPayment) > 0 && (
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">เงินดาวน์</span>
                <span className="tabular-nums">
                  {parseFloat(downPayment).toLocaleString()} ฿
                </span>
              </div>
            )}
            <div className="flex justify-between items-center pt-2 border-t border-border/50">
              <span className="text-sm font-semibold text-foreground">ยอดที่ไฟแนนซ์ต้องโอน</span>
              <span className="text-base font-bold text-primary tabular-nums">
                {transferAmount.toLocaleString()} ฿
              </span>
            </div>
          </div>
        )}

        {/* Submit Buttons */}
        <div className="mt-6 space-y-2">
          <button
            onClick={onSubmit}
            disabled={!canSubmit || isSubmitting}
            className="w-full py-3 bg-primary text-primary-foreground rounded-xl text-sm font-semibold disabled:opacity-50 hover:bg-primary/90 transition-all hover:shadow-lg shadow-sm active:scale-[0.98]"
          >
            {isSubmitting ? (
              <span className="flex items-center justify-center gap-2">
                <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                กำลังบันทึก...
              </span>
            ) : (
              'บันทึกการขาย'
            )}
          </button>
          <button
            onClick={onReset}
            className="w-full py-2.5 text-sm text-muted-foreground hover:text-foreground rounded-xl hover:bg-muted/80 transition-colors"
          >
            ล้างข้อมูล
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
