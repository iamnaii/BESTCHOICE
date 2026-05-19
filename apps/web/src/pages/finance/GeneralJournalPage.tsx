import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { BookOpen, ChevronDown, ChevronRight } from 'lucide-react';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import CompanyFilter from '@/components/CompanyFilter';
import { useUiFlags } from '@/hooks/useUiFlags';
import { formatDateMedium } from '@/utils/formatters';

interface JELine {
  accountCode: string;
  debit: string | number;
  credit: string | number;
  description?: string | null;
}

interface JournalEntry {
  id: string;
  entryNumber: string;
  description: string;
  postedAt: string | null;
  entryDate: string;
  lines: JELine[];
}

interface GeneralJournalData {
  data: JournalEntry[];
  total: number;
  page: number;
  limit: number;
}

function fmt(n: string | number | null | undefined): string {
  const v = Number(n ?? 0);
  if (!v) return '';
  return v.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const inputClass =
  'w-full px-3 py-2 border border-input rounded-lg focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden';

export default function GeneralJournalPage() {
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const [startDate, setStartDate] = useState(firstOfMonth.toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(now.toISOString().split('T')[0]);
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [companyId, setCompanyId] = useState('');
  const { cacheTtlReports } = useUiFlags();

  const {
    data: gj,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<GeneralJournalData>({
    queryKey: ['general-journal', startDate, endDate, page, companyId],
    queryFn: async () => {
      const params = new URLSearchParams({ start: startDate, end: endDate, page: String(page), limit: '50' });
      if (companyId) params.set('companyId', companyId);
      return (await api.get(`/expenses/ledger/general-journal?${params}`)).data;
    },
    enabled: !!startDate && !!endDate,
    staleTime: cacheTtlReports * 1000,
  });

  const toggle = (id: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });

  const totalPages = gj ? Math.max(1, Math.ceil(gj.total / gj.limit)) : 1;

  return (
    <div>
      <PageHeader
        title="สมุดรายวันทั่วไป"
        subtitle="General Journal — รายการบันทึกบัญชีทั้งหมด"
        icon={<BookOpen className="size-6" />}
      />

      <div className="flex flex-wrap gap-3 mb-6">
        <div>
          <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            ตั้งแต่
          </label>
          <ThaiDateInput
            value={startDate}
            onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
            className={`${inputClass} w-auto`}
          />
        </div>
        <div>
          <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            ถึง
          </label>
          <ThaiDateInput
            value={endDate}
            onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
            className={`${inputClass} w-auto`}
          />
        </div>
        <CompanyFilter value={companyId} onChange={(v) => { setCompanyId(v); setPage(1); }} />
        <div className="flex items-end gap-1">
          {[
            {
              label: 'เดือนนี้',
              fn: () => {
                setStartDate(firstOfMonth.toISOString().split('T')[0]);
                setEndDate(now.toISOString().split('T')[0]);
                setPage(1);
              },
            },
            {
              label: 'ปีนี้',
              fn: () => {
                setStartDate(`${now.getFullYear()}-01-01`);
                setEndDate(now.toISOString().split('T')[0]);
                setPage(1);
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
        isLoading={isLoading && !gj}
        isError={isError}
        error={error}
        onRetry={refetch}
        errorTitle="ไม่สามารถโหลดสมุดรายวันทั่วไปได้"
      >
        {gj ? (
          <>
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-muted-foreground leading-snug">
                รวม {gj.total.toLocaleString()} รายการ · หน้า {page} / {totalPages}
              </span>
            </div>

            <div className="space-y-2">
              {gj.data.length === 0 ? (
                <Card className="rounded-xl border border-border/50 bg-card">
                  <CardContent className="p-10 text-center text-muted-foreground leading-snug">
                    <BookOpen className="size-10 mx-auto mb-3 opacity-40" />
                    <p className="text-sm">ไม่มีรายการในช่วงเวลานี้</p>
                  </CardContent>
                </Card>
              ) : (
                gj.data.map((je) => (
                  <Card
                    key={je.id}
                    className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden"
                  >
                    <button
                      onClick={() => toggle(je.id)}
                      className="w-full p-3 flex items-center gap-3 hover:bg-accent/40 text-left transition-colors"
                      aria-expanded={expanded.has(je.id)}
                    >
                      {expanded.has(je.id) ? (
                        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="font-mono text-xs text-muted-foreground shrink-0">
                        {je.entryNumber}
                      </span>
                      <span className="text-sm text-muted-foreground shrink-0">
                        {formatDateMedium(je.postedAt ?? je.entryDate)}
                      </span>
                      <span className="text-sm leading-snug flex-1 truncate">{je.description}</span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {je.lines.length} บรรทัด
                      </span>
                    </button>

                    {expanded.has(je.id) && (
                      <div className="border-t border-border/40 bg-muted/20">
                        <table className="w-full text-xs leading-snug">
                          <thead className="bg-muted/40">
                            <tr>
                              <th className="text-left p-2 font-medium text-muted-foreground">รหัสบัญชี</th>
                              <th className="text-left p-2 font-medium text-muted-foreground">คำอธิบาย</th>
                              <th className="text-right p-2 font-medium text-muted-foreground">Dr</th>
                              <th className="text-right p-2 font-medium text-muted-foreground">Cr</th>
                            </tr>
                          </thead>
                          <tbody>
                            {je.lines.map((l, i) => (
                              <tr key={i} className="border-t border-border/20">
                                <td className="p-2 font-mono">{l.accountCode}</td>
                                <td className="p-2 text-muted-foreground">{l.description ?? ''}</td>
                                <td className="p-2 text-right tabular-nums text-success">
                                  {fmt(l.debit)}
                                </td>
                                <td className="p-2 text-right tabular-nums text-destructive">
                                  {fmt(l.credit)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </Card>
                ))
              )}
            </div>

            {/* Pagination */}
            <div className="flex justify-between items-center mt-4">
              <span className="text-sm text-muted-foreground leading-snug">
                หน้า {page} จาก {totalPages}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  ก่อนหน้า
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  ถัดไป
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </QueryBoundary>
    </div>
  );
}
