import { useState } from 'react';
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

export default function ReportsPage() {
  useDocumentTitle('รายงาน');
  const [activeTab, setActiveTab] = useState<ReportType>('aging');
  const [dateFilter, setDateFilter] = useState(new Date().toISOString().slice(0, 10));

  const exportMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.get('/reports/export/contracts', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `contracts-export-${new Date().toISOString().slice(0, 10)}.csv`;
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
          <Button variant="outline" size="md" onClick={() => exportMutation.mutate()} disabled={exportMutation.isPending}>
            <Download className="size-4" />
            {exportMutation.isPending ? 'กำลังดาวน์โหลด...' : 'ส่งออก CSV'}
          </Button>
        }
      />

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 mb-6 bg-muted rounded-xl p-1">
        {reportTabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-2 text-xs font-medium rounded-lg transition-colors ${
              activeTab === tab.key
                ? 'bg-card text-primary shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'aging' && <AgingReport />}
      {activeTab === 'revenue' && <RevenueReport />}
      {activeTab === 'high-risk' && <HighRiskReport />}
      {activeTab === 'sales' && <SalesReport />}
      {activeTab === 'branch' && <BranchReport />}
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

  const buckets = data?.buckets || [];
  const total = data?.total || { count: 0, amount: 0 };

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
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 border-b border-border/60 text-left text-muted-foreground">
                <th className="pb-2 font-medium">ช่วงวัน</th>
                <th className="pb-2 font-medium text-right">จำนวนสัญญา</th>
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

function RevenueReport() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['report-revenue'],
    queryFn: async () => (await api.get('/reports/revenue-pl')).data,
  });

  return (
    <QueryBoundary isLoading={isLoading} isError={isError} error={error} onRetry={() => refetch()} errorTitle="ไม่สามารถโหลดรายงานรายได้ได้">
      <div className="bg-card rounded-xl border border-border p-5">
        <h3 className="text-sm font-semibold text-foreground mb-4">รายงานรายได้ / กำไร-ขาดทุน</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard label="รายได้ดอกเบี้ย" value={data?.interestIncome || 0} color="text-success" />
          <SummaryCard label="ค่าปรับ" value={data?.lateFeeIncome || 0} color="text-warning" />
          <SummaryCard label="ยอดชำระรับ" value={data?.paymentsReceived || 0} color="text-primary" />
          <SummaryCard label="ยอดค้างชำระ" value={data?.outstandingTotal || 0} color="text-destructive" />
        </div>
      </div>
    </QueryBoundary>
  );
}

function HighRiskReport() {
  const { data = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['report-high-risk'],
    queryFn: async () => (await api.get('/reports/high-risk')).data,
  });

  return (
    <QueryBoundary isLoading={isLoading} isError={isError} error={error} onRetry={() => refetch()} errorTitle="ไม่สามารถโหลดรายงานลูกค้าเสี่ยงสูงได้">
    <div className="bg-card rounded-lg border border-border p-5">
      <h3 className="text-sm font-semibold text-foreground mb-4">ลูกค้าเสี่ยงสูง</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/40 border-b border-border/60 text-left text-muted-foreground">
              <th className="pb-2 font-medium">ลูกค้า</th>
              <th className="pb-2 font-medium">เบอร์โทร</th>
              <th className="pb-2 font-medium text-right">สัญญาค้าง</th>
              <th className="pb-2 font-medium text-right">ยอดค้าง (บาท)</th>
            </tr>
          </thead>
          <tbody>
            {(data as { name: string; phone: string; overdueContracts: number; totalOutstanding: number }[]).map((c) => (
              <tr key={c.phone || c.name} className="border-b last:border-0">
                <td className="py-2 font-medium">{c.name}</td>
                <td className="py-2 text-muted-foreground">{c.phone}</td>
                <td className="py-2 text-right">{c.overdueContracts}</td>
                <td className="py-2 text-right text-destructive font-medium">
                  {fmt(c.totalOutstanding)}
                </td>
              </tr>
            ))}
            {data.length === 0 && (
              <tr>
                <td colSpan={4} className="py-8 text-center text-muted-foreground">ไม่พบข้อมูล</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
    </QueryBoundary>
  );
}

function SalesReport() {
  const { data = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['report-sales'],
    queryFn: async () => (await api.get('/reports/sales-comparison')).data,
  });

  return (
    <QueryBoundary isLoading={isLoading} isError={isError} error={error} onRetry={() => refetch()} errorTitle="ไม่สามารถโหลดรายงานพนักงานขายได้">
    <div className="bg-card rounded-lg border border-border p-5">
      <h3 className="text-sm font-semibold text-foreground mb-4">เปรียบเทียบพนักงานขาย</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
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
            {(data as { name: string; totalContracts: number; totalSales: number; overdueContracts: number; overdueRate: number }[]).map((s) => (
              <tr key={s.name} className="border-b last:border-0">
                <td className="py-2 font-medium">{s.name}</td>
                <td className="py-2 text-right">{s.totalContracts}</td>
                <td className="py-2 text-right">{fmt(s.totalSales)}</td>
                <td className="py-2 text-right">
                  <span className={s.overdueContracts > 0 ? 'text-destructive font-medium' : ''}>
                    {s.overdueContracts}
                  </span>
                </td>
                <td className="py-2 text-right">
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      s.overdueRate > 20
                        ? 'bg-destructive/10 text-destructive dark:bg-destructive/15'
                        : s.overdueRate > 10
                          ? 'bg-warning/10 text-warning dark:bg-warning/15'
                          : 'bg-success/10 text-success dark:bg-success/15'
                    }`}
                  >
                    {s.overdueRate.toFixed(1)}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
    </QueryBoundary>
  );
}

function BranchReport() {
  const { data = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['report-branch'],
    queryFn: async () => (await api.get('/reports/branch-comparison')).data,
  });

  return (
    <QueryBoundary isLoading={isLoading} isError={isError} error={error} onRetry={() => refetch()} errorTitle="ไม่สามารถโหลดรายงานเปรียบเทียบสาขาได้">
    <div className="bg-card rounded-lg border border-border p-5">
      <h3 className="text-sm font-semibold text-foreground mb-4">เปรียบเทียบสาขา</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/40 border-b border-border/60 text-left text-muted-foreground">
              <th className="pb-2 font-medium">สาขา</th>
              <th className="pb-2 font-medium text-right">สัญญา</th>
              <th className="pb-2 font-medium text-right">ยอดขาย (บาท)</th>
              <th className="pb-2 font-medium text-right">ค้างชำระ</th>
              <th className="pb-2 font-medium text-right">ยอดชำระ (บาท)</th>
              <th className="pb-2 font-medium text-right">สต็อก</th>
            </tr>
          </thead>
          <tbody>
            {(data as { branchName: string; contracts: number; totalSales: number; overdueContracts: number; paymentsReceived: number; stockCount: number }[]).map((b) => (
              <tr key={b.branchName} className="border-b last:border-0">
                <td className="py-2 font-medium">{b.branchName}</td>
                <td className="py-2 text-right">{b.contracts}</td>
                <td className="py-2 text-right">{fmt(b.totalSales)}</td>
                <td className="py-2 text-right text-destructive">{b.overdueContracts}</td>
                <td className="py-2 text-right text-success">{fmt(b.paymentsReceived)}</td>
                <td className="py-2 text-right">{b.stockCount}</td>
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
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['report-daily-payment', date],
    queryFn: async () => (await api.get(`/reports/daily-payments?date=${date}`)).data,
  });

  return (
    <QueryBoundary isLoading={isLoading} isError={isError} error={error} onRetry={() => refetch()} errorTitle="ไม่สามารถโหลดรายงานชำระรายวันได้">
    <div className="bg-card rounded-lg border border-border p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground">สรุปชำระรายวัน</h3>
        <ThaiDateInput
          value={date}
          onChange={(e) => onDateChange(e.target.value)}
          className="px-3 py-1.5 border rounded-lg text-sm"
        />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <SummaryCard label="รายการชำระ" value={data?.totalCount || 0} isCurrency={false} />
        <SummaryCard label="ยอดรวม" value={data?.totalAmount || 0} color="text-success" />
        <SummaryCard label="เงินสด" value={data?.byMethod?.CASH || 0} color="text-primary" />
        <SummaryCard label="โอน" value={data?.byMethod?.TRANSFER || 0} color="text-primary" />
      </div>
      {data?.byBranch && data.byBranch.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 border-b border-border/60 text-left text-muted-foreground">
                <th className="pb-2 font-medium">สาขา</th>
                <th className="pb-2 font-medium text-right">รายการ</th>
                <th className="pb-2 font-medium text-right">ยอดรวม (บาท)</th>
              </tr>
            </thead>
            <tbody>
              {data.byBranch.map((b: { branchName: string; count: number; amount: number }) => (
                <tr key={b.branchName} className="border-b last:border-0">
                  <td className="py-2 font-medium">{b.branchName}</td>
                  <td className="py-2 text-right">{b.count}</td>
                  <td className="py-2 text-right text-success">{fmt(b.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
    </QueryBoundary>
  );
}

function StockReport() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['report-stock'],
    queryFn: async () => (await api.get('/reports/stock')).data,
  });

  const byStatus = data?.byStatus || [];
  const byBranch = data?.byBranch || [];

  return (
    <QueryBoundary isLoading={isLoading} isError={isError} error={error} onRetry={() => refetch()} errorTitle="ไม่สามารถโหลดรายงานสต็อกสินค้าได้">
    <div className="flex flex-col gap-5 lg:gap-7.5">
      <div className="bg-card rounded-lg border border-border p-5">
        <h3 className="text-sm font-semibold text-foreground mb-4">สต็อกตามสถานะ</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          <SummaryCard label="ทั้งหมด" value={data?.totalCount || 0} isCurrency={false} />
          <SummaryCard label="มูลค่ารวม" value={data?.totalValue || 0} color="text-primary" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 border-b border-border/60 text-left text-muted-foreground">
                <th className="pb-2 font-medium">สถานะ</th>
                <th className="pb-2 font-medium text-right">จำนวน</th>
                <th className="pb-2 font-medium text-right">มูลค่า (บาท)</th>
              </tr>
            </thead>
            <tbody>
              {byStatus.map((s: { status: string; count: number; value: number }) => (
                <tr key={s.status} className="border-b last:border-0">
                  <td className="py-2 font-medium">{s.status}</td>
                  <td className="py-2 text-right">{s.count}</td>
                  <td className="py-2 text-right">{fmt(s.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {byBranch.length > 0 && (
        <div className="bg-card rounded-lg border border-border p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">สต็อกตามสาขา</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/40 border-b border-border/60 text-left text-muted-foreground">
                  <th className="pb-2 font-medium">สาขา</th>
                  <th className="pb-2 font-medium text-right">จำนวน</th>
                  <th className="pb-2 font-medium text-right">มูลค่า (บาท)</th>
                </tr>
              </thead>
              <tbody>
                {byBranch.map((b: { branchName: string; count: number; value: number }) => (
                  <tr key={b.branchName} className="border-b last:border-0">
                    <td className="py-2 font-medium">{b.branchName}</td>
                    <td className="py-2 text-right">{b.count}</td>
                    <td className="py-2 text-right">{fmt(b.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
    </QueryBoundary>
  );
}

function EntityProfitReport() {
  const today = new Date();
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const lastDay = today.toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(firstDay);
  const [endDate, setEndDate] = useState(lastDay);
  const [entity, setEntity] = useState<string>('ALL');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['report-entity-profit', startDate, endDate, entity],
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
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-2xs font-medium text-muted-foreground block mb-1">จากวันที่</label>
            <ThaiDateInput value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div>
            <label className="text-2xs font-medium text-muted-foreground block mb-1">ถึงวันที่</label>
            <ThaiDateInput value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
          <div>
            <label className="text-2xs font-medium text-muted-foreground block mb-1">แสดง</label>
            <select
              value={entity}
              onChange={(e) => setEntity(e.target.value)}
              className="h-9 px-3 text-sm border border-border rounded-lg bg-background"
            >
              <option value="ALL">ทั้งหมด</option>
              <option value="SHOP">BESTCHOICE SHOP</option>
              <option value="FINANCE">BESTCHOICE FINANCE</option>
            </select>
          </div>
        </div>
      </div>

      <QueryBoundary isLoading={isLoading} isError={isError} error={error} onRetry={() => refetch()} errorTitle="ไม่สามารถโหลดรายงานกำไร Shop/Finance ได้">

      {/* Summary Cards */}
      {(entity === 'ALL' || entity === 'SHOP') && (
        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">BESTCHOICE SHOP</h3>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
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
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <SummaryCard label="รายได้ดอกเบี้ย" value={finance.interestIncome} color="text-primary" />
            <SummaryCard label="จ่ายคอมมิชชัน" value={finance.commissionExpense} color="text-destructive" />
            <SummaryCard label="ค่าปรับล่าช้า" value={finance.lateFeeIncome} color="text-warning" />
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
          <div className="grid grid-cols-2 gap-4">
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
            <table className="w-full text-sm">
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

      </QueryBoundary>
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
    <div className="bg-muted rounded-xl p-4">
      <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">{label}</div>
      <AnimatedCounter value={value} className={`text-lg font-bold ${color}`} />
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
