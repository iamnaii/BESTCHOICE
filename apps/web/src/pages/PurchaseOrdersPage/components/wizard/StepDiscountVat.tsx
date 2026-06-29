import { formatNumberDecimal } from '@/utils/formatters';
import type { CreatePOModalProps } from '../CreatePOModal';
import type { PoTotals } from '../../poTotals';

interface StepDiscountVatProps {
  form: CreatePOModalProps['form'];
  setForm: CreatePOModalProps['setForm'];
  supplierHasVat: boolean;
  totals: PoTotals;
}

const baht = (n: number) => `${formatNumberDecimal(n, 2)} บาท`;
const discountInput =
  'w-36 px-2 py-1 border border-input rounded text-sm text-right tabular-nums font-mono focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden';

export function StepDiscountVat({ form, setForm, supplierHasVat, totals }: StepDiscountVatProps) {
  const {
    subtotal,
    discountNum,
    subtotalAfterDiscount,
    vatAmount,
    totalWithVat,
    discountAfterVatNum,
    netAmount,
  } = totals;
  return (
    <div className="rounded-xl border border-border/50 bg-card p-5 shadow-sm">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="flex items-center justify-center size-8 rounded-lg bg-primary/10 text-primary">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
          </svg>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground leading-snug">ส่วนลด และ VAT</h3>
          <p className="text-xs text-muted-foreground leading-snug">
            {supplierHasVat
              ? 'คำนวณ VAT 7% หลังหักส่วนลด แล้วจึงหักส่วนลดหลัง VAT'
              : 'ผู้จัดจำหน่ายไม่มี VAT'}
          </p>
        </div>
      </div>

      <div className="bg-muted/50 rounded-lg p-4 space-y-2 text-sm">
        {/* 1. subtotal */}
        <div className="flex justify-between">
          <span className="text-muted-foreground leading-snug">
            มูลค่าสินค้า{supplierHasVat ? ' (ก่อน VAT)' : ''}
          </span>
          <span className="font-medium tabular-nums font-mono">{baht(subtotal)}</span>
        </div>

        {/* 2. discount before VAT (editable) */}
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground leading-snug">
            หัก ส่วนลด{supplierHasVat ? ' (ก่อน VAT)' : ''}
          </span>
          <input
            type="number"
            min="0"
            placeholder="0"
            value={form.discount}
            onChange={(e) => setForm({ ...form, discount: e.target.value })}
            className={discountInput}
          />
        </div>

        {/* 3. subtotalAfterDiscount */}
        <div className="flex justify-between border-t border-border/60 pt-2">
          <span className="text-muted-foreground leading-snug">= มูลค่าหลังหักส่วนลด</span>
          <span className="tabular-nums font-mono">{baht(subtotalAfterDiscount)}</span>
        </div>

        {supplierHasVat && (
          <>
            {/* 4. VAT */}
            <div className="flex justify-between">
              <span className="text-muted-foreground leading-snug">
                + VAT 7% (ปัดเศษขึ้นครึ่งสตางค์)
              </span>
              <span className="tabular-nums font-mono">{baht(vatAmount)}</span>
            </div>
            {/* 5. totalWithVat */}
            <div className="flex justify-between border-t border-border/60 pt-2">
              <span className="text-muted-foreground leading-snug">= มูลค่ารวม VAT</span>
              <span className="tabular-nums font-mono">{baht(totalWithVat)}</span>
            </div>
            {/* 6. discount after VAT (editable) */}
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground leading-snug">หัก ส่วนลด (หลัง VAT)</span>
              <input
                type="number"
                min="0"
                placeholder="0"
                value={form.discountAfterVat}
                onChange={(e) => setForm({ ...form, discountAfterVat: e.target.value })}
                className={discountInput}
              />
            </div>
          </>
        )}

        {/* 7. net */}
        <div className="flex justify-between border-t-2 border-border pt-2.5 mt-1 font-semibold text-base">
          <span className="leading-snug">ยอดสุทธิ</span>
          <span className="text-primary tabular-nums font-mono">{baht(netAmount)}</span>
        </div>

        {/* explainer */}
        <p className="text-2xs text-muted-foreground leading-snug pt-1">
          {supplierHasVat
            ? `วิธีคิด: (${formatNumberDecimal(subtotal, 2)} − ${formatNumberDecimal(discountNum, 2)}) × 1.07 − ${formatNumberDecimal(discountAfterVatNum, 2)} = ${formatNumberDecimal(netAmount, 2)} บาท`
            : `วิธีคิด: ${formatNumberDecimal(subtotal, 2)} − ${formatNumberDecimal(discountNum, 2)} = ${formatNumberDecimal(netAmount, 2)} บาท`}
        </p>
      </div>
    </div>
  );
}
