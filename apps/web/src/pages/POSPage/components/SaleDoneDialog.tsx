import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import SaleReceiptActions from '@/components/sales/SaleReceiptActions';

export interface DoneSale {
  id: string;
  saleNumber: string;
  saleType: string;
  netAmount: string | number;
  downPaymentAmount?: string | number | null;
}

const money = (v: string | number | null | undefined) =>
  Number(v ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * กล่องหลังขายสำเร็จ (ก้อน 4 · 2026-10-23 — mockup `PosDone.dc.html`): แทน toast สำหรับขายสด/ไฟแนนซ์นอก
 * ให้พนักงานพิมพ์ใบเสร็จ / ส่ง LINE / คัดลอกลิงก์ได้ทันที ก่อนกด "ขายต่อ" (= เคลียร์ฟอร์ม). ปิดด้วย Esc/คลิกนอก = ขายต่อ.
 */
export default function SaleDoneDialog({ sale, onClose }: { sale: DoneSale | null; onClose: () => void }) {
  if (!sale) return null;
  const isFinance = sale.saleType === 'EXTERNAL_FINANCE';
  const amountLabel = isFinance ? 'เงินดาวน์ที่รับ' : 'ยอดสุทธิ';
  const amount = isFinance ? sale.downPaymentAmount ?? sale.netAmount : sale.netAmount;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 aria-hidden="true" className="size-5 text-success" />
            ขายสำเร็จ · {sale.saleNumber}
          </DialogTitle>
          <DialogDescription>
            {amountLabel} {money(amount)} บาท — พิมพ์ใบเสร็จหรือส่งให้ลูกค้าได้เลย
          </DialogDescription>
        </DialogHeader>
        <div className="py-1">
          <SaleReceiptActions sale={{ id: sale.id, saleNumber: sale.saleNumber, saleType: sale.saleType }} />
        </div>
        <DialogFooter>
          <Button type="button" variant="primary" onClick={onClose}>ขายต่อ</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
