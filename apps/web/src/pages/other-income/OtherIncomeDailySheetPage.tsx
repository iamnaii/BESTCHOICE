import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download, Printer } from 'lucide-react';
import { otherIncomeApi } from '@/lib/otherIncome';
import QueryBoundary from '@/components/QueryBoundary';
import { DateRangeChips } from './components/DateRangeChips';

// "Today" in Asia/Bangkok — guards against UTC server returning yesterday
// between 00:00–07:00 BKK time. Mirrors `todayBangkok()` in OtherIncomeEntryPage.
const todayLocal = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });

const firstOfThisMonth = () => `${todayLocal().slice(0, 7)}-01`;

function fmt(v: string | number | undefined | null) {
  if (v === undefined || v === null) return '—';
  const n = typeof v === 'string' ? parseFloat(v) : v;
  if (isNaN(n)) return '—';
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Summary box sub-component ───────────────────────────────────────────────

interface SummaryBoxProps {
  label: string;
  value: number;
  colorClass: string;
  highlight?: boolean;
}

function SummaryBox({ label, value, colorClass, highlight }: SummaryBoxProps) {
  return (
    <div
      className={`rounded-lg border-2 p-3 ${
        highlight ? 'border-success bg-success/10' : 'border-border bg-card'
      }`}
    >
      <p className="text-xs text-muted-foreground leading-snug">{label}</p>
      <p
        className={`font-mono font-bold mt-1 ${colorClass}`}
        style={{ fontSize: highlight ? 20 : 16 }}
      >
        {fmt(value)} ฿
      </p>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function OtherIncomeDailySheetPage() {
  const navigate = useNavigate();
  const [startDate, setStartDate] = useState<string>(firstOfThisMonth());
  const [endDate, setEndDate] = useState<string>(todayLocal());

  const sheet = useQuery({
    queryKey: ['other-income-daily-sheet', startDate, endDate],
    queryFn: () => otherIncomeApi.dailySheet(startDate, endDate),
    enabled: Boolean(startDate) && Boolean(endDate),
  });

  const exportCsv = () => {
    if (!sheet.data) return;
    const rows: string[][] = [
      ['#', 'เลขเอกสาร', 'เลขใบเสร็จ', 'ลูกค้า / คู่ค้า', 'บัญชีหลัก', 'ก่อนภาษี', 'VAT', 'WHT', 'รับสุทธิ', 'ช่องทาง'],
    ];
    sheet.data.docs.forEach((d, idx) => {
      rows.push([
        String(idx + 1),
        d.docNumber,
        d.receiptNo ?? '-',
        d.customer?.name ?? d.counterpartyName ?? '-',
        d.items[0]?.accountCode ?? '-',
        Number(d.incomeGross).toFixed(2),
        Number(d.vatAmount).toFixed(2),
        Number(d.whtAmount).toFixed(2),
        Number(d.netReceived).toFixed(2),
        d.paymentAccountCode,
      ]);
    });
    // UTF-8 BOM prefix for Excel Thai support
    const csv =
      '﻿' +
      rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `daily-sheet-${startDate}-to-${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      {/* Toolbar — hidden on print via data-print-hide opt-in (W9). */}
      <div
        data-print-hide="true"
        className="rounded-xl border px-6 py-4 bg-card space-y-3"
      >
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <button
              type="button"
              onClick={() => navigate('/other-income')}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
            >
              <ArrowLeft size={12} /> กลับ
            </button>
            <h2 className="text-2xl font-bold leading-snug mt-1">สรุปรายได้อื่น</h2>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={exportCsv}
              disabled={!sheet.data}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-sm border border-border rounded-md bg-background hover:bg-accent disabled:opacity-50"
            >
              <Download size={14} /> CSV
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1 px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
            >
              <Printer size={14} /> พิมพ์
            </button>
          </div>
        </div>
        <DateRangeChips
          startDate={startDate}
          endDate={endDate}
          showAllChip={false}
          onChange={({ startDate: sd, endDate: ed }) => {
            setStartDate(sd);
            setEndDate(ed);
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            data-date-range-custom-start="true"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="border border-border rounded-md px-3 py-2 text-sm bg-background"
          />
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="border border-border rounded-md px-3 py-2 text-sm bg-background"
          />
        </div>
      </div>

      <QueryBoundary
        isLoading={sheet.isLoading}
        isError={sheet.isError}
        error={sheet.error}
        onRetry={sheet.refetch}
      >
        {sheet.data && (
          <>
            {/* 4 summary boxes */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <SummaryBox
                label="รายได้รวม (ก่อน VAT)"
                value={Number(sheet.data.summary.incomeGross)}
                colorClass="text-primary"
              />
              <SummaryBox
                label="VAT 7%"
                value={Number(sheet.data.summary.vat)}
                colorClass="text-warning"
              />
              <SummaryBox
                label="หัก ณ ที่จ่าย"
                value={Number(sheet.data.summary.wht)}
                colorClass="text-destructive"
              />
              <SummaryBox
                label="รับสุทธิ"
                value={Number(sheet.data.summary.netReceived)}
                colorClass="text-success"
                highlight
              />
            </div>

            {/* Table 1: documents list */}
            <div className="rounded-xl border bg-card overflow-hidden">
              <h3 className="p-3 font-bold border-b text-sm">
                เอกสารทั้งหมด ({sheet.data.docs.length} รายการ)
              </h3>
              {sheet.data.docs.length === 0 ? (
                <p className="py-8 text-center text-muted-foreground text-sm">
                  ไม่มีเอกสารในช่วงวันที่เลือก
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted">
                      <tr>
                        <th className="px-2 py-2 text-left text-xs font-medium text-muted-foreground">
                          #
                        </th>
                        <th className="px-2 py-2 text-left text-xs font-medium text-muted-foreground">
                          เลขเอกสาร
                        </th>
                        <th className="px-2 py-2 text-left text-xs font-medium text-muted-foreground">
                          ใบเสร็จ
                        </th>
                        <th className="px-2 py-2 text-left text-xs font-medium text-muted-foreground">
                          ลูกค้า / คู่ค้า
                        </th>
                        <th className="px-2 py-2 text-left text-xs font-medium text-muted-foreground">
                          บัญชีหลัก
                        </th>
                        <th className="px-2 py-2 text-right text-xs font-medium text-muted-foreground">
                          ก่อนภาษี
                        </th>
                        <th className="px-2 py-2 text-right text-xs font-medium text-muted-foreground">
                          VAT
                        </th>
                        <th className="px-2 py-2 text-right text-xs font-medium text-muted-foreground">
                          WHT
                        </th>
                        <th className="px-2 py-2 text-right text-xs font-medium text-muted-foreground">
                          รับสุทธิ
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sheet.data.docs.map((d, idx) => (
                        <tr
                          key={d.id}
                          className="border-t hover:bg-accent cursor-pointer"
                          onClick={() => navigate(`/other-income/${d.id}`)}
                        >
                          <td className="px-2 py-2 text-muted-foreground text-xs">{idx + 1}</td>
                          <td className="px-2 py-2 font-mono text-xs font-semibold text-primary">
                            {d.docNumber}
                          </td>
                          <td className="px-2 py-2 font-mono text-xs text-muted-foreground">
                            {d.receiptNo ?? '-'}
                          </td>
                          <td className="px-2 py-2 text-sm">
                            {d.customer?.name ?? d.counterpartyName ?? '-'}
                          </td>
                          <td className="px-2 py-2 font-mono text-xs">
                            {d.items[0]?.accountCode ?? '-'}
                          </td>
                          <td className="px-2 py-2 text-right font-mono">
                            {Number(d.incomeGross).toFixed(2)}
                          </td>
                          <td className="px-2 py-2 text-right font-mono">
                            {Number(d.vatAmount).toFixed(2)}
                          </td>
                          <td className="px-2 py-2 text-right font-mono">
                            {Number(d.whtAmount).toFixed(2)}
                          </td>
                          <td className="px-2 py-2 text-right font-mono font-bold">
                            {Number(d.netReceived).toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Tables 2 & 3: by account / by payment */}
            <div className="grid md:grid-cols-2 gap-4">
              {/* Table 2: by account */}
              <div className="rounded-xl border bg-card overflow-hidden">
                <h3 className="p-3 font-bold border-b text-sm">แยกตามบัญชีรายได้</h3>
                {sheet.data.byAccount.length === 0 ? (
                  <p className="py-6 text-center text-muted-foreground text-xs">ไม่มีข้อมูล</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-muted">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                          รหัสบัญชี
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                          ชื่อบัญชี
                        </th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                          รายการ
                        </th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                          ยอดรวม
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sheet.data.byAccount.map((r) => (
                        <tr key={r.code} className="border-t">
                          <td className="px-3 py-2 font-mono text-xs font-semibold">{r.code}</td>
                          <td className="px-3 py-2 text-xs leading-snug">{r.name}</td>
                          <td className="px-3 py-2 text-right text-xs text-muted-foreground">
                            {r.count}
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-bold">
                            {Number(r.total).toFixed(2)} ฿
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Table 3: by payment channel */}
              <div className="rounded-xl border bg-card overflow-hidden">
                <h3 className="p-3 font-bold border-b text-sm">แยกตามช่องทางชำระ</h3>
                {sheet.data.byPayment.length === 0 ? (
                  <p className="py-6 text-center text-muted-foreground text-xs">ไม่มีข้อมูล</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-muted">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                          รหัสบัญชี
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                          ชื่อบัญชี
                        </th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                          รายการ
                        </th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                          ยอดรวม
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sheet.data.byPayment.map((r) => (
                        <tr key={r.code} className="border-t">
                          <td className="px-3 py-2 font-mono text-xs font-semibold">{r.code}</td>
                          <td className="px-3 py-2 text-xs leading-snug">{r.name}</td>
                          <td className="px-3 py-2 text-right text-xs text-muted-foreground">
                            {r.count}
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-bold">
                            {Number(r.total).toFixed(2)} ฿
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </>
        )}
      </QueryBoundary>
    </div>
  );
}
