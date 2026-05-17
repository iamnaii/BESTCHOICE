import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import {
  Banknote,
  TrendingUp,
  ArrowDownToLine,
  ArrowUpFromLine,
  Activity,
  AlertTriangle,
  CheckCircle2,
  Wallet,
} from 'lucide-react';
import { formatDateMedium } from '@/utils/formatters';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import CompanyFilter from '@/components/CompanyFilter';
import { useUiFlags } from '@/hooks/useUiFlags';

export interface CashFlowData {
  periodStart: string;
  periodEnd: string;
  method: 'indirect';
  operating: {
    netIncome: number;
    depreciation: number;
    badDebtProvisionChange: number;
    unearnedInterestChange: number;
    arChange: number;
    inventoryChange: number;
    apChange: number;
    vatPayableChange: number;
    netOperating: number;
  };
  investing: {
    ppePurchases: number;
    ppeDisposals: number;
    netInvesting: number;
  };
  financing: {
    capitalInjections: number;
    dividends: number;
    netFinancing: number;
  };
  netChange: number;
  openingCash: number;
  closingCash: number;
  actualCashChange: number;
  isReconciled: boolean;
  drift: number;
}

const inputClass =
  'w-full px-3 py-2 border border-input rounded-lg focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden';

function fmt(n: number | null | undefined): string {
  if (n == null) return '0.00';
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function CFRow({
  label,
  amount,
  bold,
  indent,
  sub,
  signal,
}: {
  label: string;
  amount: number;
  bold?: boolean;
  indent?: boolean;
  sub?: boolean;
  signal?: 'pos' | 'neg' | 'neutral';
}) {
  const isNeg = amount < 0;
  const colorClass =
    signal === 'pos'
      ? 'text-success'
      : signal === 'neg'
        ? 'text-destructive'
        : isNeg
          ? 'text-destructive'
          : '';
  return (
    <div
      className={`flex justify-between items-center py-1.5 leading-snug ${bold ? 'font-semibold border-t border-border pt-2' : ''} ${indent ? 'pl-6' : ''} ${sub ? 'text-muted-foreground text-sm' : ''}`}
    >
      <span>{label}</span>
      <span className={`tabular-nums ${colorClass} ${bold ? 'text-base' : 'text-sm'}`}>
        {isNeg ? `(${fmt(Math.abs(amount))})` : fmt(amount)}
      </span>
    </div>
  );
}

function SummaryCard({
  title,
  amount,
  icon,
  accent,
}: {
  title: string;
  amount: number;
  icon: React.ReactNode;
  accent: 'success' | 'sky' | 'warning' | 'primary' | 'destructive';
}) {
  const barClass = {
    success: 'bg-success',
    sky: 'bg-info',
    warning: 'bg-warning',
    primary: 'bg-primary',
    destructive: 'bg-destructive',
  }[accent];
  const valueColor = {
    success: 'text-success',
    sky: 'text-info',
    warning: 'text-warning',
    primary: 'text-primary',
    destructive: 'text-destructive',
  }[accent];
  return (
    <Card className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden hover:shadow-card-hover transition-all">
      <div className="flex h-full">
        <div className={`w-1 shrink-0 rounded-r-full ${barClass}`} />
        <div className="p-5 flex-1">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider leading-snug">
              {title}
            </span>
            <span className={valueColor}>{icon}</span>
          </div>
          <div className={`text-2xl font-bold tabular-nums ${valueColor}`}>{fmt(amount)}</div>
        </div>
      </div>
    </Card>
  );
}

export function CashFlowPage() {
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const [startDate, setStartDate] = useState(firstOfMonth.toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(now.toISOString().split('T')[0]);
  const [companyId, setCompanyId] = useState('');
  const { cacheTtlReports } = useUiFlags();
  const reportsStaleTime = cacheTtlReports * 1000;

  const {
    data: cf,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<CashFlowData>({
    queryKey: ['cash-flow', startDate, endDate, companyId],
    queryFn: async () => {
      const params = new URLSearchParams({ periodStart: startDate, periodEnd: endDate });
      if (companyId) params.set('companyId', companyId);
      return (await api.get(`/expenses/ledger/cash-flow?${params}`)).data;
    },
    enabled: !!startDate && !!endDate,
    staleTime: reportsStaleTime,
  });

  const isPositiveNetChange = (cf?.netChange ?? 0) >= 0;

  return (
    <div>
      <PageHeader
        title="งบกระแสเงินสด"
        subtitle="Cash Flow Statement — วิธีทางอ้อม (Indirect Method)"
        icon={<Banknote className="size-6" />}
      />

      {/* Filters */}
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
              label: '3 เดือนล่าสุด',
              fn: () => {
                const d = new Date();
                d.setMonth(d.getMonth() - 3);
                setStartDate(d.toISOString().split('T')[0]);
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
        isLoading={isLoading && !cf}
        isError={isError}
        error={error}
        onRetry={refetch}
        errorTitle="ไม่สามารถโหลดงบกระแสเงินสดได้"
      >
        {cf ? (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-5 mb-6">
              <SummaryCard
                title="กิจกรรมดำเนินงาน"
                amount={cf.operating.netOperating}
                icon={<Activity className="size-4" />}
                accent="success"
              />
              <SummaryCard
                title="กิจกรรมลงทุน"
                amount={cf.investing.netInvesting}
                icon={<ArrowDownToLine className="size-4" />}
                accent="sky"
              />
              <SummaryCard
                title="กิจกรรมจัดหาเงิน"
                amount={cf.financing.netFinancing}
                icon={<ArrowUpFromLine className="size-4" />}
                accent="warning"
              />
              <SummaryCard
                title="กระแสเงินสดสุทธิ"
                amount={cf.netChange}
                icon={<TrendingUp className="size-4" />}
                accent={isPositiveNetChange ? 'primary' : 'destructive'}
              />
            </div>

            {/* Reconciliation badge */}
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <div className="flex items-center gap-2 text-xs">
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-muted-foreground leading-snug">
                  <Activity className="size-3" />
                  วิธีทางอ้อม (Indirect Method)
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-muted-foreground leading-snug">
                  TFRS for NPAEs
                </span>
              </div>
              {cf.isReconciled ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 text-success px-2.5 py-1 text-xs leading-snug">
                  <CheckCircle2 className="size-3.5" />
                  Reconciled ±{fmt(Math.abs(cf.drift))}฿
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/10 text-warning px-2.5 py-1 text-xs leading-snug">
                  <AlertTriangle className="size-3.5" />
                  ข้อมูลคลาดเคลื่อน {fmt(Math.abs(cf.drift))}฿ — กรุณาตรวจสอบบัญชี
                </span>
              )}
            </div>

            {/* Sections */}
            <Card className="rounded-xl border border-border/50 bg-card shadow-sm">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold leading-snug">งบกระแสเงินสด</h2>
                  <span className="text-sm text-muted-foreground leading-snug">
                    {formatDateMedium(startDate)} — {formatDateMedium(endDate)}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-0">
                {/* Section 1 — Operating */}
                <section>
                  <div className="flex items-center gap-2 pt-2 pb-1 border-b border-border mb-1">
                    <span className="text-xs font-mono text-muted-foreground">1</span>
                    <span className="font-semibold text-foreground leading-snug">
                      กิจกรรมดำเนินงาน (Operating — Indirect)
                    </span>
                  </div>
                  <CFRow label="กำไรสุทธิ" amount={cf.operating.netIncome} indent />
                  <CFRow
                    label="บวก: ค่าเสื่อมราคา"
                    amount={cf.operating.depreciation}
                    indent
                    sub
                  />
                  <CFRow
                    label="บวก/หัก: การเปลี่ยนแปลงในค่าเผื่อหนี้สงสัยจะสูญ"
                    amount={cf.operating.badDebtProvisionChange}
                    indent
                    sub
                  />
                  <CFRow
                    label="บวก/หัก: การเปลี่ยนแปลงในรายได้รอตัดบัญชี-ดอกเบี้ย"
                    amount={cf.operating.unearnedInterestChange}
                    indent
                    sub
                  />
                  <CFRow
                    label="บวก/หัก: การเปลี่ยนแปลงในลูกหนี้การค้า"
                    amount={-cf.operating.arChange}
                    indent
                    sub
                  />
                  <CFRow
                    label="บวก/หัก: การเปลี่ยนแปลงในสินค้าคงเหลือ"
                    amount={-cf.operating.inventoryChange}
                    indent
                    sub
                  />
                  <CFRow
                    label="บวก/หัก: การเปลี่ยนแปลงในเจ้าหนี้การค้า"
                    amount={cf.operating.apChange}
                    indent
                    sub
                  />
                  <CFRow
                    label="บวก/หัก: การเปลี่ยนแปลงในภาษีขายรอนำส่ง"
                    amount={cf.operating.vatPayableChange}
                    indent
                    sub
                  />
                  <CFRow
                    label="กระแสเงินสดสุทธิจากกิจกรรมดำเนินงาน"
                    amount={cf.operating.netOperating}
                    bold
                  />
                </section>

                {/* Section 2 — Investing */}
                <section className="mt-4">
                  <div className="flex items-center gap-2 pt-2 pb-1 border-b border-border mb-1">
                    <span className="text-xs font-mono text-muted-foreground">2</span>
                    <span className="font-semibold text-foreground leading-snug">
                      กิจกรรมลงทุน (Investing)
                    </span>
                  </div>
                  {/* SP2 — known gap caveat (deferred to Phase A.5) */}
                  <div className="my-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-xs text-warning leading-snug flex items-start gap-2">
                    <AlertTriangle className="size-3.5 mt-0.5 shrink-0" />
                    <div>
                      หมวด <strong>กิจกรรมลงทุน</strong> ใช้ข้อมูลจาก FixedAsset โดยตรง —
                      หากมีการขายสินทรัพย์พร้อมกำไร/ขาดทุนในงวดเดียวกัน ตัวเลข Net Operating
                      + Net Investing อาจคลาดเคลื่อนเล็กน้อย (รอ Phase A.5
                      PPE/Depreciation flows). ตัวกรองบริษัทจะไม่มีผลกับยอด PPE
                      เนื่องจาก FixedAsset ยังไม่มี companyId scope.
                    </div>
                  </div>
                  <CFRow
                    label="ซื้อสินทรัพย์ถาวร"
                    amount={-cf.investing.ppePurchases}
                    indent
                    sub
                  />
                  <CFRow
                    label="ขายสินทรัพย์ถาวร"
                    amount={cf.investing.ppeDisposals}
                    indent
                    sub
                  />
                  <CFRow
                    label="กระแสเงินสดสุทธิจากกิจกรรมลงทุน"
                    amount={cf.investing.netInvesting}
                    bold
                  />
                </section>

                {/* Section 3 — Financing */}
                <section className="mt-4">
                  <div className="flex items-center gap-2 pt-2 pb-1 border-b border-border mb-1">
                    <span className="text-xs font-mono text-muted-foreground">3</span>
                    <span className="font-semibold text-foreground leading-snug">
                      กิจกรรมจัดหาเงิน (Financing)
                    </span>
                  </div>
                  <CFRow
                    label="เพิ่มทุน / ทุนรับเข้า"
                    amount={cf.financing.capitalInjections}
                    indent
                    sub
                  />
                  <CFRow
                    label="จ่ายเงินปันผล"
                    amount={-cf.financing.dividends}
                    indent
                    sub
                  />
                  <CFRow
                    label="กระแสเงินสดสุทธิจากกิจกรรมจัดหาเงิน"
                    amount={cf.financing.netFinancing}
                    bold
                  />
                </section>

                {/* Footer */}
                <section className="mt-6 pt-4 border-t-2 border-double border-foreground">
                  <CFRow label="เงินสดต้นงวด" amount={cf.openingCash} indent />
                  <CFRow label="เปลี่ยนแปลงสุทธิ" amount={cf.netChange} indent />
                  <div
                    className={`flex justify-between items-center py-3 mt-1 border-t border-border ${isPositiveNetChange ? 'text-primary' : 'text-destructive'}`}
                  >
                    <span className="text-lg font-bold leading-snug flex items-center gap-2">
                      <Wallet className="size-5" />
                      เงินสดปลายงวด (Closing Cash)
                    </span>
                    <span className="text-lg font-bold tabular-nums">{fmt(cf.closingCash)}</span>
                  </div>
                </section>
              </CardContent>
            </Card>
          </>
        ) : null}
      </QueryBoundary>
    </div>
  );
}

export default CashFlowPage;
