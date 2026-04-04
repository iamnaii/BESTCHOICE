import api from '@/lib/api';
import { formatDateShort } from '@/utils/formatters';
import { PurchaseOrder, PODetail } from '../types';
import { paymentStatusLabels, paymentStatusColors } from '../constants';

export interface AccountsPayableTabProps {
  payableData: {
    grandTotal: number;
    suppliers: {
      supplier: { id: string; name: string; contactName: string; phone: string };
      totalNet: number;
      totalPaid: number;
      totalRemaining: number;
      poCount: number;
      pos: { id: string; poNumber: string; orderDate: string; dueDate: string | null; netAmount: number; paidAmount: number; remaining: number; paymentStatus: string; status: string; itemsSummary: string }[];
    }[];
  } | undefined;
  onOpenDetail: (po: PurchaseOrder, detail: PODetail) => void;
}

export function AccountsPayableTab({ payableData, onOpenDetail }: AccountsPayableTabProps) {
  return (
    <div className="flex flex-col gap-5 lg:gap-7.5">
      {/* Grand Total */}
      <div className="bg-destructive/5 dark:bg-destructive/10 border border-destructive/20 rounded-xl p-4 flex items-center justify-between">
        <div>
          <div className="text-sm text-destructive font-medium">ยอดค้างจ่ายทั้งหมด</div>
          <div className="text-2xl font-bold text-destructive">{(payableData?.grandTotal || 0).toLocaleString()} บาท</div>
        </div>
        <div className="text-sm text-red-500">
          {payableData?.suppliers.length || 0} ผู้ขาย, {payableData?.suppliers.reduce((sum, s) => sum + s.poCount, 0) || 0} ใบ PO
        </div>
      </div>

      {/* Per-supplier Breakdown */}
      {payableData?.suppliers.map((entry) => (
        <div key={entry.supplier.id} className="border border-border rounded-xl overflow-hidden">
          {/* Supplier Header */}
          <div className="px-4 py-3 bg-muted border-b flex items-center justify-between">
            <div>
              <div className="font-medium text-foreground">{entry.supplier.name}</div>
              <div className="text-xs text-muted-foreground">{entry.supplier.contactName} | {entry.supplier.phone}</div>
            </div>
            <div className="text-right">
              <div className="text-lg font-bold text-destructive">{(Number(entry.totalRemaining) || 0).toLocaleString()} บาท</div>
              <div className="text-xs text-muted-foreground">จาก {(Number(entry.totalNet) || 0).toLocaleString()} (จ่ายแล้ว {(Number(entry.totalPaid) || 0).toLocaleString()})</div>
            </div>
          </div>
          {/* PO List */}
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground border-b">
                <th className="px-4 py-2 text-left">เลข PO</th>
                <th className="px-4 py-2 text-left">วันที่สั่ง</th>
                <th className="px-4 py-2 text-left">ครบกำหนด</th>
                <th className="px-4 py-2 text-left">รายการ</th>
                <th className="px-4 py-2 text-right">ยอดสุทธิ</th>
                <th className="px-4 py-2 text-right">จ่ายแล้ว</th>
                <th className="px-4 py-2 text-right">คงค้าง</th>
                <th className="px-4 py-2 text-center">สถานะจ่าย</th>
              </tr>
            </thead>
            <tbody>
              {entry.pos.map((po) => (
                <tr key={po.id} className="border-b last:border-0 hover:bg-muted">
                  <td className="px-4 py-2">
                    <button onClick={async () => { try { const { data } = await api.get(`/purchase-orders/${po.id}`); onOpenDetail(data, data); } catch {} }} className="text-primary hover:underline font-medium">
                      {po.poNumber}
                    </button>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{formatDateShort(po.orderDate)}</td>
                  <td className="px-4 py-2">
                    {po.dueDate ? (
                      <span className={`text-sm ${new Date(po.dueDate) < new Date() ? 'text-destructive font-semibold' : 'text-muted-foreground'}`}>
                        {formatDateShort(po.dueDate)}
                        {new Date(po.dueDate) < new Date() && <span className="ml-1 text-xs bg-destructive/10 text-destructive dark:bg-destructive/15 px-1.5 py-0.5 rounded-full">เลยกำหนด</span>}
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs">-</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground truncate max-w-[200px]" title={po.itemsSummary}>{po.itemsSummary}</td>
                  <td className="px-4 py-2 text-right">{(Number(po.netAmount) || 0).toLocaleString()}</td>
                  <td className="px-4 py-2 text-right text-success">{(Number(po.paidAmount) || 0).toLocaleString()}</td>
                  <td className="px-4 py-2 text-right font-medium text-destructive">{(Number(po.remaining) || 0).toLocaleString()}</td>
                  <td className="px-4 py-2 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${paymentStatusColors[po.paymentStatus] || 'bg-muted text-foreground'}`}>
                      {paymentStatusLabels[po.paymentStatus] || po.paymentStatus}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {payableData && payableData.suppliers.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">ไม่มียอดค้างจ่าย - จ่ายครบทุก PO แล้ว</div>
      )}
    </div>
  );
}
