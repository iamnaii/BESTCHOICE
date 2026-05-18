import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Landmark, AlertTriangle, ArrowUp, ArrowDown } from 'lucide-react';
import { formatDateMedium } from '@/utils/formatters';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import CompanyFilter from '@/components/CompanyFilter';
import { useUiFlags } from '@/hooks/useUiFlags';

export interface EquityMovement {
  entryDate: string;
  entryNumber: string;
  description: string;
  amount: number;
}

export interface EquityRow {
  accountCode: string;
  accountName: string;
  opening: number;
  increases: EquityMovement[];
  decreases: EquityMovement[];
  totalIncrease: number;
  totalDecrease: number;
  closing: number;
}

export interface EquityStatementData {
  periodStart: string;
  periodEnd: string;
  rows: EquityRow[];
  currentYearProfit: number;
  caveat: string;
  totalOpening: number;
  totalClosing: number;
}

const inputClass =
  'w-full px-3 py-2 border border-input rounded-lg focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden';

function fmt(n: number | null | undefined): string {
  if (n == null) return '0.00';
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(s: string): string {
  try {
    return formatDateMedium(s);
  } catch {
    return s;
  }
}

export function EquityStatementPage() {
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const [startDate, setStartDate] = useState(firstOfMonth.toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(now.toISOString().split('T')[0]);
  const [companyId, setCompanyId] = useState('');
  const [drillRow, setDrillRow] = useState<EquityRow | null>(null);
  const { cacheTtlReports } = useUiFlags();
  const reportsStaleTime = cacheTtlReports * 1000;

  const {
    data: equity,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<EquityStatementData>({
    queryKey: ['equity-statement', startDate, endDate, companyId],
    queryFn: async () => {
      const params = new URLSearchParams({ periodStart: startDate, periodEnd: endDate });
      if (companyId) params.set('companyId', companyId);
      return (await api.get(`/expenses/ledger/equity-statement?${params}`)).data;
    },
    enabled: !!startDate && !!endDate,
    staleTime: reportsStaleTime,
  });

  return (
    <div>
      <PageHeader
        title="งบแสดงการเปลี่ยนแปลงในส่วนของผู้ถือหุ้น"
        subtitle="Statement of Changes in Equity"
        icon={<Landmark className="size-6" />}
      />

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
        <CompanyFilter value={companyId} onChange={setCompanyId} />
        <div className="flex items-end gap-1">
          {[
            {
              label: 'เดือนนี้',
              fn: () => {
                setStartDate(firstOfMonth.toISOString().split('T')[0]);
                setEndDate(now.toISOString().split('T')[0]);
              },
            },
            {
              label: 'ปีนี้',
              fn: () => {
                setStartDate(`${now.getFullYear()}-01-01`);
                setEndDate(now.toISOString().split('T')[0]);
              },
            },
          ].map((p) => (
            <button
              key={p.label}
              onClick={p.fn}
              className="px-3 py-2 text-xs border border-input rounded-lg hover:bg-accent transition-colors leading-snug"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <QueryBoundary
        isLoading={isLoading && !equity}
        isError={isError}
        error={error}
        onRetry={refetch}
        errorTitle="ไม่สามารถโหลดงบแสดงการเปลี่ยนแปลงในส่วนของผู้ถือหุ้นได้"
      >
        {equity ? (
          <>
            <Card className="rounded-xl border border-border/50 bg-card shadow-sm mb-4">
              <CardHeader>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h2 className="text-lg font-bold leading-snug">
                    งบแสดงการเปลี่ยนแปลงในส่วนของผู้ถือหุ้น
                  </h2>
                  <span className="text-sm text-muted-foreground leading-snug">
                    {fmtDate(equity.periodStart)} — {fmtDate(equity.periodEnd)}
                  </span>
                </div>
              </CardHeader>
            </Card>

            {/* Caveat banner */}
            <div className="flex items-start gap-2 rounded-lg border border-warning/50 bg-warning/10 p-3 my-4 leading-snug">
              <AlertTriangle className="size-5 text-warning shrink-0 mt-0.5" />
              <div className="text-sm text-warning-foreground">
                <strong>หมายเหตุ:</strong> {equity.caveat}
                {' — '}
                <span className="tabular-nums">
                  กำไรปีปัจจุบัน (ค่าประมาณ): ฿{fmt(equity.currentYearProfit)}
                </span>
              </div>
            </div>

            <Card className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm leading-snug">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left p-3 font-medium text-muted-foreground">บัญชี</th>
                        <th className="text-right p-3 font-medium text-muted-foreground">
                          ยอดต้นงวด
                        </th>
                        <th className="text-right p-3 font-medium text-muted-foreground">
                          + เพิ่ม
                        </th>
                        <th className="text-right p-3 font-medium text-muted-foreground">
                          − ลด
                        </th>
                        <th className="text-right p-3 font-medium text-muted-foreground">
                          ยอดปลายงวด
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {equity.rows.map((row) => {
                        const hasDetails =
                          row.increases.length > 0 || row.decreases.length > 0;
                        return (
                          <tr
                            key={row.accountCode}
                            className={`border-t border-border ${
                              hasDetails
                                ? 'cursor-pointer hover:bg-accent/50'
                                : 'cursor-default'
                            }`}
                            onClick={() => {
                              if (hasDetails) setDrillRow(row);
                            }}
                          >
                            <td className="p-3">
                              <div className="font-mono text-xs text-muted-foreground">
                                {row.accountCode}
                              </div>
                              <div className="font-medium">{row.accountName}</div>
                            </td>
                            <td className="p-3 text-right tabular-nums">{fmt(row.opening)}</td>
                            <td className="p-3 text-right tabular-nums text-success">
                              {row.totalIncrease > 0 ? fmt(row.totalIncrease) : '—'}
                            </td>
                            <td className="p-3 text-right tabular-nums text-destructive">
                              {row.totalDecrease > 0 ? fmt(row.totalDecrease) : '—'}
                            </td>
                            <td className="p-3 text-right tabular-nums font-semibold">
                              {fmt(row.closing)}
                            </td>
                          </tr>
                        );
                      })}
                      <tr className="border-t-2 border-foreground bg-muted/30">
                        <td className="p-3 font-bold">รวม</td>
                        <td className="p-3 text-right tabular-nums font-bold">
                          {fmt(equity.totalOpening)}
                        </td>
                        <td className="p-3 text-right tabular-nums font-bold text-success">
                          {fmt(equity.rows.reduce((s, r) => s + r.totalIncrease, 0))}
                        </td>
                        <td className="p-3 text-right tabular-nums font-bold text-destructive">
                          {fmt(equity.rows.reduce((s, r) => s + r.totalDecrease, 0))}
                        </td>
                        <td className="p-3 text-right tabular-nums font-bold">
                          {fmt(equity.totalClosing)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="p-3 text-xs text-muted-foreground leading-snug border-t border-border bg-muted/30">
                  คลิกแถวเพื่อดูรายละเอียดการเคลื่อนไหว
                </div>
              </CardContent>
            </Card>
          </>
        ) : null}
      </QueryBoundary>

      {/* Drill-down dialog */}
      <Dialog open={!!drillRow} onOpenChange={(open) => !open && setDrillRow(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="leading-snug">
              <span className="font-mono text-sm text-muted-foreground">
                {drillRow?.accountCode}
              </span>{' '}
              {drillRow?.accountName}
            </DialogTitle>
          </DialogHeader>
          {drillRow && (
            <div className="space-y-4">
              {drillRow.increases.length > 0 && (
                <div>
                  <h4 className="font-semibold text-sm mb-2 flex items-center gap-1.5 text-success leading-snug">
                    <ArrowUp className="size-4" /> รายการเพิ่ม (
                    {drillRow.increases.length})
                  </h4>
                  <div className="space-y-1 max-h-64 overflow-y-auto">
                    {drillRow.increases.map((m, i) => (
                      <div
                        key={i}
                        className="flex justify-between items-start gap-3 text-sm p-2 rounded bg-muted/30 leading-snug"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span>{fmtDate(m.entryDate)}</span>
                            <span className="font-mono">{m.entryNumber}</span>
                          </div>
                          <div className="truncate">{m.description}</div>
                        </div>
                        <div className="tabular-nums font-semibold text-success">
                          {fmt(m.amount)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {drillRow.decreases.length > 0 && (
                <div>
                  <h4 className="font-semibold text-sm mb-2 flex items-center gap-1.5 text-destructive leading-snug">
                    <ArrowDown className="size-4" /> รายการลด (
                    {drillRow.decreases.length})
                  </h4>
                  <div className="space-y-1 max-h-64 overflow-y-auto">
                    {drillRow.decreases.map((m, i) => (
                      <div
                        key={i}
                        className="flex justify-between items-start gap-3 text-sm p-2 rounded bg-muted/30 leading-snug"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span>{fmtDate(m.entryDate)}</span>
                            <span className="font-mono">{m.entryNumber}</span>
                          </div>
                          <div className="truncate">{m.description}</div>
                        </div>
                        <div className="tabular-nums font-semibold text-destructive">
                          {fmt(m.amount)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {drillRow.increases.length === 0 && drillRow.decreases.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4 leading-snug">
                  ไม่มีการเคลื่อนไหวในงวดนี้
                </p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default EquityStatementPage;
