/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';

interface DailySummary {
  date: string;
  totalPayments: number;
  totalAmount: number;
  totalLateFees: number;
  byMethod: Record<string, number>;
  data: any[];
}

const methodLabels: Record<string, string> = {
  CASH: 'เงินสด',
  BANK_TRANSFER: 'โอนเงิน',
  QR_EWALLET: 'QR/E-Wallet',
};

export default function PaymentSummaryTab() {
  const [summaryDate, setSummaryDate] = useState(new Date().toISOString().split('T')[0]);

  const { data: summary, isLoading: loadingSummary } = useQuery<DailySummary>({
    queryKey: ['daily-summary', summaryDate],
    queryFn: async () => {
      const { data } = await api.get(`/payments/daily-summary?date=${summaryDate}`);
      return data;
    },
  });

  return (
    <div>
      <div className="mb-4">
        <input type="date" value={summaryDate} onChange={(e) => setSummaryDate(e.target.value)} className="px-3 py-2 border border-input rounded-lg text-sm" />
      </div>

      {loadingSummary ? (
        <div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div></div>
      ) : summary ? (
        <div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-5 lg:gap-7.5 mb-6">
            <Card><CardContent><div className="text-xs text-muted-foreground mb-1">จำนวนรายการ</div><div className="text-2xl font-bold">{summary.totalPayments}</div></CardContent></Card>
            <Card><CardContent><div className="text-xs text-muted-foreground mb-1">ยอดรวม</div><div className="text-2xl font-bold text-green-600">{summary.totalAmount.toLocaleString()} ฿</div></CardContent></Card>
            <Card><CardContent><div className="text-xs text-muted-foreground mb-1">ค่าปรับรวม</div><div className="text-2xl font-bold text-red-600">{summary.totalLateFees.toLocaleString()} ฿</div></CardContent></Card>
            <Card>
              <CardContent>
                <div className="text-xs text-muted-foreground mb-1">แยกตามวิธี</div>
                {Object.entries(summary.byMethod).map(([method, amount]) => (
                  <div key={method} className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{methodLabels[method] || method}</span>
                    <span className="font-medium">{amount.toLocaleString()} ฿</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

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
                  {summary.data.map((p: any) => (
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
