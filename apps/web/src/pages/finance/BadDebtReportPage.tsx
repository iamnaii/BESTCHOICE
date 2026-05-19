import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { TrendingDown } from 'lucide-react';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import CompanyFilter from '@/components/CompanyFilter';
import { useUiFlags } from '@/hooks/useUiFlags';
import { formatDateMedium } from '@/utils/formatters';

interface BadDebtEntry {
  journalEntryId: string;
  documentNumber: string | null;
  postedAt: string;
  description: string | null;
  amount: number;
  sourceType: string | null;
  sourceId: string | null;
}

interface BadDebtData {
  period: { start: string; end: string };
  totalBadDebt: number;
  entries: BadDebtEntry[];
}

function fmt(n: number | null | undefined): string {
  if (n == null) return '0.00';
  return Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const inputClass =
  'w-full px-3 py-2 border border-input rounded-lg focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden';

export default function BadDebtReportPage() {
  const now = new Date();
  const firstOfYear = `${now.getFullYear()}-01-01`;
  const [startDate, setStartDate] = useState(firstOfYear);
  const [endDate, setEndDate] = useState(now.toISOString().split('T')[0]);
  const [companyId, setCompanyId] = useState('');
  const { cacheTtlReports } = useUiFlags();

  const {
    data: bd,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<BadDebtData>({
    queryKey: ['bad-debt-report', startDate, endDate, companyId],
    queryFn: async () => {
      const params = new URLSearchParams({ start: startDate, end: endDate });
      if (companyId) params.set('companyId', companyId);
      return (await api.get(`/expenses/ledger/bad-debt?${params}`)).data;
    },
    enabled: !!startDate && !!endDate,
    staleTime: cacheTtlReports * 1000,
  });

  return (
    <div>
      <PageHeader
        title="รายงานหนี้สูญ"
        subtitle="Bad Debt Report — บัญชี 51-1102 หนี้สูญ/ขาดทุนจากยึดเครื่อง"
        icon={<TrendingDown className="size-6" />}
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
              label: 'ปีนี้',
              fn: () => {
                setStartDate(firstOfYear);
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
        isLoading={isLoading && !bd}
        isError={isError}
        error={error}
        onRetry={refetch}
        errorTitle="ไม่สามารถโหลดรายงานหนี้สูญได้"
      >
        {bd ? (
          <>
            {/* Total summary card */}
            <Card className="rounded-xl border border-border/50 bg-card shadow-sm mb-4 overflow-hidden">
              <div className="flex h-full">
                <div className="w-1 shrink-0 rounded-r-full bg-destructive" />
                <div className="p-5 flex-1">
                  <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider leading-snug">
                      หนี้สูญรวมงวด ({formatDateMedium(bd.period.start)} —{' '}
                      {formatDateMedium(bd.period.end)})
                    </div>
                    <span className="text-xs text-muted-foreground leading-snug">
                      {bd.entries.length} รายการ
                    </span>
                  </div>
                  <div className="text-3xl font-bold tabular-nums text-destructive">
                    {fmt(bd.totalBadDebt)}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 leading-snug">
                    บัญชี 51-1102 หนี้สูญ/ขาดทุนจากยึดเครื่อง (Dr side)
                  </div>
                </div>
              </div>
            </Card>

            {/* Entries table */}
            <Card className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
              <CardHeader>
                <h2 className="text-base font-semibold leading-snug">รายการบันทึกหนี้สูญ</h2>
              </CardHeader>
              <CardContent className="p-0">
                {bd.entries.length === 0 ? (
                  <div className="p-10 text-center text-muted-foreground leading-snug">
                    <TrendingDown className="size-10 mx-auto mb-3 opacity-40" />
                    <p className="text-sm">ไม่มีรายการหนี้สูญในช่วงเวลานี้</p>
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
                            เลขที่ JE
                          </th>
                          <th className="text-left p-3 font-medium text-muted-foreground">
                            คำอธิบาย
                          </th>
                          <th className="text-left p-3 font-medium text-muted-foreground">
                            อ้างอิง
                          </th>
                          <th className="text-right p-3 font-medium text-muted-foreground">
                            จำนวน
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {bd.entries.map((e) => (
                          <tr
                            key={e.journalEntryId}
                            className="border-t border-border hover:bg-accent/30"
                          >
                            <td className="p-3 whitespace-nowrap text-muted-foreground">
                              {formatDateMedium(e.postedAt)}
                            </td>
                            <td className="p-3 font-mono text-xs text-primary">
                              {e.documentNumber ?? '—'}
                            </td>
                            <td className="p-3">{e.description ?? '—'}</td>
                            <td className="p-3 text-xs text-muted-foreground">
                              {e.sourceType && e.sourceId
                                ? `${e.sourceType} ${e.sourceId.slice(0, 8)}`
                                : '—'}
                            </td>
                            <td className="p-3 text-right tabular-nums font-semibold text-destructive">
                              {fmt(e.amount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-muted/50 border-t-2 border-foreground">
                        <tr>
                          <td colSpan={4} className="p-3 font-bold">
                            รวมทั้งหมด
                          </td>
                          <td className="p-3 text-right tabular-nums font-bold text-destructive">
                            {fmt(bd.totalBadDebt)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        ) : null}
      </QueryBoundary>
    </div>
  );
}
