import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, FileSpreadsheet, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import api, { getErrorMessage } from '@/lib/api';
import { exportToExcel } from '@/utils/excel.util';
import type { DailySummary, DailySummaryPayment } from '../types';
import { methodLabels } from '../types';

/** เลื่อนวันแบบ string ล้วน (YYYY-MM-DD) — สร้าง Date จาก parts เสมอ ไม่ parse
 *  string ตรง ๆ (new Date('YYYY-MM-DD') ตีความเป็น UTC เที่ยงคืน ทำวันเพี้ยนบน
 *  เครื่องโซน +07). ข้ามขอบเดือน/ปี Date จัดการเอง. */
function shiftDay(date: string, delta: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(y, m - 1, d + delta);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(
    next.getDate(),
  ).padStart(2, '0')}`;
}

const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
/** '2026-08-16' → '16 ส.ค.' — ป้ายสั้นบน chip. */
function chipLabel(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${d} ${THAI_MONTHS[m - 1]}`;
}

interface SummaryDay {
  date: string;
  count: number;
  total: number;
}

/** ใบเสร็จที่ไม่ผูกงวด (ดาวน์ / ปิดยอด / ปรับดิว) — แสดงชนิดเอกสารแทนเลขงวด. */
const RECEIPT_TYPE_LABELS: Record<string, string> = {
  DOWN_PAYMENT: 'เงินดาวน์',
  EARLY_PAYOFF: 'ปิดยอด',
  RESCHEDULE_FEE: 'ค่าปรับดิว',
};

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
  // "วันไหนมีสมุดบ้าง" — chips ของเดือนที่เลือก. keyed by month so stepping days
  // within one month reuses the cache; invalidatePaymentQueries refreshes it
  // after a void/record so the chips never go stale.
  const summaryMonth = summaryDate.slice(0, 7);
  const { data: availableDays = [] } = useQuery<SummaryDay[]>({
    queryKey: ['daily-summary-dates', summaryMonth],
    queryFn: async () =>
      (await api.get(`/payments/daily-summary/dates?month=${summaryMonth}`)).data.days ?? [],
    staleTime: 60_000,
  });

  // ส่งออก Excel — ยึดวันที่เลือกฝั่งซ้าย (owner 2026-08-19 รอบสอง: "เอาช่วงวันที่
  // กรองฝั่งซ้ายอยู่แล้วก็ได้ ไม่ต้องกรองซ้ำอีกฝั่งขวา"). แท็บนี้มีตัวกรองวันเดียว —
  // export ตามมัน ผ่าน range endpoint ด้วย from = to = วันนั้น (ได้ครบทุกใบของวัน
  // ไม่ติด pagination ของหน้าจอ; ตัว endpoint ยังรองรับช่วงเผื่ออนาคต).
  const [exporting, setExporting] = useState(false);
  const handleExportRange = async () => {
    setExporting(true);
    try {
      const { data } = await api.get(
        `/payments/daily-summary/export?from=${summaryDate}&to=${summaryDate}`,
      );
      const rows = (data.rows ?? []) as Array<{
        receiptNumber: string;
        receiptType: string;
        amount: string;
        installmentNo: number | null;
        paymentMethod: string | null;
        paidDate: string;
        issuedByName: string | null;
        contract?: { contractNumber: string; customer?: { name: string }; branch?: { name: string } };
      }>;
      await exportToExcel({
        columns: [
          { header: 'วันที่รับเงิน', key: 'paidDate', width: 14 },
          { header: 'เวลา', key: 'paidTime', width: 10 },
          { header: 'เลขที่ใบเสร็จ', key: 'receiptNumber', width: 18 },
          { header: 'สัญญา', key: 'contractNumber', width: 20 },
          { header: 'ลูกค้า', key: 'customer', width: 22 },
          { header: 'งวด/ประเภท', key: 'installment', width: 14 },
          { header: 'ยอดรับจริง', key: 'amount', width: 14 },
          { header: 'วิธี', key: 'method', width: 12 },
          { header: 'ผู้บันทึก', key: 'issuedBy', width: 18 },
          { header: 'สาขา', key: 'branch', width: 14 },
        ],
        data: rows.map((r) => ({
          paidDate: new Date(r.paidDate).toLocaleDateString('th-TH'),
          paidTime: new Date(r.paidDate).toLocaleTimeString('th-TH'),
          receiptNumber: r.receiptNumber,
          contractNumber: r.contract?.contractNumber ?? '—',
          customer: r.contract?.customer?.name ?? '—',
          // ใบที่ไม่ใช่เงินงวดแท้ (ดาวน์/ปิดยอด/ปรับดิว) label ด้วยชนิดเอกสาร
          // แม้จะผูกเลขงวดไว้ — ยอดพวกนี้ไม่ใช่ค่างวดของงวดนั้นตรง ๆ.
          installment:
            RECEIPT_TYPE_LABELS[r.receiptType] ??
            (r.installmentNo != null ? `งวดที่ ${r.installmentNo}` : '—'),
          amount: Number(r.amount).toLocaleString(),
          method: methodLabels[r.paymentMethod ?? ''] || r.paymentMethod || '—',
          issuedBy: r.issuedByName ?? '—',
          branch: r.contract?.branch?.name ?? '—',
        })),
        sheetName: 'สรุปรายวัน',
        filename: `daily-summary-${summaryDate.replace(/-/g, '')}.xlsx`,
      });
      if (data.truncated) {
        toast.warning(
          `ส่งออกได้ ${rows.length.toLocaleString('th-TH')} รายการ (ครบเพดาน) — ปรับช่วงวันให้แคบลงเพื่อส่งออกครบ`,
        );
      } else {
        toast.success('ส่งออก Excel สำเร็จ');
      }
    } catch (err) {
      toast.error(getErrorMessage(err) || 'ส่งออก Excel ไม่สำเร็จ');
    } finally {
      setExporting(false);
    }
  };
  return (
    <div>
      {/* Date Selector + วันที่มีรายการ (owner 2026-08-19: เดิมต้องเดาวันเอง) */}
      <div className="mb-6 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-sm font-medium text-foreground">วันที่:</label>
          <button
            type="button"
            aria-label="วันก่อนหน้า"
            onClick={() => onDateChange(shiftDay(summaryDate, -1))}
            className="p-2 rounded-lg border border-input text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <ChevronLeft className="size-4" />
          </button>
          <ThaiDateInput
            value={summaryDate}
            onChange={(e) => onDateChange(e.target.value)}
            className="px-3 py-2 border border-input rounded-lg text-sm bg-background outline-hidden focus:ring-2 focus:ring-ring/30"
          />
          <button
            type="button"
            aria-label="วันถัดไป"
            onClick={() => onDateChange(shiftDay(summaryDate, 1))}
            className="p-2 rounded-lg border border-input text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <ChevronRight className="size-4" />
          </button>

          {/* ส่งออก Excel — ยึดวันที่ที่กรองอยู่ (ตัวกรองเดียว ไม่มี picker ซ้ำ) */}
          <button
            type="button"
            onClick={handleExportRange}
            disabled={exporting}
            title={`ส่งออกใบเสร็จของวันที่เลือก`}
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-input text-foreground hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {exporting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <FileSpreadsheet className="size-4" />
            )}
            ส่งออก Excel
          </button>
        </div>
        {availableDays.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-muted-foreground leading-snug">วันที่มีรายการ:</span>
            {availableDays.map((d) => (
              <button
                key={d.date}
                type="button"
                onClick={() => onDateChange(d.date)}
                title={`${d.total.toLocaleString()} ฿`}
                className={
                  d.date === summaryDate
                    ? 'px-2 py-0.5 rounded-full text-xs font-medium bg-primary text-primary-foreground'
                    : 'px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground hover:bg-accent hover:text-foreground transition-colors'
                }
              >
                {chipLabel(d.date)} ({d.count} ใบ)
              </button>
            ))}
          </div>
        )}
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
                      <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">เลขที่ใบเสร็จ</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">สัญญา</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">ลูกค้า</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">งวดที่</th>
                      <th className="text-right px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">ยอดรับจริง</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">วิธี</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">เวลา</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">ผู้บันทึก</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {summary.data.map((p: DailySummaryPayment) => (
                      <tr key={p.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-5 py-3.5 font-mono text-xs text-muted-foreground">{p.receiptNumber}</td>
                        <td className="px-5 py-3.5 font-mono text-xs text-primary font-semibold">{p.contract?.contractNumber}</td>
                        <td className="px-5 py-3.5 text-sm font-medium text-foreground">{p.contract?.customer?.name}</td>
                        <td className="px-5 py-3.5 text-sm text-muted-foreground">
                          {p.installmentNo != null ? `งวดที่ ${p.installmentNo}` : RECEIPT_TYPE_LABELS[p.receiptType] || '—'}
                        </td>
                        <td className="px-5 py-3.5 text-right text-sm font-semibold text-success tabular-nums">{Number(p.amount).toLocaleString()} ฿</td>
                        <td className="px-5 py-3.5">
                          <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                            {methodLabels[p.paymentMethod ?? ''] || p.paymentMethod || '—'}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-xs text-muted-foreground">{p.paidDate ? new Date(p.paidDate).toLocaleTimeString('th-TH') : '—'}</td>
                        <td className="px-5 py-3.5 text-xs text-muted-foreground">{p.issuedByName || '—'}</td>
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
