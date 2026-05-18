import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { BookOpen, ChevronsUpDown, Check, Download, FileSpreadsheet } from 'lucide-react';
import { formatDateMedium } from '@/utils/formatters';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import CompanyFilter from '@/components/CompanyFilter';
import { useCoaGroups } from '@/hooks/useCoa';
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
      Normal: {value}
    </span>
  );
}

export function GeneralLedgerPage() {
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const [startDate, setStartDate] = useState(firstOfMonth.toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(now.toISOString().split('T')[0]);
  const [companyId, setCompanyId] = useState('');
  const [accountCode, setAccountCode] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const { cacheTtlReports } = useUiFlags();
  const reportsStaleTime = cacheTtlReports * 1000;

  // Load CoA groups for the picker
  const coaQ = useCoaGroups({});
  const allAccounts = useMemo(() => {
    const flat: { code: string; name: string; category: string }[] = [];
    for (const g of coaQ.data?.groups ?? []) {
      for (const a of g.accounts) {
        flat.push({ code: a.code, name: a.name, category: g.category });
      }
    }
    return flat;
  }, [coaQ.data]);

  const filteredAccounts = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    if (!q) return allAccounts;
    return allAccounts.filter(
      (a) => a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q),
    );
  }, [pickerSearch, allAccounts]);

  const selectedAccount = useMemo(
    () => allAccounts.find((a) => a.code === accountCode),
    [allAccounts, accountCode],
  );

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
      <PageHeader
        title="บัญชีแยกประเภท"
        subtitle="General Ledger — รายการเดินบัญชีแยกตามรหัสบัญชี"
        icon={<BookOpen className="size-6" />}
      />

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="min-w-[260px]">
          <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            รหัสบัญชี
          </label>
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-label="เลือกบัญชี"
                aria-expanded={pickerOpen}
                className="w-full justify-between font-normal"
              >
                {selectedAccount ? (
                  <span className="truncate leading-snug">
                    <span className="font-mono text-xs text-muted-foreground mr-2">
                      {selectedAccount.code}
                    </span>
                    {selectedAccount.name}
                  </span>
                ) : (
                  <span className="text-muted-foreground leading-snug">
                    เลือกบัญชี…
                  </span>
                )}
                <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[380px] p-0" align="start">
              <Command shouldFilter={false}>
                <CommandInput
                  placeholder="ค้นหารหัสหรือชื่อบัญชี…"
                  value={pickerSearch}
                  onValueChange={setPickerSearch}
                />
                <CommandList>
                  <CommandEmpty>ไม่พบบัญชี</CommandEmpty>
                  <CommandGroup>
                    {filteredAccounts.slice(0, 200).map((a) => (
                      <CommandItem
                        key={a.code}
                        value={a.code}
                        onSelect={() => {
                          setAccountCode(a.code);
                          setPickerOpen(false);
                          setPickerSearch('');
                        }}
                      >
                        <Check
                          className={`mr-2 size-4 ${
                            accountCode === a.code ? 'opacity-100' : 'opacity-0'
                          }`}
                        />
                        <span className="font-mono text-xs text-muted-foreground mr-2">
                          {a.code}
                        </span>
                        <span className="leading-snug">{a.name}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
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
                    <table className="w-full text-sm leading-snug">
                      <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
                        <tr>
                          <th className="text-left p-3 font-medium text-muted-foreground whitespace-nowrap">
                            วันที่
                          </th>
                          <th className="text-left p-3 font-medium text-muted-foreground whitespace-nowrap">
                            เลขที่ JE
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
                    </table>
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
