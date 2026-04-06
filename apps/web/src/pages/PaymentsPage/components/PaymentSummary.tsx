import { Card, CardContent } from '@/components/ui/card';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import type { DailySummary, DailySummaryPayment } from '../types';
import { methodLabels } from '../types';

interface PaymentSummaryProps {
  summaryDate: string;
  onDateChange: (date: string) => void;
  summary: DailySummary | undefined;
  loadingSummary: boolean;
}

export default function PaymentSummary({
  summaryDate,
  onDateChange,
  summary,
  loadingSummary,
}: PaymentSummaryProps) {
  return (
    <div>
      <div className="mb-4">
        <ThaiDateInput
          value={summaryDate}
          onChange={(e) => onDateChange(e.target.value)}
          className="px-3 py-2 border border-input rounded-lg text-sm"
        />
      </div>

      {loadingSummary ? (
        <div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div></div>
      ) : summary ? (
        <div>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 lg:gap-5 mb-6">
            <Card className="hover:shadow-card-hover transition-shadow">
              <CardContent className="p-5">
                <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">จำนวนรายการ</div>
                <div className="text-2xl font-bold">{summary.totalPayments}</div>
              </CardContent>
            </Card>
            <Card className="hover:shadow-card-hover transition-shadow">
              <CardContent className="p-5">
                <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ยอดรวม</div>
                <div className="text-2xl font-bold text-success">{summary.totalAmount.toLocaleString()} ฿</div>
              </CardContent>
            </Card>
            <Card className="hover:shadow-card-hover transition-shadow">
              <CardContent className="p-5">
                <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ค่าปรับรวม</div>
                <div className="text-2xl font-bold text-destructive">{summary.totalLateFees.toLocaleString()} ฿</div>
              </CardContent>
            </Card>
            <Card className="hover:shadow-card-hover transition-shadow">
              <CardContent className="p-5">
                <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">แยกตามวิธี</div>
                {Object.entries(summary.byMethod).map(([method, amount]) => (
                  <div key={method} className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{methodLabels[method] || method}</span>
                    <span className="font-medium">{amount.toLocaleString()} ฿</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          {/* Payment List */}
          {summary.data.length > 0 && (
            <Card className="overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="text-left p-3">สัญญา</th>
                    <th className="text-left p-3">ลูกค้า</th>
                    <th className="text-left p-3">งวดที่</th>
                    <th className="text-right p-3">ยอดชำระ</th>
                    <th className="text-left p-3">วิธี</th>
                    <th className="text-left p-3">เวลา</th>
                    <th className="text-left p-3">ผู้บันทึก</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.data.map((p: DailySummaryPayment) => (
                    <tr key={p.id} className="border-t">
                      <td className="p-3 font-mono text-xs">{p.contract?.contractNumber}</td>
                      <td className="p-3 text-xs">{p.contract?.customer?.name}</td>
                      <td className="p-3">{p.installmentNo}</td>
                      <td className="p-3 text-right font-medium">{Number(p.amountPaid).toLocaleString()} ฿</td>
                      <td className="p-3 text-xs">{methodLabels[p.paymentMethod] || p.paymentMethod}</td>
                      <td className="p-3 text-xs">{p.paidDate ? new Date(p.paidDate).toLocaleTimeString('th-TH') : '-'}</td>
                      <td className="p-3 text-xs">{p.recordedBy?.name || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      ) : null}
    </div>
  );
}
