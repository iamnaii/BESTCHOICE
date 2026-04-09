import type { Product, Customer, InterestConfig, PendingDoc } from '../types';

export interface ContractSummaryPanelProps {
  selectedProduct: Product;
  selectedCustomer: Customer;
  sellingPrice: number;
  downPayment: number;
  totalMonths: number;
  monthlyPayment: number;
  interestRate: number;
  interestConfig: InterestConfig | null | undefined;
  pendingDocs: PendingDoc[];
}

export function ContractSummaryPanel({
  selectedProduct,
  selectedCustomer,
  sellingPrice,
  downPayment,
  totalMonths,
  monthlyPayment,
  interestRate,
  interestConfig,
  pendingDocs,
}: ContractSummaryPanelProps) {
  return (
    <details className="mt-4">
      <summary className="cursor-pointer text-sm font-semibold text-foreground hover:text-primary">สรุปสัญญาก่อนยืนยัน</summary>
      <div className="mt-3 rounded-xl border border-border/50 bg-card p-5 shadow-sm space-y-3">
        <div className="bg-muted/50 rounded-xl p-4 grid grid-cols-2 gap-3 text-sm">
          <div><span className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">สินค้า</span><div className="font-medium mt-0.5">{selectedProduct.brand} {selectedProduct.model}</div></div>
          <div><span className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">ลูกค้า</span><div className="font-medium mt-0.5">{selectedCustomer.name}</div></div>
          <div><span className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">ราคาขาย</span><div className="font-medium tabular-nums font-mono mt-0.5">{sellingPrice.toLocaleString()} ฿</div></div>
          <div><span className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">เงินดาวน์</span><div className="font-medium tabular-nums font-mono mt-0.5">{downPayment.toLocaleString()} ฿</div></div>
          <div><span className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">จำนวนงวด</span><div className="font-medium mt-0.5">{totalMonths} เดือน</div></div>
          <div><span className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">ค่างวด/เดือน</span><div className="font-bold text-primary tabular-nums font-mono mt-0.5">{monthlyPayment.toLocaleString()} ฿</div></div>
          <div><span className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">ดอกเบี้ย</span><div className="font-medium mt-0.5">{(interestRate * 100).toFixed(1)}%{interestConfig ? ` (${interestConfig.name})` : ''}</div></div>
          <div><span className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">เอกสารแนบ</span><div className="font-medium mt-0.5">{pendingDocs.length} ไฟล์</div></div>
        </div>
      </div>
    </details>
  );
}
