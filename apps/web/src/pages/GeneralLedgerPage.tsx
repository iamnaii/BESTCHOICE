import ScreenTable from '@/components/ui/ScreenTable';
import { useId as useUiFieldId, useState } from 'react';
import { NAV_LABELS } from '@/config/work-navigation';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, BookOpen, Download, FileSpreadsheet } from 'lucide-react';
import { formatDateMedium } from '@/utils/formatters';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { DateRangeChips } from '@/components/ui/DateRangeChips';
import CompanyFilter from '@/components/CompanyFilter';
import { AccountCombobox } from '@/components/accounting/AccountCombobox';
import { useUiFlags } from '@/hooks/useUiFlags';

export interface GLLine {
  entryDate: string;
  entryNumber: string;
  description: string;
  referenceType: string | null;
  referenceId: string | null;
  debit: number;
  credit: number;
  runningBalance: number;
}

export interface GeneralLedgerData {
  accountCode: string;
  accountName: string;
  normalBalance: 'Dr' | 'Cr' | 'Dr/Cr';
  periodStart: string;
  periodEnd: string;
  opening: number;
  closing: number;
  totalDebit: number;
  totalCredit: number;
  lines: GLLine[];
}

const inputClass =
  'w-full px-3 py-2 border border-input rounded-lg focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden';

function fmt(n: number | null | undefined): string {
  if (n == null) return '';
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtAmount(n: number | null | undefined): string {
  if (n == null || n === 0) return '';
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function NormalBalanceBadge({ value }: { value: 'Dr' | 'Cr' | 'Dr/Cr' }) {
  const color =
    value === 'Cr'
      ? 'bg-info/10 text-info'
      : value === 'Dr'
        ? 'bg-success/10 text-success'
        : 'bg-muted text-muted-foreground';
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium leading-snug ${color}`}
    >
      ด้านปกติ: {value}
    </span>
  );
}

export function GeneralLedgerPage() {
  const uiFieldId = useUiFieldId();
  // Local-date formatting (NOT toISOString — that shifts a BKK local-midnight
  // date back one UTC day). Default = full current month, matching the
  // DateRangeChips "เดือนนี้" preset (owner 2026-07-02).
  const toLocalIso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const now = new Date();
  // งบทดลองส่งบัญชีและช่วงวันที่มาทาง URL (?account=&start=&end=&from=trial-balance) — 2026-11-18
  const [searchParams] = useSearchParams();
  const dateParam = (key: string) => {
    const value = searchParams.get(key);
    return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  };
  const fromTrialBalance = searchParams.get('from') === 'trial-balance';
  const [startDate, setStartDate] = useState(
    dateParam('start') ?? toLocalIso(new Date(now.getFullYear(), now.getMonth(), 1)),
  );
  const [endDate, setEndDate] = useState(
    dateParam('end') ?? toLocalIso(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  );
  // บริษัทที่งบทดลองกรองอยู่ (?company=<id>) — รับเฉพาะ id ที่หน้าตาปกติ
  const companyParam = searchParams.get('company')?.trim() ?? '';
  const [companyId, setCompanyId] = useState(/^[A-Za-z0-9-]+$/.test(companyParam) ? companyParam : '');
  const [accountCode, setAccountCode] = useState(searchParams.get('account') ?? '');
  const { cacheTtlReports } = useUiFlags();
  const reportsStaleTime = cacheTtlReports * 1000;

  const {
    data: gl,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<GeneralLedgerData>({
    queryKey: ['general-ledger', accountCode, startDate, endDate, companyId],
    queryFn: async () => {
      const params = new URLSearchParams({
        accountCode,
        periodStart: startDate,
        periodEnd: endDate,
      });
      if (companyId) params.set('companyId', companyId);
      return (await api.get(`/expenses/ledger/general-ledger?${params}`)).data;
    },
    enabled: !!accountCode && !!startDate && !!endDate,
    staleTime: reportsStaleTime,
  });

  const handleExportExcel = async () => {
    if (!gl) return;
    try {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      const sh = wb.addWorksheet('General Ledger');

      sh.addRow([`บัญชี: ${gl.accountCode} ${gl.accountName}`]);
      sh.addRow([`ช่วง: ${formatDateMedium(gl.periodStart)} — ${formatDateMedium(gl.periodEnd)}`]);
      sh.addRow([`Normal Balance: ${gl.normalBalance}`]);
      sh.addRow([]);
      sh.addRow(['วันที่', 'เลขที่ JE', 'คำอธิบาย', 'อ้างอิง', 'Dr', 'Cr', 'คงเหลือ']);
      sh.addRow([
        '',
        '',
        'ยอดยกมา (Opening)',
        '',
        '',
        '',
        gl.opening,
      ]);
      for (const l of gl.lines) {
        sh.addRow([
          new Date(l.entryDate).toISOString().slice(0, 10),
          l.entryNumber,
          l.description ?? '',
          l.referenceId ?? '',
          l.debit > 0 ? l.debit : '',
          l.credit > 0 ? l.credit : '',
          l.runningBalance,
        ]);
      }
      sh.addRow([
        '',
        '',
        'รวม / ยอดยกไป (Closing)',
        '',
        gl.totalDebit,
        gl.totalCredit,
        gl.closing,
      ]);

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeCode = gl.accountCode.replace(/[^A-Za-z0-9-]/g, '');
      a.download = `general-ledger-${safeCode}-${startDate.replace(/-/g, '')}-${endDate.replace(/-/g, '')}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(`ส่งออก Excel ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div>
      {fromTrialBalance && (
        <Link
          to={`/finance/trial-balance?start=${startDate}&end=${endDate}`}
          className="mb-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium leading-snug text-primary hover:underline"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          กลับไป{NAV_LABELS.trialBalance}
        </Link>
      )}
      <PageHeader
        title={NAV_LABELS.generalLedger}
        subtitle="บัญชีแยกประเภท — รายการเดินบัญชีแยกตามรหัสบัญชี"
        icon={<BookOpen className="size-6" />}
      />

      {/* Filters */}
      <div className="mb-3">
        <DateRangeChips
          startDate={startDate}
          endDate={endDate}
          onChange={({ startDate: sd, endDate: ed }) => {
            setStartDate(sd);
            setEndDate(ed);
          }}
        />
      </div>
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="min-w-[260px]">
          <label htmlFor={`${uiFieldId}-0`} className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            รหัสบัญชี
          </label>
          {/* R2-3a — rows "<code> - <name>" (owner 2026-11-16 Q4), first 200 matches (as before) */}
          <AccountCombobox
            id={`${uiFieldId}-0`}
            value={accountCode}
            onChange={setAccountCode}
            limit={200}
            placeholder="เลือกบัญชี…"
          />
        </div>
        <div>
          <label htmlFor={`${uiFieldId}-1`} className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            ตั้งแต่
          </label>
          <ThaiDateInput id={`${uiFieldId}-1`}
            data-date-range-custom-start="true"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className={`${inputClass} w-auto`}
          />
        </div>
        <div>
          <label htmlFor={`${uiFieldId}-2`} className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            ถึง
          </label>
          <ThaiDateInput id={`${uiFieldId}-2`}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className={`${inputClass} w-auto`}
          />
        </div>
        <CompanyFilter value={companyId} onChange={setCompanyId} />
        <div className="flex items-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleExportExcel}
            disabled={!gl || gl.lines.length === 0}
            className="gap-1.5"
          >
            <Download className="size-4" />
            <FileSpreadsheet className="size-4" />
            Excel
          </Button>
        </div>
      </div>

      {!accountCode ? (
        <Card className="rounded-xl border border-border/50 bg-card shadow-sm">
          <CardContent className="p-10 text-center text-muted-foreground leading-snug">
            <BookOpen className="size-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm">เลือกบัญชีจากด้านบนเพื่อดูรายการเดินบัญชี</p>
          </CardContent>
        </Card>
      ) : (
        <QueryBoundary
          isLoading={isLoading && !gl}
          isError={isError}
          error={error}
          onRetry={refetch}
          errorTitle="ไม่สามารถโหลดบัญชีแยกประเภทได้"
        >
          {gl ? (
            <>
              {/* Header card */}
              <Card className="rounded-xl border border-border/50 bg-card shadow-sm mb-4">
                <CardHeader>
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-3 mb-1 flex-wrap">
                        <span className="font-mono text-sm text-muted-foreground">
                          {gl.accountCode}
                        </span>
                        <NormalBalanceBadge value={gl.normalBalance} />
                      </div>
                      <h2 className="text-xl font-bold leading-snug">{gl.accountName}</h2>
                      <p className="text-sm text-muted-foreground leading-snug">
                        {formatDateMedium(gl.periodStart)} — {formatDateMedium(gl.periodEnd)}
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1 leading-snug">
                        ยอดยกมา
                      </div>
                      <div className="text-xl font-bold tabular-nums">{fmt(gl.opening)}</div>
                    </div>
                  </div>
                </CardHeader>
              </Card>

              {/* Data table */}
              <Card className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
                <CardContent className="p-0">
                  <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
                    <ScreenTable className="w-full text-sm leading-snug">
                      <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
                        <tr>
                          <th className="text-left p-3 font-medium text-muted-foreground whitespace-nowrap">
                            วันที่
                          </th>
                          <th className="text-left p-3 font-medium text-muted-foreground whitespace-nowrap">
                            เลขที่ รายการบัญชี
                          </th>
                          <th className="text-left p-3 font-medium text-muted-foreground">
                            คำอธิบาย
                          </th>
                          <th className="text-left p-3 font-medium text-muted-foreground">
                            อ้างอิง
                          </th>
                          <th className="text-right p-3 font-medium text-muted-foreground">
                            Dr
                          </th>
                          <th className="text-right p-3 font-medium text-muted-foreground">
                            Cr
                          </th>
                          <th className="text-right p-3 font-medium text-muted-foreground">
                            คงเหลือ
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-t border-border bg-muted/20">
                          <td className="p-3" colSpan={3}>
                            <span className="text-xs text-muted-foreground uppercase tracking-wider">
                              ยอดยกมา
                            </span>
                          </td>
                          <td className="p-3" />
                          <td className="p-3" />
                          <td className="p-3" />
                          <td className="p-3 text-right tabular-nums font-semibold">
                            {fmt(gl.opening)}
                          </td>
                        </tr>
                        {gl.lines.length === 0 ? (
                          <tr>
                            <td
                              colSpan={7}
                              className="p-6 text-center text-muted-foreground leading-snug"
                            >
                              ไม่มีรายการในงวดนี้
                            </td>
                          </tr>
                        ) : (
                          gl.lines.map((l, i) => (
                            <tr
                              key={`${l.entryNumber}-${i}`}
                              className="border-t border-border hover:bg-accent/30"
                            >
                              <td className="p-3 whitespace-nowrap text-muted-foreground">
                                {formatDateMedium(l.entryDate)}
                              </td>
                              <td className="p-3 whitespace-nowrap">
                                <Link
                                  to={`/journal-entries?search=${encodeURIComponent(l.entryNumber)}`}
                                  className="font-mono text-xs text-primary hover:underline"
                                >
                                  {l.entryNumber}
                                </Link>
                              </td>
                              <td className="p-3">{l.description}</td>
                              <td className="p-3 text-xs text-muted-foreground">
                                {l.referenceType && l.referenceId
                                  ? `${l.referenceType} ${l.referenceId.slice(0, 8)}`
                                  : ''}
                              </td>
                              <td className="p-3 text-right tabular-nums text-success">
                                {fmtAmount(l.debit)}
                              </td>
                              <td className="p-3 text-right tabular-nums text-destructive">
                                {fmtAmount(l.credit)}
                              </td>
                              <td className="p-3 text-right tabular-nums font-semibold">
                                {fmt(l.runningBalance)}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                      <tfoot className="sticky bottom-0 bg-muted/80 backdrop-blur border-t-2 border-foreground">
                        <tr>
                          <td className="p-3 font-bold" colSpan={4}>
                            รวม / ยอดยกไป
                          </td>
                          <td className="p-3 text-right tabular-nums font-bold text-success">
                            {fmt(gl.totalDebit)}
                          </td>
                          <td className="p-3 text-right tabular-nums font-bold text-destructive">
                            {fmt(gl.totalCredit)}
                          </td>
                          <td className="p-3 text-right tabular-nums font-bold">
                            {fmt(gl.closing)}
                          </td>
                        </tr>
                      </tfoot>
                    </ScreenTable>
                  </div>
                </CardContent>
              </Card>
            </>
          ) : null}
        </QueryBoundary>
      )}
    </div>
  );
}

export default GeneralLedgerPage;
