import { useId as useUiFieldId, useState } from 'react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useQuery, useMutation } from '@tanstack/react-query';
import api from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import PageHeader from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';
import AnimatedCounter from '@/components/ui/animated-counter';
import { toast } from 'sonner';
import { Download } from 'lucide-react';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { DateRangeChips } from '@/components/ui/DateRangeChips';
import { toLocalDateString } from '@/lib/date';
import { statusLabels } from '@/lib/constants';
import { useAuth } from '@/contexts/AuthContext';
import { contractsCsv } from './reports-csv';
import { NativeSelect } from '@/components/ui/native-select';
import { formLabelClass } from '@/components/ui/form-styles';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';

type ReportType = 'aging' | 'revenue' | 'high-risk' | 'sales' | 'branch' | 'daily-payment' | 'stock' | 'entity-profit';

/** Safe number formatter - prevents crash on undefined/null */
function fmt(val: unknown): string {
  return (Number(val) || 0).toLocaleString();
}

const reportTabs: { key: ReportType; label: string }[] = [
  { key: 'aging', label: 'อายุหนี้' },
  { key: 'revenue', label: 'รายได้ / กำไร-ขาดทุน' },
  { key: 'high-risk', label: 'ลูกค้าเสี่ยงสูง' },
  { key: 'sales', label: 'เปรียบเทียบพนักงาน' },
  { key: 'branch', label: 'เปรียบเทียบสาขา' },
  { key: 'daily-payment', label: 'ชำระรายวัน' },
  { key: 'stock', label: 'สต็อกสินค้า' },
  { key: 'entity-profit', label: 'กำไร Shop/Finance' },
];

type ReportPeriod = { startDate: string; endDate: string };
type PageResult<T> = { data: T[]; total: number; page: number; limit: number };
type RiskRow = { contractNumber: string; customer: { name: string; phone: string }; overdueInstallments: number; totalOutstanding: number };
type SalesRow = { salespersonId: string; name: string; totalContracts: number; totalSales: number; overdueCount: number; overdueRate: string };
type BranchRow = { branchId: string; branchName: string; newContracts: number; activeContracts: number; overdueContracts: number; paymentsReceived: number; inStockProducts: number };
type DailySummary = { totalPayments: number; totalAmount: number; byMethod: Record<string, { count: number; total: number }>; byBranch: Record<string, { count: number; total: number }>; total: number; page: number; limit: number };

function validPeriod({ startDate, endDate }: ReportPeriod) {
  return Boolean(startDate && endDate && startDate <= endDate);
}

function ReportPagination({ page, total, limit, onChange }: { page: number; total: number; limit: number; onChange: (page: number) => void }) {
  // A refetch may remove the last page; retain a way back to page one.
  if (total <= limit && page === 1) return null;
  const pages = Math.max(page, Math.ceil(total / limit));
  return <div className="mt-4 flex flex-wrap items-center justify-end gap-3 text-sm">
    <span>หน้า {page} / {pages} · {total} รายการ</span>
    <Button variant="outline" onClick={() => onChange(page - 1)} disabled={page <= 1}>ก่อนหน้า</Button>
    <Button variant="outline" onClick={() => onChange(page + 1)} disabled={page >= pages}>ถัดไป</Button>
  </div>;
}

function ReportDateFilter({ period, onChange }: { period: ReportPeriod; onChange: (period: ReportPeriod) => void }) {
  const id = useUiFieldId();
  return <div className="mb-5 space-y-4 rounded-xl border border-border bg-card p-4">
    <DateRangeChips {...period} showAllChip={false} onChange={onChange} />
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:max-w-xl">
      <div><label htmlFor={`${id}-from`} className={formLabelClass}>จากวันที่</label><ThaiDateInput id={`${id}-from`} data-date-range-custom-start="true" value={period.startDate} onChange={e => onChange({ ...period, startDate: e.target.value })} /></div>
      <div><label htmlFor={`${id}-to`} className={formLabelClass}>ถึงวันที่</label><ThaiDateInput id={`${id}-to`} value={period.endDate} onChange={e => onChange({ ...period, endDate: e.target.value })} /></div>
    </div>
    {!validPeriod(period) && <p role="status" className="text-sm text-muted-foreground">เลือกวันที่ให้ครบ โดยวันสิ้นสุดต้องไม่ก่อนวันเริ่มต้น</p>}
  </div>;
}

export default function ReportsPage() {
  useDocumentTitle('รายงาน');
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<ReportType>('aging');
  const availableTabs = reportTabs.filter(tab => user?.role !== 'BRANCH_MANAGER' || !['branch', 'entity-profit'].includes(tab.key));
  const [dateFilter, setDateFilter] = useState(toLocalDateString());
  const [period, setPeriod] = useState<ReportPeriod>(() => {
    const now = new Date();
    return { startDate: toLocalDateString(new Date(now.getFullYear(), now.getMonth(), 1)), endDate: toLocalDateString(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
  });

  const exportMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.get<Record<string, unknown>[]>('/reports/export/contracts');
      if (data.length >= 5000) toast.info('ไฟล์นี้รวมสัญญาล่าสุด 5,000 รายการ');
      const url = window.URL.createObjectURL(new Blob([contractsCsv(data)], { type: 'text/csv;charset=utf-8;' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `contracts-export-${toLocalDateString()}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    },
    onSuccess: () => toast.success('ดาวน์โหลด CSV สำเร็จ'),
    onError: () => toast.error('ไม่สามารถดาวน์โหลดได้'),
  });

  return (
    <div>
      <PageHeader
        title="รายงาน"
        subtitle="รายงานสรุปข้อมูลต่างๆ"
        action={
          <Button variant="outline" size="md" title="สัญญาทุกช่วงเวลา สูงสุด 5,000 รายการล่าสุด ตามสิทธิ์ที่เข้าถึงได้" onClick={() => exportMutation.mutate()} disabled={exportMutation.isPending}>
            <Download className="size-4" />
            {exportMutation.isPending ? 'กำลังดาวน์โหลด...' : 'ส่งออกสัญญา CSV'}
          </Button>
        }
      />

      <div className="mb-5 sm:hidden">
        <NativeSelect aria-label="เลือกรายงาน" value={activeTab} onChange={event => setActiveTab(event.target.value as ReportType)}>
          {availableTabs.map(tab => <option key={tab.key} value={tab.key}>{tab.label}</option>)}
        </NativeSelect>
      </div>
      <div className="hidden flex-wrap gap-1 mb-6 bg-muted rounded-xl p-1 sm:flex">
        {availableTabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            aria-pressed={activeTab === tab.key}
            className={`min-h-11 px-3 py-2 text-xs font-medium rounded-lg transition-colors ${
              activeTab === tab.key
                ? 'bg-card text-primary shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {['revenue', 'sales', 'branch'].includes(activeTab) && <ReportDateFilter period={period} onChange={setPeriod} />}
      {activeTab === 'aging' && <AgingReport />}
      {activeTab === 'revenue' && <RevenueReport period={period} />}
      {activeTab === 'high-risk' && <HighRiskReport />}
      {activeTab === 'sales' && <SalesReport key={`${period.startDate}-${period.endDate}`} period={period} />}
      {activeTab === 'branch' && <BranchReport period={period} />}
      {activeTab === 'daily-payment' && <DailyPaymentReport date={dateFilter} onDateChange={setDateFilter} />}
      {activeTab === 'stock' && <StockReport />}
      {activeTab === 'entity-profit' && <EntityProfitReport />}
    </div>
  );
}

function AgingReport() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['report-aging'],
    queryFn: async () => (await api.get('/reports/aging')).data,
  });

  const buckets = ['1-30', '31-60', '61-90', '90+'].map(range => ({ range, count: data?.[range]?.count ?? 0, amount: data?.[range]?.totalOutstanding ?? 0 }));
  const total = { count: data?.total?.count ?? 0, amount: data?.total?.totalOutstanding ?? 0 };

  const agingColors = ['hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))'];

  return (
    <QueryBoundary isLoading={isLoading} isError={isError} error={error} onRetry={() => refetch()} errorTitle="ไม่สามารถโหลดรายงานอายุหนี้ได้">
    <div className="space-y-5">
      {/* Aging Bar Chart */}
      {buckets.length > 0 && (
        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">กราฟอายุหนี้</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={buckets} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="range" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
              <RechartsTooltip
                contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '12px' }}
                formatter={(value) => [`${Number(value).toLocaleString()} ฿`, 'ยอดค้าง']}
              />
              <Bar dataKey="amount" radius={[6, 6, 0, 0]}>
                {buckets.map((_: unknown, i: number) => (
                  <Cell key={i} fill={agingColors[Math.min(i, agingColors.length - 1)]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Aging Table */}
      <div className="bg-card rounded-xl border border-border p-5">
        <h3 className="text-sm font-semibold text-foreground mb-4">รายงานอายุหนี้ (Aging Report)</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm [&_th]:whitespace-nowrap">
            <thead>
              <tr className="bg-muted/40 border-b border-border/60 text-left text-muted-foreground">
                <th className="pb-2 font-medium">ช่วงวัน</th>
                <th className="pb-2 font-medium text-right">จำนวนงวด</th>
                <th className="pb-2 font-medium text-right">ยอดค้างชำระ (บาท)</th>
                <th className="pb-2 font-medium text-right">สัดส่วน</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((b: { range: string; count: number; amount: number }) => (
                <tr key={b.range} className="border-b">
                  <td className="py-2 font-medium">{b.range}</td>
                  <td className="py-2 text-right">{b.count}</td>
                  <td className="py-2 text-right text-destructive">{fmt(b.amount)}</td>
                  <td className="py-2 text-right text-muted-foreground">
                    {total.amount > 0 ? ((b.amount / total.amount) * 100).toFixed(1) : 0}%
                  </td>
                </tr>
              ))}
              <tr className="font-semibold bg-muted">
                <td className="py-2">รวม</td>
                <td className="py-2 text-right">{total.count}</td>
                <td className="py-2 text-right text-destructive">{fmt(total.amount)}</td>
                <td className="py-2 text-right">100%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
    </QueryBoundary>
  );
}

function RevenueReport({ period }: { period: ReportPeriod }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['report-revenue', period.startDate, period.endDate],
    enabled: validPeriod(period),
    queryFn: async () => (await api.get(`/reports/revenue-pl?${new URLSearchParams(period)}`)).data,
  });

  if (!validPeriod(period)) return null;

  return (
    <QueryBoundary isLoading={isLoading} isError={isError} error={error} onRetry={() => refetch()} errorTitle="ไม่สามารถโหลดรายงานรายได้ได้">
      <div className="bg-card rounded-xl border border-border p-5">
        <h3 className="text-sm font-semibold text-foreground mb-4">รายงานรายได้ / กำไร-ขาดทุน</h3>
        <div className="grid grid-cols-1 min-[390px]:grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard label="รายได้ดอกเบี้ย" value={data?.revenue?.interestIncome || 0} color="text-success" />
          <SummaryCard label="ค่าปรับ" value={data?.revenue?.lateFeeIncome || 0} color="text-warning-strong" />
          <SummaryCard label="ยอดชำระรับ" value={data?.revenue?.totalPaymentsReceived || 0} color="text-primary" />
          <SummaryCard label="รายการรับชำระ" value={data?.revenue?.paymentCount || 0} isCurrency={false} />
        </div>
      </div>
    </QueryBoundary>
  );
}

function HighRiskReport() {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['report-high-risk', page],
    queryFn: async () => (await api.get<PageResult<RiskRow>>(`/reports/high-risk?page=${page}&limit=50`)).data,
  });

  return (
    <QueryBoundary isLoading={isLoading} isError={isError} error={error} onRetry={() => refetch()} errorTitle="ไม่สามารถโหลดรายงานลูกค้าเสี่ยงสูงได้">
    <div className="bg-card rounded-lg border border-border p-5">
      <h3 className="text-sm font-semibold text-foreground mb-4">ลูกค้าเสี่ยงสูง</h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm [&_th]:whitespace-nowrap">
          <thead>
            <tr className="bg-muted/40 border-b border-border/60 text-left text-muted-foreground">
              <th className="pb-2 font-medium">ลูกค้า</th>
              <th className="pb-2 font-medium">เบอร์โทร</th>
              <th className="pb-2 font-medium text-right">งวดที่ยังไม่ชำระ</th>
              <th className="pb-2 font-medium text-right">ยอดค้าง (บาท)</th>
            </tr>
          </thead>
          <tbody>
            {(data?.data ?? []).map((c) => (
              <tr key={c.contractNumber} className="border-b last:border-0">
                <td className="py-2 font-medium">{c.customer.name}<div className="text-xs text-muted-foreground">{c.contractNumber}</div></td>
                <td className="py-2 text-muted-foreground">{c.customer.phone}</td>
                <td className="py-2 text-right">{c.overdueInstallments}</td>
                <td className="py-2 text-right text-destructive font-medium">
                  {fmt(c.totalOutstanding)}
                </td>
              </tr>
            ))}
            {data?.data.length === 0 && (
              <tr>
                <td colSpan={4} className="py-8 text-center text-muted-foreground">ไม่พบข้อมูล</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <ReportPagination page={page} total={data?.total ?? 0} limit={data?.limit ?? 50} onChange={setPage} />
    </div>
    </QueryBoundary>
  );
}

function SalesReport({ period }: { period: ReportPeriod }) {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['report-sales', period.startDate, period.endDate, page],
    enabled: validPeriod(period),
    queryFn: async () => (await api.get<PageResult<SalesRow>>(`/reports/sales-comparison?${new URLSearchParams({ ...period, page: String(page), limit: '50' })}`)).data,
  });

  if (!validPeriod(period)) return null;

  return (
    <QueryBoundary isLoading={isLoading} isError={isError} error={error} onRetry={() => refetch()} errorTitle="ไม่สามารถโหลดรายงานพนักงานขายได้">
    <div className="bg-card rounded-lg border border-border p-5">
      <h3 className="text-sm font-semibold text-foreground mb-4">เปรียบเทียบพนักงานขาย</h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm [&_th]:whitespace-nowrap">
          <thead>
            <tr className="bg-muted/40 border-b border-border/60 text-left text-muted-foreground">
              <th className="pb-2 font-medium">พนักงาน</th>
              <th className="pb-2 font-medium text-right">สัญญาทั้งหมด</th>
              <th className="pb-2 font-medium text-right">ยอดขาย (บาท)</th>
              <th className="pb-2 font-medium text-right">ค้างชำระ</th>
              <th className="pb-2 font-medium text-right">อัตราค้าง</th>
            </tr>
          </thead>
          <tbody>
            {(data?.data ?? []).map((s) => (
              <tr key={s.salespersonId} className="border-b last:border-0">
                <td className="py-2 font-medium">{s.name}</td>
                <td className="py-2 text-right">{s.totalContracts}</td>
                <td className="py-2 text-right">{fmt(s.totalSales)}</td>
                <td className="py-2 text-right">
                  <span className={s.overdueCount > 0 ? 'text-destructive font-medium' : ''}>
                    {s.overdueCount}
                  </span>
                </td>
                <td className="py-2 text-right">
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      Number(s.overdueRate) > 20
                        ? 'bg-destructive/10 text-destructive dark:bg-destructive/15'
                        : Number(s.overdueRate) > 10
                          ? 'bg-warning/10 text-warning-strong dark:bg-warning/15'
                          : 'bg-success/10 text-success dark:bg-success/15'
                    }`}
                  >
                    {Number(s.overdueRate).toFixed(1)}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ReportPagination page={page} total={data?.total ?? 0} limit={data?.limit ?? 50} onChange={setPage} />
    </div>
    </QueryBoundary>
  );
}

function BranchReport({ period }: { period: ReportPeriod }) {
  const { data = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['report-branch', period.startDate, period.endDate],
    enabled: validPeriod(period),
    queryFn: async () => (await api.get<BranchRow[]>(`/reports/branch-comparison?${new URLSearchParams(period)}`)).data,
  });

  if (!validPeriod(period)) return null;

  return (
    <QueryBoundary isLoading={isLoading} isError={isError} error={error} onRetry={() => refetch()} errorTitle="ไม่สามารถโหลดรายงานเปรียบเทียบสาขาได้">
    <div className="bg-card rounded-lg border border-border p-5">
      <h3 className="text-sm font-semibold text-foreground mb-4">เปรียบเทียบสาขา</h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm [&_th]:whitespace-nowrap">
          <thead>
            <tr className="bg-muted/40 border-b border-border/60 text-left text-muted-foreground">
              <th className="pb-2 font-medium">สาขา</th>
              <th className="pb-2 font-medium text-right">สัญญาใหม่</th>
              <th className="pb-2 font-medium text-right">สัญญาที่ใช้งานปัจจุบัน</th>
              <th className="pb-2 font-medium text-right">ค้างชำระปัจจุบัน</th>
              <th className="pb-2 font-medium text-right">ยอดชำระ (บาท)</th>
              <th className="pb-2 font-medium text-right">สต็อกปัจจุบัน</th>
            </tr>
          </thead>
          <tbody>
            {data.map((b) => (
              <tr key={b.branchId} className="border-b last:border-0">
                <td className="py-2 font-medium">{b.branchName}</td>
                <td className="py-2 text-right">{b.newContracts}</td>
                <td className="py-2 text-right">{b.activeContracts}</td>
                <td className="py-2 text-right text-destructive">{b.overdueContracts}</td>
                <td className="py-2 text-right text-success">{fmt(b.paymentsReceived)}</td>
                <td className="py-2 text-right">{b.inStockProducts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
    </QueryBoundary>
  );
}

function DailyPaymentReport({ date, onDateChange }: { date: string; onDateChange: (d: string) => void }) {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['report-daily-payment', date, page],
    enabled: Boolean(date),
    queryFn: async () => (await api.get<DailySummary>(`/reports/daily-payments?date=${date}&page=${page}&limit=50`)).data,
  });

  return (
    <QueryBoundary isLoading={isLoading} isError={isError} error={error} onRetry={() => refetch()} errorTitle="ไม่สามารถโหลดรายงานชำระรายวันได้">
    <div className="bg-card rounded-lg border border-border p-5">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <h3 className="text-sm font-semibold text-foreground">สรุปชำระรายวัน</h3>
        <ThaiDateInput aria-label="วันที่"
          value={date}
          onChange={(e) => { setPage(1); onDateChange(e.target.value); }}
          className="px-3 py-1.5 border rounded-lg text-sm"
        />
      </div>
      {!date && <p role="status" className="text-sm text-muted-foreground">เลือกวันที่เพื่อดูรายการรับชำระ</p>}
      {date && <>
      <div className="grid grid-cols-1 min-[390px]:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <SummaryCard label="รายการชำระ" value={data?.totalPayments || 0} isCurrency={false} />
        <SummaryCard label="ยอดรวม" value={data?.totalAmount || 0} color="text-success" />
        <SummaryCard label={data && data.total > data.limit ? "เงินสด (หน้านี้)" : "เงินสด"} value={data?.byMethod?.CASH?.total || 0} color="text-primary" />
        <SummaryCard label={data && data.total > data.limit ? "โอน (หน้านี้)" : "โอน"} value={data?.byMethod?.BANK_TRANSFER?.total || 0} color="text-primary" />
      </div>
      {data && data.total > data.limit && <p className="mb-3 text-sm text-muted-foreground">ยอดรวมครอบคลุมทั้งวัน · เงินสด โอน และยอดตามสาขาแสดงเฉพาะรายการในหน้านี้</p>}
      {data?.byBranch && Object.keys(data.byBranch).length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm [&_th]:whitespace-nowrap">
            <thead>
              <tr className="bg-muted/40 border-b border-border/60 text-left text-muted-foreground">
                <th className="pb-2 font-medium">สาขา</th>
                <th className="pb-2 font-medium text-right">รายการ</th>
                <th className="pb-2 font-medium text-right">ยอดรวม (บาท)</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(data.byBranch).map(([branchName, summary]) => (
                <tr key={branchName} className="border-b last:border-0">
                  <td className="py-2 font-medium">{branchName}</td>
                  <td className="py-2 text-right">{summary.count}</td>
                  <td className="py-2 text-right text-success">{fmt(summary.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ReportPagination page={page} total={data?.total ?? 0} limit={data?.limit ?? 50} onChange={setPage} />
      </>}
    </div>
    </QueryBoundary>
  );
}

function StockReport() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['report-stock'],
    queryFn: async () => (await api.get<{ totalInStock: number; totalStockValue: number; byStatusAndBranch: Array<{ status: string; branch: string; count: number }> }>('/reports/stock')).data,
  });
  return <QueryBoundary isLoading={isLoading} isError={isError} error={error} onRetry={() => refetch()} errorTitle="ไม่สามารถโหลดรายงานสต็อกสินค้าได้">
    <div className="space-y-5 rounded-xl border border-border bg-card p-5">
      <h3 className="text-sm font-semibold">สต็อกตามสถานะและสาขา</h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SummaryCard label="พร้อมขาย" value={data?.totalInStock ?? 0} isCurrency={false} />
        <SummaryCard label="มูลค่าต้นทุนสินค้าพร้อมขาย" value={data?.totalStockValue ?? 0} color="text-primary" />
      </div>
      <div className="overflow-x-auto"><table className="w-full min-w-[26rem] text-sm"><thead><tr className="border-b text-left text-muted-foreground"><th className="py-2">สาขา</th><th className="py-2">สถานะ</th><th className="py-2 text-right">จำนวน</th></tr></thead>
        <tbody>{data?.byStatusAndBranch.map(row => <tr key={`${row.branch}-${row.status}`} className="border-b last:border-0"><td className="py-3">{row.branch}</td><td>{statusLabels[row.status]?.label ?? row.status}</td><td className="text-right">{row.count}</td></tr>)}</tbody>
      </table></div>
    </div>
  </QueryBoundary>;
}

function EntityProfitReport() {
  const uiFieldId = useUiFieldId();
  // Default = full current month, matching the DateRangeChips "เดือนนี้"
  // preset (owner 2026-07-02). Uses the shared local-date helper (@/lib/date).
  const today = new Date();
  const firstDay = toLocalDateString(new Date(today.getFullYear(), today.getMonth(), 1));
  const lastDay = toLocalDateString(new Date(today.getFullYear(), today.getMonth() + 1, 0));
  const [startDate, setStartDate] = useState(firstDay);
  const [endDate, setEndDate] = useState(lastDay);
  const [entity, setEntity] = useState<string>('ALL');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['report-entity-profit', startDate, endDate, entity],
    enabled: validPeriod({ startDate, endDate }),
    queryFn: async () => {
      const params = new URLSearchParams({ startDate, endDate });
      if (entity !== 'ALL') params.set('entity', entity);
      return (await api.get(`/reports/entity-profit?${params}`)).data;
    },
  });

  const shop = data?.shop || { revenue: 0, costOfGoods: 0, commission: 0, profit: 0, transactionCount: 0 };
  const finance = data?.finance || { interestIncome: 0, commissionExpense: 0, lateFeeIncome: 0, profit: 0, transactionCount: 0 };
  const combined = data?.combined || { totalProfit: 0, totalVat: 0 };
  const details = data?.details || [];

  return (
    <div className="space-y-5">
      {/* Date Filters */}
      <div className="bg-card rounded-xl border border-border p-4">
        <div className="mb-3">
          <DateRangeChips
            startDate={startDate}
            endDate={endDate}
            showAllChip={false}
            onChange={({ startDate: sd, endDate: ed }) => {
              setStartDate(sd);
              setEndDate(ed);
            }}
          />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor={`${uiFieldId}-1`} className={formLabelClass}>จากวันที่</label>
            <ThaiDateInput id={`${uiFieldId}-1`}
              data-date-range-custom-start="true"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor={`${uiFieldId}-2`} className={formLabelClass}>ถึงวันที่</label>
            <ThaiDateInput id={`${uiFieldId}-2`} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
          <div>
            <label htmlFor={`${uiFieldId}-3`} className={formLabelClass}>แสดง</label>
            <NativeSelect id={`${uiFieldId}-3`}
              value={entity}
              onChange={(e) => setEntity(e.target.value)}
              className="h-9 px-3 text-sm border border-border rounded-lg bg-background"
            >
              <option value="ALL">ทั้งหมด</option>
              <option value="SHOP">BESTCHOICE SHOP</option>
              <option value="FINANCE">BESTCHOICE FINANCE</option>
            </NativeSelect>
          </div>
        </div>
      </div>

      {!validPeriod({ startDate, endDate }) && <p role="status" className="text-sm text-muted-foreground">เลือกช่วงวันที่ให้ครบและเรียงจากวันเริ่มต้นถึงวันสิ้นสุด</p>}
      {validPeriod({ startDate, endDate }) && <QueryBoundary isLoading={isLoading} isError={isError} error={error} onRetry={() => refetch()} errorTitle="ไม่สามารถโหลดรายงานกำไร Shop/Finance ได้">

      {/* Summary Cards */}
      {(entity === 'ALL' || entity === 'SHOP') && (
        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">BESTCHOICE SHOP</h3>
          <div className="grid grid-cols-1 min-[390px]:grid-cols-2 lg:grid-cols-4 gap-4">
            <SummaryCard label="รายได้รวม" value={shop.revenue} color="text-primary" />
            <SummaryCard label="ต้นทุนสินค้า" value={shop.costOfGoods} color="text-muted-foreground" />
            <SummaryCard label="ค่าคอมมิชชัน" value={shop.commission} color="text-success" />
            <SummaryCard label="กำไร Shop" value={shop.profit} color="text-success" />
          </div>
          <div className="text-xs text-muted-foreground mt-3">
            สูตร: เงินดาวน์ + เงินต้น + คอมมิชชัน - ต้นทุนสินค้า | จำนวน {shop.transactionCount} รายการ
          </div>
        </div>
      )}

      {(entity === 'ALL' || entity === 'FINANCE') && (
        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">BESTCHOICE FINANCE</h3>
          <div className="grid grid-cols-1 min-[390px]:grid-cols-2 lg:grid-cols-4 gap-4">
            <SummaryCard label="รายได้ดอกเบี้ย" value={finance.interestIncome} color="text-primary" />
            <SummaryCard label="จ่ายคอมมิชชัน" value={finance.commissionExpense} color="text-destructive" />
            <SummaryCard label="ค่าปรับล่าช้า" value={finance.lateFeeIncome} color="text-warning-strong" />
            <SummaryCard label="กำไร Finance" value={finance.profit} color="text-success" />
          </div>
          <div className="text-xs text-muted-foreground mt-3">
            สูตร: ดอกเบี้ยรวม - คอมมิชชัน + ค่าปรับล่าช้า | จำนวน {finance.transactionCount} รายการ
          </div>
        </div>
      )}

      {entity === 'ALL' && (
        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">รวมทั้งระบบ</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SummaryCard label="กำไรรวม (SHOP + FINANCE)" value={combined.totalProfit} color="text-success" />
            <SummaryCard label="VAT รวม" value={combined.totalVat} color="text-muted-foreground" />
          </div>
        </div>
      )}

      {/* Detail Table */}
      {details.length > 0 && (
        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">รายละเอียด</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm [&_th]:whitespace-nowrap">
              <thead>
                <tr className="bg-muted/40 border-b border-border/60 text-left text-muted-foreground">
                  <th className="pb-2 font-medium">เลขที่ขาย</th>
                  <th className="pb-2 font-medium">ลูกค้า</th>
                  <th className="pb-2 font-medium">สาขา</th>
                  <th className="pb-2 font-medium text-right">ราคาขาย</th>
                  <th className="pb-2 font-medium text-right">ต้นทุน</th>
                  <th className="pb-2 font-medium text-right">เงินดาวน์</th>
                  <th className="pb-2 font-medium text-right">เงินต้น</th>
                  <th className="pb-2 font-medium text-right">คอมมิชชัน</th>
                  <th className="pb-2 font-medium text-right">กำไร Shop</th>
                  <th className="pb-2 font-medium text-right">กำไร Finance</th>
                </tr>
              </thead>
              <tbody>
                {details.map((d: {
                  id: string; saleNumber: string; customerName: string; branchName: string;
                  sellingPrice: number; costPrice: number; downPayment: number; principal: number;
                  commission: number; shopProfit: number; financeProfit: number;
                }) => (
                  <tr key={d.id} className="border-b last:border-0">
                    <td className="py-2 font-medium">{d.saleNumber}</td>
                    <td className="py-2">{d.customerName}</td>
                    <td className="py-2 text-muted-foreground">{d.branchName}</td>
                    <td className="py-2 text-right">{fmt(d.sellingPrice)}</td>
                    <td className="py-2 text-right text-muted-foreground">{fmt(d.costPrice)}</td>
                    <td className="py-2 text-right">{fmt(d.downPayment)}</td>
                    <td className="py-2 text-right">{fmt(d.principal)}</td>
                    <td className="py-2 text-right text-primary">{fmt(d.commission)}</td>
                    <td className="py-2 text-right text-success font-medium">{fmt(d.shopProfit)}</td>
                    <td className="py-2 text-right text-success font-medium">{fmt(d.financeProfit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {details.length === 0 && (
        <div className="bg-card rounded-xl border border-border p-8 text-center text-muted-foreground text-sm">
          ไม่พบข้อมูล Inter-Company Transaction ในช่วงเวลาที่เลือก
        </div>
      )}

      </QueryBoundary>}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  color = 'text-foreground',
  isCurrency = true,
}: {
  label: string;
  value: number;
  color?: string;
  isCurrency?: boolean;
}) {
  return (
    <div className="min-w-0 bg-muted rounded-xl p-4">
      <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">{label}</div>
      <AnimatedCounter value={value} decimals={isCurrency ? 2 : 0} className={`break-words text-lg font-bold ${color}`} />
      {isCurrency && <div className="text-xs text-muted-foreground mt-0.5">บาท</div>}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="bg-card rounded-xl border border-border p-8 text-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-3" />
      <div className="text-sm text-muted-foreground">กำลังโหลดข้อมูล...</div>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="bg-card rounded-xl border border-border p-8 text-center">
      <div className="size-10 rounded-xl bg-destructive/10 flex items-center justify-center mx-auto mb-3">
        <span className="text-destructive text-lg font-bold">!</span>
      </div>
      <div className="text-sm text-muted-foreground mb-3">ไม่สามารถโหลดข้อมูลรายงานได้</div>
      <Button variant="destructive" appearance="ghost" size="sm" onClick={onRetry}>
        ลองใหม่
      </Button>
    </div>
  );
}
