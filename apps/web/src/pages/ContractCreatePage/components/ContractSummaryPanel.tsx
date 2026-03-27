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
      <div className="mt-3 rounded-lg border p-4 space-y-3">
        <div className="bg-muted rounded-lg p-3 grid grid-cols-2 gap-2 text-sm">
          <div><span className="text-xs text-muted-foreground">สินค้า</span><div className="font-medium">{selectedProduct.brand} {selectedProduct.model}</div></div>
          <div><span className="text-xs text-muted-foreground">ลูกค้า</span><div className="font-medium">{selectedCustomer.name}</div></div>
          <div><span className="text-xs text-muted-foreground">ราคาขาย</span><div className="font-medium">{sellingPrice.toLocaleString()} ฿</div></div>
          <div><span className="text-xs text-muted-foreground">เงินดาวน์</span><div className="font-medium">{downPayment.toLocaleString()} ฿</div></div>
          <div><span className="text-xs text-muted-foreground">จำนวนงวด</span><div className="font-medium">{totalMonths} เดือน</div></div>
          <div><span className="text-xs text-muted-foreground">ค่างวด/เดือน</span><div className="font-bold text-primary">{monthlyPayment.toLocaleString()} ฿</div></div>
          <div><span className="text-xs text-muted-foreground">ดอกเบี้ย</span><div className="font-medium">{(interestRate * 100).toFixed(1)}%{interestConfig ? ` (${interestConfig.name})` : ''}</div></div>
          <div><span className="text-xs text-muted-foreground">เอกสารแนบ</span><div className="font-medium">{pendingDocs.length} ไฟล์</div></div>
        </div>
      </div>
    </details>
  );
}
