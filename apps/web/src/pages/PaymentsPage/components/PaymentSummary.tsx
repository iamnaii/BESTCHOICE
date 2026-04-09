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
      {/* Date Selector */}
      <div className="flex items-center gap-3 mb-6">
        <label className="text-sm font-medium text-foreground">วันที่:</label>
        <ThaiDateInput
          value={summaryDate}
          onChange={(e) => onDateChange(e.target.value)}
          className="px-3 py-2 border border-input rounded-lg text-sm bg-background outline-none focus:ring-2 focus:ring-ring/30"
        />
      </div>

      {loadingSummary ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : summary ? (
        <div>
          {/* Summary KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <Card className="hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 overflow-hidden">
              <CardContent className="p-5 relative">
                <div className="absolute inset-y-0 left-0 w-1 bg-primary rounded-l-xl" />
                <div className="pl-2">
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">จำนวนรายการ</div>
                  <div className="text-2xl font-bold text-foreground tabular-nums">{summary.totalPayments}</div>
                </div>
              </CardContent>
            </Card>
            <Card className="hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 overflow-hidden">
              <CardContent className="p-5 relative">
                <div className="absolute inset-y-0 left-0 w-1 bg-success rounded-l-xl" />
                <div className="pl-2">
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ยอดรวม</div>
                  <div className="text-2xl font-bold text-success tabular-nums">{summary.totalAmount.toLocaleString()} ฿</div>
                </div>
              </CardContent>
            </Card>
            <Card className="hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 overflow-hidden">
              <CardContent className="p-5 relative">
                <div className="absolute inset-y-0 left-0 w-1 bg-destructive rounded-l-xl" />
                <div className="pl-2">
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ค่าปรับรวม</div>
                  <div className="text-2xl font-bold text-destructive tabular-nums">{summary.totalLateFees.toLocaleString()} ฿</div>
                </div>
              </CardContent>
            </Card>
            <Card className="hover:shadow-md transition-all duration-200 overflow-hidden">
              <CardContent className="p-5 relative">
                <div className="absolute inset-y-0 left-0 w-1 bg-info rounded-l-xl" />
                <div className="pl-2">
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">แยกตามวิธี</div>
                  <div className="space-y-1 mt-1">
                    {Object.entries(summary.byMethod).map(([method, amount]) => (
                      <div key={method} className="flex justify-between items-center text-xs">
                        <span className="text-muted-foreground">{methodLabels[method] || method}</span>
                        <span className="font-semibold text-foreground tabular-nums">{(amount as number).toLocaleString()} ฿</span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Payment Table */}
          {summary.data.length > 0 && (
            <Card className="overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/40 border-b border-border/60">
                      <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">สัญญา</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">ลูกค้า</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">งวดที่</th>
                      <th className="text-right px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">ยอดชำระ</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">วิธี</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">เวลา</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">ผู้บันทึก</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {summary.data.map((p: DailySummaryPayment) => (
                      <tr key={p.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-5 py-3.5 font-mono text-xs text-primary font-semibold">{p.contract?.contractNumber}</td>
                        <td className="px-5 py-3.5 text-sm font-medium text-foreground">{p.contract?.customer?.name}</td>
                        <td className="px-5 py-3.5 text-sm text-muted-foreground">งวดที่ {p.installmentNo}</td>
                        <td className="px-5 py-3.5 text-right text-sm font-semibold text-success tabular-nums">{Number(p.amountPaid).toLocaleString()} ฿</td>
                        <td className="px-5 py-3.5">
                          <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                            {methodLabels[p.paymentMethod] || p.paymentMethod}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-xs text-muted-foreground">{p.paidDate ? new Date(p.paidDate).toLocaleTimeString('th-TH') : '—'}</td>
                        <td className="px-5 py-3.5 text-xs text-muted-foreground">{p.recordedBy?.name || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      ) : null}
    </div>
  );
}
