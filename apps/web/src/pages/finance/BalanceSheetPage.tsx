import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Scale } from 'lucide-react';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { formatDateMedium } from '@/utils/formatters';
import CompanyFilter from '@/components/CompanyFilter';
import { useUiFlags } from '@/hooks/useUiFlags';

interface BSRow {
  code: string;
  name: string;
  type: string;
  normalBalance: string;
  netBalance: number;
}

interface BSSection {
  rows: BSRow[];
  total: number;
  sectionName: string;
}

interface BalanceSheetData {
  asOfDate: string;
  assets: {
    current: BSSection;
    nonCurrent: BSSection;
    total: number;
  };
  liabilities: {
    current: BSSection;
    nonCurrent: BSSection;
    total: number;
  };
  equity: BSSection & { total: number };
  isBalanced: boolean;
}

function fmt(n: number | null | undefined): string {
  if (n == null) return '0.00';
  return Number(n).toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function BSSection({ section }: { section: BSSection }) {
  return (
    <div className="mb-4">
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 leading-snug">
        {section.sectionName}
      </div>
      {section.rows.length === 0 ? (
        <div className="text-sm text-muted-foreground pl-2 leading-snug">— ไม่มีรายการ —</div>
      ) : (
        section.rows.map((r) => (
          <div
            key={r.code}
            className="flex justify-between items-center text-sm py-1 border-b border-border/30 leading-snug"
          >
            <span>
              <span className="font-mono text-xs text-muted-foreground mr-2">{r.code}</span>
              {r.name}
            </span>
            <span
              className={`tabular-nums ${Number(r.netBalance) < 0 ? 'text-destructive' : ''}`}
            >
              {Number(r.netBalance) < 0
                ? `(${fmt(Math.abs(Number(r.netBalance)))})`
                : fmt(Number(r.netBalance))}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

export default function BalanceSheetPage() {
  const now = new Date();
  const [asOfDate, setAsOfDate] = useState(now.toISOString().split('T')[0]);
  const [companyId, setCompanyId] = useState('');
  const { cacheTtlReports } = useUiFlags();

  const {
    data: bs,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<BalanceSheetData>({
    queryKey: ['balance-sheet', asOfDate, companyId],
    queryFn: async () => {
      const params = new URLSearchParams({ asOfDate });
      if (companyId) params.set('companyId', companyId);
      return (await api.get(`/expenses/ledger/balance-sheet?${params}`)).data;
    },
    enabled: !!asOfDate,
    staleTime: cacheTtlReports * 1000,
  });

  const inputClass =
    'w-full px-3 py-2 border border-input rounded-lg focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden';

  return (
    <div>
      <PageHeader
        title="งบดุล"
        subtitle="Balance Sheet — ณ วันที่ระบุ"
        icon={<Scale className="size-6" />}
      />

      <div className="flex flex-wrap gap-3 mb-6">
        <div>
          <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            ณ วันที่
          </label>
          <ThaiDateInput
            value={asOfDate}
            onChange={(e) => setAsOfDate(e.target.value)}
            className={`${inputClass} w-auto`}
          />
        </div>
        <CompanyFilter value={companyId} onChange={setCompanyId} />
      </div>

      <QueryBoundary
        isLoading={isLoading && !bs}
        isError={isError}
        error={error}
        onRetry={refetch}
        errorTitle="ไม่สามารถโหลดงบดุลได้"
      >
        {bs ? (
          <>
            {/* Balanced badge */}
            <div className="flex items-center gap-2 mb-4">
              <span className="text-sm text-muted-foreground leading-snug">
                ณ วันที่ {formatDateMedium(bs.asOfDate)}
              </span>
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium leading-snug ${
                  bs.isBalanced
                    ? 'bg-success/10 text-success'
                    : 'bg-destructive/10 text-destructive'
                }`}
              >
                {bs.isBalanced ? 'Balanced ✓' : 'Unbalanced ✗'}
              </span>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              {/* Left: Assets */}
              <Card className="rounded-xl border border-border/50 bg-card shadow-sm">
                <CardHeader>
                  <h2 className="text-base font-bold leading-snug">สินทรัพย์ (Assets)</h2>
                </CardHeader>
                <CardContent className="space-y-0 pt-0">
                  <BSSection section={bs.assets.current} />
                  <BSSection section={bs.assets.nonCurrent} />
                  <div className="flex justify-between items-center pt-3 border-t-2 border-foreground font-bold leading-snug">
                    <span>รวมสินทรัพย์</span>
                    <span className="tabular-nums">{fmt(Number(bs.assets.total))}</span>
                  </div>
                </CardContent>
              </Card>

              {/* Right: Liabilities + Equity */}
              <Card className="rounded-xl border border-border/50 bg-card shadow-sm">
                <CardHeader>
                  <h2 className="text-base font-bold leading-snug">
                    หนี้สิน + ส่วนของผู้ถือหุ้น
                  </h2>
                </CardHeader>
                <CardContent className="space-y-0 pt-0">
                  <BSSection section={bs.liabilities.current} />
                  <BSSection section={bs.liabilities.nonCurrent} />
                  <div className="flex justify-between items-center py-1 font-medium text-sm leading-snug">
                    <span>รวมหนี้สิน</span>
                    <span className="tabular-nums">{fmt(Number(bs.liabilities.total))}</span>
                  </div>
                  <BSSection section={bs.equity} />
                  <div className="flex justify-between items-center py-1 font-medium text-sm leading-snug">
                    <span>รวมส่วนของผู้ถือหุ้น</span>
                    <span className="tabular-nums">{fmt(Number(bs.equity.total))}</span>
                  </div>
                  <div className="flex justify-between items-center pt-3 border-t-2 border-foreground font-bold leading-snug">
                    <span>รวมหนี้สิน + ส่วนของผู้ถือหุ้น</span>
                    <span className="tabular-nums">
                      {fmt(Number(bs.liabilities.total) + Number(bs.equity.total))}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </>
        ) : null}
      </QueryBoundary>
    </div>
  );
}
