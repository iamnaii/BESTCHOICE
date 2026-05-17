import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams, useNavigate } from 'react-router';
import api from '@/lib/api';
import { ArrowLeft, Printer, FileSpreadsheet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { formatNumberDecimal } from '@/utils/formatters';
import { computeDefaultTimeRange, formatThaiDateLong } from '@/lib/date';
import { useAuth } from '@/contexts/AuthContext';
import { useUiFlags } from '@/hooks/useUiFlags';

// ─── Types ─────────────────────────────────────────────────────────────
interface ExpenseDocumentRow {
  id: string;
  number: string;
  documentType: 'EXPENSE' | 'CREDIT_NOTE' | 'PAYROLL' | 'VENDOR_SETTLEMENT';
  vendorName: string | null;
  totalAmount: string;
  netPayment: string | null;
  paymentMethod: string | null;
  depositAccountCode: string | null;
  expenseDetail: { category: string } | null;
  creditNote: { category: string } | null;
}

interface Summary {
  date: string;
  branchId: string;
  branchName: string | null;
  documents: ExpenseDocumentRow[];
  grandTotal: string;
  byType: Record<string, { count: number; total: string }>;
  byPaymentMethod: Record<string, { count: number; total: string }>;
  byCategory: Record<string, { count: number; total: string }>;
  cashMovement: Record<string, { out: string; count: number }>;
}

const TYPE_LABELS: Record<string, string> = {
  EXPENSE: 'รายจ่าย (EX)',
  CREDIT_NOTE: 'ใบลดหนี้ (CN)',
  PAYROLL: 'เงินเดือน (PR)',
  VENDOR_SETTLEMENT: 'จ่ายเจ้าหนี้ (SE)',
};
const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: 'เงินสด',
  BANK_TRANSFER: 'โอนธนาคาร',
  QR_EWALLET: 'QR/E-Wallet',
};

export default function ExpenseDailySummaryPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  // D1.3.5.1 — initial date driven by OWNER-configured `summary_default_range`.
  // The summary page renders ONE calendar day at a time (single-date API), so
  // we use the preset's endDate (latest day of the preferred period) as the
  // initial pick: 'today' → today; 'this_week'/'this_month' → today (also
  // their endDate); 'last_month' → last day of the previous month. The lazy
  // useState initializer captures the value once; mid-session preset changes
  // don't override user picks. URL `?date=` query param wins over the preset.
  const { summaryDefaultRange } = useUiFlags();
  const [date, setDate] = useState<string>(() => {
    const urlDate = searchParams.get('date');
    if (urlDate) return urlDate;
    const { endDate } = computeDefaultTimeRange(summaryDefaultRange);
    // endDate is always non-empty for the summary preset whitelist (no 'all').
    return endDate || new Date().toISOString().slice(0, 10);
  });
  const [branchId, setBranchId] = useState<string>(
    searchParams.get('branchId') ?? user?.branchId ?? '',
  );

  const { data: branches } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['branches'],
    queryFn: async () => (await api.get('/branches')).data,
  });

  const { data: summary, isLoading } = useQuery<Summary>({
    queryKey: ['daily-summary', date, branchId],
    queryFn: async () =>
      (await api.get(`/expense-documents/daily-summary?date=${date}&branchId=${branchId}`)).data,
    enabled: !!branchId && !!date,
  });

  const handlePrint = () => window.print();

  const handleExportExcel = async () => {
    if (!summary) return;
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const sh1 = wb.addWorksheet('รายการเอกสาร');
    sh1.addRow(['เลข', 'ประเภท', 'ผู้ขาย', 'หมวดบัญชี', 'ยอด', 'วิธีจ่าย']);
    summary.documents.forEach((d) => {
      sh1.addRow([
        d.number,
        TYPE_LABELS[d.documentType] ?? d.documentType,
        d.vendorName ?? '',
        d.expenseDetail?.category ?? d.creditNote?.category ?? '',
        d.totalAmount,
        d.paymentMethod ? (PAYMENT_METHOD_LABELS[d.paymentMethod] ?? d.paymentMethod) : '',
      ]);
    });

    const sh2 = wb.addWorksheet('สรุปยอด');
    sh2.addRow(['ตามประเภท', 'จำนวน', 'รวม']);
    Object.entries(summary.byType).forEach(([k, v]) =>
      sh2.addRow([TYPE_LABELS[k] ?? k, v.count, v.total]),
    );
    sh2.addRow([]);
    sh2.addRow(['ตามวิธีจ่าย', 'จำนวน', 'รวม']);
    Object.entries(summary.byPaymentMethod).forEach(([k, v]) =>
      sh2.addRow([PAYMENT_METHOD_LABELS[k] ?? k, v.count, v.total]),
    );
    sh2.addRow([]);
    sh2.addRow(['เงินสด/ธนาคาร', 'จำนวนครั้ง', 'ยอดออก']);
    Object.entries(summary.cashMovement).forEach(([k, v]) =>
      sh2.addRow([k, v.count, v.out]),
    );
    sh2.addRow([]);
    sh2.addRow(['รวมทั้งสิ้น', '', summary.grandTotal]);

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeBranch = (summary.branchName ?? 'all').replace(/[^A-Za-z0-9ก-๙_-]+/g, '_');
    a.download = `daily-summary-${date.replace(/-/g, '')}-${safeBranch}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto print:p-0 print:max-w-none">
      {/* Header — hidden in print */}
      <div className="print:hidden flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/expenses')}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> กลับ
          </button>
          <h1 className="text-base font-semibold">ใบสรุปรายจ่ายประจำวัน</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <ThaiDateInput value={date} onChange={(e) => setDate(e.target.value)} />
          {branches && branches.length > 1 && (
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className="px-3 py-2 border border-input rounded-lg text-sm bg-background"
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}
          <Button variant="outline" size="sm" onClick={handlePrint} disabled={!summary}>
            <Printer className="size-4" /> พิมพ์
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportExcel} disabled={!summary}>
            <FileSpreadsheet className="size-4" /> Excel
          </Button>
        </div>
      </div>

      {/* Print-only header */}
      <div className="hidden print:block mb-4">
        <h1 className="text-lg font-bold text-center">ใบสรุปรายจ่ายประจำวัน</h1>
        <div className="text-center text-sm">
          วันที่ {formatThaiDateLong(date)} · สาขา {summary?.branchName ?? '-'}
        </div>
        <div className="text-center text-xs text-muted-foreground">
          ผู้จัดทำ: {user?.name ?? '-'}
        </div>
      </div>

      {!branchId ? (
        <div className="text-center py-12 text-muted-foreground">กรุณาเลือกสาขา</div>
      ) : isLoading ? (
        <div className="text-center py-12 text-muted-foreground">กำลังโหลด...</div>
      ) : !summary ? (
        <div className="text-center py-12 text-muted-foreground">ไม่พบข้อมูลในวันที่เลือก</div>
      ) : (
        <div className="space-y-6">
          {/* Documents table */}
          <div className="border border-border rounded-xl overflow-hidden bg-card">
            <div className="px-4 py-3 border-b border-border text-sm font-medium">
              รายการเอกสาร ({summary.documents.length} รายการ)
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30">
                  <tr className="border-b border-border">
                    <th className="text-left p-2">เลข</th>
                    <th className="text-left p-2">ประเภท</th>
                    <th className="text-left p-2">ผู้ขาย</th>
                    <th className="text-left p-2">บัญชี</th>
                    <th className="text-right p-2">ยอด</th>
                    <th className="text-left p-2">จ่ายโดย</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.documents.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="p-6 text-center text-muted-foreground"
                      >
                        ไม่มีเอกสารในวันนี้
                      </td>
                    </tr>
                  ) : (
                    summary.documents.map((d) => (
                      <tr key={d.id} className="border-b border-border last:border-0">
                        <td className="p-2 font-mono">{d.number}</td>
                        <td className="p-2">{TYPE_LABELS[d.documentType] ?? d.documentType}</td>
                        <td className="p-2">{d.vendorName ?? '–'}</td>
                        <td className="p-2 font-mono text-xs">
                          {d.expenseDetail?.category ?? d.creditNote?.category ?? '-'}
                        </td>
                        <td className="p-2 text-right font-mono">
                          {formatNumberDecimal(d.totalAmount)}
                        </td>
                        <td className="p-2">
                          {d.paymentMethod
                            ? (PAYMENT_METHOD_LABELS[d.paymentMethod] ?? d.paymentMethod)
                            : '-'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot className="bg-muted font-semibold">
                  <tr>
                    <td colSpan={4} className="p-2 text-right">
                      รวมทั้งสิ้น
                    </td>
                    <td className="p-2 text-right font-mono">
                      {formatNumberDecimal(summary.grandTotal)}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Totals grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 print:grid-cols-2">
            <div className="border border-border rounded-xl p-4 bg-card">
              <h3 className="text-sm font-semibold mb-3">รวมตามประเภท</h3>
              {Object.keys(summary.byType).length === 0 ? (
                <div className="text-xs text-muted-foreground">—</div>
              ) : (
                <table className="w-full text-sm">
                  <tbody>
                    {Object.entries(summary.byType).map(([k, v]) => (
                      <tr key={k} className="border-b border-border last:border-0">
                        <td className="py-1.5">{TYPE_LABELS[k] ?? k}</td>
                        <td className="py-1.5 text-right text-muted-foreground">
                          {v.count} รายการ
                        </td>
                        <td className="py-1.5 text-right font-mono">
                          {formatNumberDecimal(v.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="border border-border rounded-xl p-4 bg-card">
              <h3 className="text-sm font-semibold mb-3">รวมตามวิธีจ่าย</h3>
              {Object.keys(summary.byPaymentMethod).length === 0 ? (
                <div className="text-xs text-muted-foreground">—</div>
              ) : (
                <table className="w-full text-sm">
                  <tbody>
                    {Object.entries(summary.byPaymentMethod).map(([k, v]) => (
                      <tr key={k} className="border-b border-border last:border-0">
                        <td className="py-1.5">{PAYMENT_METHOD_LABELS[k] ?? k}</td>
                        <td className="py-1.5 text-right text-muted-foreground">
                          {v.count} รายการ
                        </td>
                        <td className="py-1.5 text-right font-mono">
                          {formatNumberDecimal(v.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Category breakdown — optional */}
          {Object.keys(summary.byCategory).length > 0 && (
            <div className="border border-border rounded-xl p-4 bg-card">
              <h3 className="text-sm font-semibold mb-3">รวมตามหมวดบัญชี</h3>
              <table className="w-full text-sm">
                <tbody>
                  {Object.entries(summary.byCategory).map(([k, v]) => (
                    <tr key={k} className="border-b border-border last:border-0">
                      <td className="py-1.5 font-mono text-xs">{k}</td>
                      <td className="py-1.5 text-right text-muted-foreground">
                        {v.count} รายการ
                      </td>
                      <td className="py-1.5 text-right font-mono">
                        {formatNumberDecimal(v.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Cash movement */}
          {Object.keys(summary.cashMovement).length > 0 && (
            <div className="border border-border rounded-xl p-4 bg-card">
              <h3 className="text-sm font-semibold mb-3">เงินสด/ธนาคาร เคลื่อนไหววันนี้</h3>
              <table className="w-full text-sm">
                <tbody>
                  {Object.entries(summary.cashMovement).map(([k, v]) => (
                    <tr key={k} className="border-b border-border last:border-0">
                      <td className="py-1.5 font-mono text-xs">{k}</td>
                      <td className="py-1.5 text-right text-muted-foreground">
                        ออก {v.count} ครั้ง
                      </td>
                      <td className="py-1.5 text-right font-mono text-destructive">
                        ({formatNumberDecimal(v.out)})
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Signature footer (visible in print) */}
          <div className="grid grid-cols-3 gap-8 mt-12 pt-8 print:mt-12 print:pt-8 text-sm">
            <div className="text-center">
              <div className="border-t border-foreground pt-2">ผู้จัดทำ</div>
              <div className="text-xs text-muted-foreground mt-1">{user?.name ?? ''}</div>
            </div>
            <div className="text-center">
              <div className="border-t border-foreground pt-2">ผู้ตรวจสอบ</div>
            </div>
            <div className="text-center">
              <div className="border-t border-foreground pt-2">ผู้อนุมัติ</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
