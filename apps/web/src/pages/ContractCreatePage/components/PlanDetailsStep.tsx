import type { Product, InterestConfig } from '../types';

export interface PlanDetailsStepProps {
  selectedProduct: Product | null;
  interestConfig: InterestConfig | null | undefined;
  sellingPrice: number;
  downPayment: number;
  setDownPayment: (v: number) => void;
  setDownPaymentTouched: (v: boolean) => void;
  totalMonths: number;
  setTotalMonths: (v: number) => void;
  minDownPct: number;
  minMonths: number;
  maxMonths: number;
  notes: string;
  setNotes: (v: string) => void;
  paymentDueDay: number;
  setPaymentDueDay: (v: number) => void;
  interestRate: number;
  storeCommPct: number;
  vatPct: number;
  principal: number;
  storeCommission: number;
  interestTotal: number;
  vatAmount: number;
  financedAmount: number;
  monthlyPayment: number;
  monthOptions: number[];
}

export function PlanDetailsStep({
  selectedProduct,
  interestConfig,
  sellingPrice,
  downPayment,
  setDownPayment,
  setDownPaymentTouched,
  totalMonths,
  setTotalMonths,
  minDownPct,
  minMonths,
  maxMonths,
  notes,
  setNotes,
  paymentDueDay,
  setPaymentDueDay,
  interestRate,
  storeCommPct,
  vatPct,
  principal,
  storeCommission,
  interestTotal,
  vatAmount,
  financedAmount,
  monthlyPayment,
  monthOptions,
}: PlanDetailsStepProps) {
  return (
    <div className="max-w-xl">
      <div className="rounded-lg border p-6 space-y-4">
        {/* Interest Config Badge */}
        {interestConfig && (
          <div className="bg-primary/5 border border-primary/30 rounded-lg p-3 flex items-center gap-2">
            <span className="text-xs text-primary">ใช้ดอกเบี้ยตาม:</span>
            <span className="text-sm font-medium text-primary">{interestConfig.name}</span>
            <span className="text-xs text-primary">({(interestRate * 100).toFixed(1)}% | ดาวน์ขั้นต่ำ {(minDownPct * 100).toFixed(0)}% | {minMonths}-{maxMonths} เดือน)</span>
          </div>
        )}


        <div className="bg-muted rounded-lg p-4">
          <div className="text-sm font-medium text-foreground mb-2">สินค้า: {selectedProduct?.brand} {selectedProduct?.model}</div>
          <div className="text-lg font-bold text-primary">{sellingPrice.toLocaleString()} ฿</div>
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-1">เงินดาวน์</label>
          <input
            type="number"
            value={downPayment}
            onChange={(e) => { setDownPaymentTouched(true); setDownPayment(Number(e.target.value)); }}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm"
            min={0}
          />
          <div className="text-xs text-muted-foreground mt-1">ขั้นต่ำ {(minDownPct * 100).toFixed(0)}% = {(sellingPrice * minDownPct).toLocaleString()} ฿</div>
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-1">จำนวนงวด (เดือน)</label>
          <select value={totalMonths} onChange={(e) => setTotalMonths(Number(e.target.value))} className="w-full px-3 py-2 border border-input rounded-lg text-sm">
            {monthOptions.map((m) => (
              <option key={m} value={m}>{m} เดือน</option>
            ))}
          </select>
        </div>

        {/* Payment Due Day */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">วันที่ครบกำหนดชำระ (ตามวันเงินเดือนออก)</label>
          <select
            value={paymentDueDay}
            onChange={(e) => setPaymentDueDay(Number(e.target.value))}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm"
          >
            {[...Array.from({ length: 28 }, (_, i) => i + 1), 31].map((d) => (
              <option key={d} value={d}>{d === 31 ? 'สิ้นเดือน (วันสุดท้ายของเดือน)' : `วันที่ ${d} ของทุกเดือน`}</option>
            ))}
          </select>
          <div className="text-xs text-muted-foreground mt-1">ลูกค้าจะต้องชำระเงิน{paymentDueDay === 31 ? 'ทุกสิ้นเดือน' : `ทุกวันที่ ${paymentDueDay} ของเดือน`}</div>
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-1">หมายเหตุ</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm"
          />
        </div>

        {/* Calculation Summary */}
        <div className="bg-primary/5 rounded-lg p-4 space-y-2">
          <h3 className="text-sm font-semibold text-primary">สรุปการคำนวณ</h3>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">ราคาขาย</span>
            <span>{sellingPrice.toLocaleString()} ฿</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">เงินดาวน์</span>
            <span>-{downPayment.toLocaleString()} ฿</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">ยอดปล่อย (Loan)</span>
            <span>{principal.toLocaleString()} ฿</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">ค่าคอมหน้าร้าน ({(storeCommPct * 100).toFixed(0)}%)</span>
            <span>{storeCommission.toLocaleString(undefined, { maximumFractionDigits: 0 })} ฿</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">ดอกเบี้ยรวม ({(interestRate * 100).toFixed(1)}% x {totalMonths} เดือน)</span>
            <span>{interestTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })} ฿</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">VAT ({(vatPct * 100).toFixed(0)}%)</span>
            <span>{vatAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })} ฿</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">รวมยอดจัดไฟแนนซ์</span>
            <span>{financedAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })} ฿</span>
          </div>
          <div className="border-t pt-2 flex justify-between text-base font-bold text-primary">
            <span>ค่างวด/เดือน</span>
            <span>{monthlyPayment.toLocaleString()} ฿</span>
          </div>
          <div className="text-xs text-muted-foreground text-right">ชำระ{paymentDueDay === 31 ? 'ทุกสิ้นเดือน' : `ทุกวันที่ ${paymentDueDay}`}</div>
        </div>
      </div>
    </div>
  );
}
