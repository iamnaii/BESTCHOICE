import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Building2, TrendingDown, TrendingUp } from 'lucide-react';
import api from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { formatDateMedium, formatNumberDecimal } from '@/utils/formatters';

// ── Types ──────────────────────────────────────────────────────────

interface InterCoAccountLine {
  accountCode: string;
  accountName: string;
  openingBalance: number;
  accruals: number;
  settlements: number;
  closingBalance: number;
}

interface InterCoReport {
  periodStart: string;
  periodEnd: string;
  lines: InterCoAccountLine[];
  total: {
    openingBalance: number;
    accruals: number;
    settlements: number;
    closingBalance: number;
  };
}

interface LedgerLine {
  entryDate: string;
  entryNumber: string;
  description: string;
  referenceType: string | null;
  referenceId: string | null;
  debit: number;
  credit: number;
  runningBalance: number;
}

interface LedgerData {
  accountCode: string;
  accountName: string;
  normalBalance: string;
  lines: LedgerLine[];
}

// ── Helpers ────────────────────────────────────────────────────────

function fmt(n: number | null | undefined): string {
  if (n == null) return '0.00';
  return Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtSigned(n: number): string {
  const abs = Math.abs(n);
  const str = abs.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `(${str})` : str;
}

const inputClass =
  'w-full px-3 py-2 border border-input rounded-lg focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden';

// ── Summary card ───────────────────────────────────────────────────

interface SummaryCardProps {
  line: InterCoAccountLine;
}

function SummaryCard({ line }: SummaryCardProps) {
  const isPositive = line.closingBalance >= 0;
  return (
    <Card className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
      <div className="flex h-full">
        <div className="w-1 shrink-0 rounded-r-full bg-primary/60" />
        <div className="p-4 flex-1 min-w-0">
          <div className="text-2xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 leading-snug truncate">
            {line.accountCode} — {line.accountName}
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-2 text-sm">
            <div className="text-muted-foreground leading-snug text-xs">ยอดยกมา</div>
            <div className="text-right tabular-nums leading-snug text-xs">{fmt(line.openingBalance)}</div>

            <div className="flex items-center gap-1 text-muted-foreground leading-snug text-xs">
              <TrendingUp className="size-3 text-destructive shrink-0" />
              เกิดใหม่ (Cr)
            </div>
            <div className="text-right tabular-nums leading-snug text-xs text-destructive">
              + {fmt(line.accruals)}
            </div>

            <div className="flex items-center gap-1 text-muted-foreground leading-snug text-xs">
              <TrendingDown className="size-3 text-success shrink-0" />
              ชำระแล้ว (Dr)
            </div>
            <div className="text-right tabular-nums leading-snug text-xs text-success">
              − {fmt(line.settlements)}
            </div>

            <div className="font-semibold text-xs leading-snug border-t border-border/40 pt-1 mt-0.5">
              ยอดคงเหลือ
            </div>
            <div
              className={`text-right tabular-nums font-bold leading-snug border-t border-border/40 pt-1 mt-0.5 text-sm ${isPositive ? 'text-foreground' : 'text-destructive'}`}
            >
              {fmtSigned(line.closingBalance)}
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

// ── Main page ──────────────────────────────────────────────────────

export default function IntercompanyReportPage() {
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const [startDate, setStartDate] = useState(firstOfMonth.toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(now.toISOString().split('T')[0]);

  // Summary report
  const {
    data: report,
    isLoading: reportLoading,
    isError: reportError,
    error: reportErr,
    refetch: reportRefetch,
  } = useQuery<InterCoReport>({
    queryKey: ['interco-report', startDate, endDate],
    queryFn: async () => {
      const params = new URLSearchParams({ start: startDate, end: endDate });
      return (await api.get(`/expenses/inter-co/report?${params}`)).data;
    },
    enabled: !!startDate && !!endDate,
  });

  // Ledger lines for 21-1101
  const {
    data: ledger1101,
    isLoading: ledger1101Loading,
    isError: ledger1101Error,
    refetch: ledger1101Refetch,
  } = useQuery<LedgerData>({
    queryKey: ['interco-ledger-21-1101', startDate, endDate],
    queryFn: async () => {
      const params = new URLSearchParams({
        accountCode: '21-1101',
        periodStart: startDate,
        periodEnd: endDate,
      });
      return (await api.get(`/expenses/ledger/general-ledger?${params}`)).data;
    },
    enabled: !!startDate && !!endDate,
  });

  // Ledger lines for 21-1102
  const {
    data: ledger1102,
    isLoading: ledger1102Loading,
    isError: ledger1102Error,
    refetch: ledger1102Refetch,
  } = useQuery<LedgerData>({
    queryKey: ['interco-ledger-21-1102', startDate, endDate],
    queryFn: async () => {
      const params = new URLSearchParams({
        accountCode: '21-1102',
        periodStart: startDate,
        periodEnd: endDate,
      });
      return (await api.get(`/expenses/ledger/general-ledger?${params}`)).data;
    },
    enabled: !!startDate && !!endDate,
  });

  // Merge and sort lines from both accounts
  const mergedLines: (LedgerLine & { accountCode: string })[] = [
    ...(ledger1101?.lines ?? []).map((l) => ({ ...l, accountCode: '21-1101' })),
    ...(ledger1102?.lines ?? []).map((l) => ({ ...l, accountCode: '21-1102' })),
  ].sort((a, b) => {
    const d = a.entryDate.localeCompare(b.entryDate);
    if (d !== 0) return d;
    return a.entryNumber.localeCompare(b.entryNumber);
  });

  const isLedgerLoading = (ledger1101Loading || ledger1102Loading) && !ledger1101 && !ledger1102;
  const isLedgerError = ledger1101Error || ledger1102Error;

  const handleRetryAll = () => {
    reportRefetch();
    ledger1101Refetch();
    ledger1102Refetch();
  };

  return (
    <div>
      <PageHeader
        title="รายงานลูกหนี้ Inter-co"
        subtitle="FINANCE ↔ SHOP — ยอดเจ้าหนี้หน้าร้าน (21-1101, 21-1102)"
        icon={<Building2 className="size-5" />}
      />

      {/* Date range controls */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div>
          <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            ตั้งแต่
          </label>
          <ThaiDateInput
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className={`${inputClass} w-auto`}
          />
        </div>
        <div>
          <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            ถึง
          </label>
          <ThaiDateInput
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className={`${inputClass} w-auto`}
          />
        </div>
      </div>

      {/* Summary cards — per account */}
      <QueryBoundary
        isLoading={reportLoading && !report}
        isError={reportError}
        error={reportErr}
        onRetry={reportRefetch}
        errorTitle="ไม่สามารถโหลดรายงาน Inter-co ได้"
      >
        {report && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              {report.lines.map((line) => (
                <SummaryCard key={line.accountCode} line={line} />
              ))}
            </div>

            {/* Total row */}
            <Card className="rounded-xl border border-border/50 bg-card shadow-sm mb-6">
              <CardContent className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <span className="text-sm font-semibold leading-snug">รวมทั้งหมด (21-1101 + 21-1102)</span>
                  <div className="flex flex-wrap gap-6 text-sm tabular-nums">
                    <div className="text-center">
                      <div className="text-2xs text-muted-foreground mb-0.5 leading-snug">ยอดยกมา</div>
                      <div className="font-medium">{fmt(report.total.openingBalance)}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xs text-muted-foreground mb-0.5 leading-snug">เกิดใหม่ (+)</div>
                      <div className="font-medium text-destructive">+ {fmt(report.total.accruals)}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xs text-muted-foreground mb-0.5 leading-snug">ชำระแล้ว (−)</div>
                      <div className="font-medium text-success">− {fmt(report.total.settlements)}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xs text-muted-foreground mb-0.5 leading-snug">คงเหลือ</div>
                      <div className="font-bold text-base">{fmt(report.total.closingBalance)}</div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </QueryBoundary>

      {/* JE lines drill-down table */}
      <QueryBoundary
        isLoading={isLedgerLoading}
        isError={isLedgerError}
        onRetry={handleRetryAll}
        errorTitle="ไม่สามารถโหลดรายการเคลื่อนไหวได้"
      >
        <Card className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
          <CardHeader>
            <h2 className="text-base font-semibold leading-snug">
              รายการเคลื่อนไหวในงวด{' '}
              {mergedLines.length > 0 && (
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  ({mergedLines.length} รายการ)
                </span>
              )}
            </h2>
          </CardHeader>
          <CardContent className="p-0">
            {mergedLines.length === 0 ? (
              <div className="p-10 text-center text-muted-foreground leading-snug">
                <Building2 className="size-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">ไม่มีรายการเคลื่อนไหวในช่วงเวลานี้</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm leading-snug">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-3 font-medium text-muted-foreground whitespace-nowrap">
                        วันที่
                      </th>
                      <th className="text-left p-3 font-medium text-muted-foreground whitespace-nowrap">
                        เลขที่เอกสาร
                      </th>
                      <th className="text-left p-3 font-medium text-muted-foreground">รหัสบัญชี</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">คำอธิบาย</th>
                      <th className="text-left p-3 font-medium text-muted-foreground whitespace-nowrap">
                        ประเภท
                      </th>
                      <th className="text-right p-3 font-medium text-muted-foreground">Dr</th>
                      <th className="text-right p-3 font-medium text-muted-foreground">Cr</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mergedLines.map((line, idx) => (
                      <tr
                        key={`${line.entryNumber}-${line.accountCode}-${idx}`}
                        className="border-t border-border hover:bg-accent/30"
                      >
                        <td className="p-3 text-muted-foreground whitespace-nowrap">
                          {formatDateMedium(line.entryDate)}
                        </td>
                        <td className="p-3 whitespace-nowrap">
                          <Link
                            to={`/finance/general-journal?je=${encodeURIComponent(line.entryNumber)}`}
                            className="text-primary hover:underline font-mono text-xs"
                          >
                            {line.entryNumber}
                          </Link>
                        </td>
                        <td className="p-3 font-mono text-xs text-muted-foreground">
                          {line.accountCode}
                        </td>
                        <td className="p-3 max-w-[280px]">
                          <span className="line-clamp-2 leading-snug">{line.description || '—'}</span>
                        </td>
                        <td className="p-3">
                          {line.referenceType ? (
                            <span className="inline-flex items-center rounded-full bg-muted/80 px-2 py-0.5 text-xs font-medium leading-snug">
                              {line.referenceType}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="p-3 text-right tabular-nums">
                          {line.debit > 0 ? (
                            <span className="font-medium">
                              {formatNumberDecimal(line.debit, 2)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/40">—</span>
                          )}
                        </td>
                        <td className="p-3 text-right tabular-nums">
                          {line.credit > 0 ? (
                            <span className="font-medium">
                              {formatNumberDecimal(line.credit, 2)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/40">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-muted/30 border-t-2 border-border">
                    <tr>
                      <td colSpan={5} className="p-3 text-xs font-semibold text-muted-foreground">
                        รวม
                      </td>
                      <td className="p-3 text-right tabular-nums font-bold">
                        {fmt(mergedLines.reduce((s, l) => s + l.debit, 0))}
                      </td>
                      <td className="p-3 text-right tabular-nums font-bold">
                        {fmt(mergedLines.reduce((s, l) => s + l.credit, 0))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </QueryBoundary>
    </div>
  );
}
