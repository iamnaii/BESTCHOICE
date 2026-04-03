import { useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardToolbar, CardTable } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  ShoppingCart,
  FileCheck,
  DollarSign,
  Users,
  Warehouse,
  BarChart3,
  AlertTriangle,
  TrendingUp,
  ArrowRight,
  Clock,
  UserCheck,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import AnimatedCounter from '@/components/ui/animated-counter';
import { DashboardSkeleton } from '@/components/ui/page-skeletons';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';

/* ─── Types ─── */

interface KPIs {
  contracts: { total: number; active: number; overdue: number; default: number; completed: number };
  products: { total: number; inStock: number };
  financial: { totalReceivable: number; totalLateFees: number; todayPayments: number; todayPaymentCount: number };
  overdueRate: number;
}

interface MonthlyTrend {
  month: string;
  newContracts: number;
  paymentsReceived: number;
}

interface TopOverdue {
  contractNumber: string;
  customer: { id: string; name: string; phone: string };
  totalOutstanding: number;
  daysOverdue: number;
}

interface StatusDistribution {
  status: string;
  count: number;
}

interface BranchComparison {
  id: string;
  name: string;
  contracts: number;
  products: number;
  users: number;
  overdueContracts: number;
  monthlyPayments: number;
}

interface MonthlyRevenue {
  totalPayments: number;
  interestIncome: number;
  lateFeeIncome: number;
  paymentCount: number;
}

interface AgingSummary {
  buckets: { range: string; count: number; amount: number; color: string }[];
  total: { count: number; amount: number };
}

interface StaffSalesMetric {
  salespersonId: string;
  name: string;
  branch: string;
  totalContracts: number;
  totalSales: number;
  overdueCount: number;
  overdueRate: number;
}

interface StaffActivity {
  id: string;
  type: 'contract_created' | 'payment_recorded';
  userName: string;
  description: string;
  amount: number;
  createdAt: string;
}

interface StaffPerformance {
  salesMetrics: StaffSalesMetric[];
  recentActivity: StaffActivity[];
}

/* ─── Constants ─── */

const statusLabels: Record<string, string> = {
  ACTIVE: 'ปกติ',
  OVERDUE: 'ค้างชำระ',
  DEFAULT: 'ผิดนัด',
  COMPLETED: 'ปิดสัญญา',
  EXCHANGED: 'เปลี่ยนเครื่อง',
  CLOSED_BAD_DEBT: 'หนี้สูญ',
};

const statusColors: Record<string, string> = {
  ACTIVE: 'bg-green-500',
  OVERDUE: 'bg-yellow-500',
  DEFAULT: 'bg-red-500',
  COMPLETED: 'bg-blue-500',
  EXCHANGED: 'bg-purple-500',
  CLOSED_BAD_DEBT: 'bg-zinc-400',
};

const agingBarColors: Record<string, string> = {
  green: 'bg-green-500',
  yellow: 'bg-yellow-500',
  orange: 'bg-orange-500',
  red: 'bg-red-500',
};

const agingTextColors: Record<string, string> = {
  green: 'text-green-600 dark:text-green-400',
  yellow: 'text-yellow-600 dark:text-yellow-400',
  orange: 'text-orange-600 dark:text-orange-400',
  red: 'text-red-600 dark:text-red-400',
};

/* Pie chart hex colors (matching statusColors Tailwind classes) */
const pieColors: Record<string, string> = {
  ACTIVE: '#22c55e',
  OVERDUE: '#eab308',
  DEFAULT: '#ef4444',
  COMPLETED: '#3b82f6',
  EXCHANGED: '#a855f7',
  CLOSED_BAD_DEBT: '#a1a1aa',
};

/* ─── Quick Action Shortcut Card (Demo 9 style) ─── */
function ShortcutCard({ icon: Icon, label, path, color }: { icon: LucideIcon; label: string; path: string; color: string }) {
  const navigate = useNavigate();
  return (
    <Card
      className="cursor-pointer hover:shadow-card-hover transition-shadow"
      onClick={() => navigate(path)}
    >
      <CardContent className="p-5 flex flex-col items-center justify-center gap-3 text-center min-h-[120px]">
        <div className={cn('size-11 rounded-xl flex items-center justify-center', color)}>
          <Icon className="size-5 text-white" />
        </div>
        <span className="text-sm font-medium text-foreground leading-tight">{label}</span>
      </CardContent>
    </Card>
  );
}

/* ─── Retry Error Block ─── */
function ErrorBlock({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="text-center py-8">
      <p className="text-sm text-destructive mb-2">{message}</p>
      <button onClick={onRetry} className="text-xs text-primary hover:underline">ลองใหม่</button>
    </div>
  );
}

/* ─── Time ago helper ─── */
function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins} นาทีที่แล้ว`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ชม.ที่แล้ว`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} วันที่แล้ว`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} เดือนที่แล้ว`;
  const years = Math.floor(months / 12);
  return `${years} ปีที่แล้ว`;
}

/* ═══════════════════════════════════════════════════════════════ */

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const dashboardStaleTime = 5 * 60 * 1000;

  /* ─── Existing queries ─── */
  const { data: kpis, isLoading: kpisLoading, isError: kpisError, refetch: refetchKpis } = useQuery<KPIs>({
    queryKey: ['dashboard-kpis'],
    queryFn: async () => (await api.get('/dashboard/kpis')).data,
    staleTime: dashboardStaleTime,
  });

  const { data: trend = [], isError: trendError, refetch: refetchTrend } = useQuery<MonthlyTrend[]>({
    queryKey: ['dashboard-trend'],
    queryFn: async () => (await api.get('/dashboard/monthly-trend')).data,
    staleTime: dashboardStaleTime,
  });

  const { data: topOverdue = [], isError: topOverdueError, refetch: refetchTopOverdue } = useQuery<TopOverdue[]>({
    queryKey: ['dashboard-top-overdue'],
    queryFn: async () => (await api.get('/dashboard/top-overdue')).data,
    staleTime: dashboardStaleTime,
  });

  const { data: statusDist = [], isError: statusDistError, refetch: refetchStatusDist } = useQuery<StatusDistribution[]>({
    queryKey: ['dashboard-status-dist'],
    queryFn: async () => (await api.get('/dashboard/status-distribution')).data,
    staleTime: dashboardStaleTime,
  });

  const { data: branchData = [], isError: branchError, refetch: refetchBranch } = useQuery<BranchComparison[]>({
    queryKey: ['dashboard-branches'],
    queryFn: async () => (await api.get('/dashboard/branch-comparison')).data,
    enabled: user?.role === 'OWNER',
    staleTime: dashboardStaleTime,
  });

  /* ─── New queries ─── */
  const { data: revenue, isError: revenueError, refetch: refetchRevenue } = useQuery<MonthlyRevenue>({
    queryKey: ['dashboard-revenue'],
    queryFn: async () => (await api.get('/dashboard/monthly-revenue')).data,
    enabled: user?.role !== 'SALES',
    staleTime: dashboardStaleTime,
  });

  const { data: aging, isError: agingError, refetch: refetchAging } = useQuery<AgingSummary>({
    queryKey: ['dashboard-aging'],
    queryFn: async () => (await api.get('/dashboard/aging-summary')).data,
    staleTime: dashboardStaleTime,
  });

  const { data: staffPerf, isError: staffError, refetch: refetchStaff } = useQuery<StaffPerformance>({
    queryKey: ['dashboard-staff'],
    queryFn: async () => (await api.get('/dashboard/staff-performance')).data,
    enabled: user?.role === 'OWNER',
    staleTime: dashboardStaleTime,
  });

  /* ─── Computed ─── */
  const totalStatusCount = useMemo(() => statusDist.reduce((sum, s) => sum + s.count, 0), [statusDist]);
  const trendMax = useMemo(() => {
    if (trend.length === 0) return 1;
    return Math.max(...trend.map((t) => Math.max(t.newContracts, t.paymentsReceived)), 1);
  }, [trend]);
  const agingMax = useMemo(() => (aging ? Math.max(...aging.buckets.map((b) => b.amount), 1) : 1), [aging]);

  if (kpisLoading && !kpis) return <DashboardSkeleton />;

  return (
    <div className="flex flex-col gap-5 lg:gap-7">
      {/* Page Title */}
      <div>
        <h1 className="text-xl font-semibold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          สวัสดี {user?.name} — ภาพรวมธุรกิจและการกำกับพนักงาน
        </p>
      </div>

      {/* Error State */}
      {kpisError && (
        <div className="bg-destructive/5 border border-destructive/20 rounded-xl p-4 flex items-center justify-between">
          <div className="text-sm text-destructive">ไม่สามารถโหลดข้อมูลได้ กรุณาลองใหม่</div>
          <button onClick={() => refetchKpis()} className="px-3 py-1.5 bg-destructive/10 text-destructive rounded-lg text-xs font-medium hover:bg-destructive/20 transition-colors">
            ลองใหม่
          </button>
        </div>
      )}

      {/* ═══ KPI Banner (full-width) — animated counters ═══ */}
      {kpis && (
        <div className="rounded-xl bg-gradient-to-br from-blue-500 via-blue-600 to-indigo-700 text-white p-6 lg:p-8">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="cursor-pointer group" onClick={() => navigate('/contracts')}>
              <div className="flex items-center gap-2 mb-2">
                <div className="size-8 rounded-lg bg-white/15 flex items-center justify-center group-hover:bg-white/25 transition-colors">
                  <FileCheck className="size-4" />
                </div>
                <span className="text-xs text-white/70 font-medium">สัญญาทั้งหมด</span>
              </div>
              <AnimatedCounter value={kpis.contracts.total} className="text-2xl lg:text-3xl font-bold" />
              <div className="text-xs text-white/60 mt-1">ปกติ <AnimatedCounter value={kpis.contracts.active} /></div>
            </div>
            <div className="cursor-pointer group" onClick={() => navigate('/overdue')}>
              <div className="flex items-center gap-2 mb-2">
                <div className="size-8 rounded-lg bg-white/15 flex items-center justify-center group-hover:bg-white/25 transition-colors">
                  <AlertTriangle className="size-4" />
                </div>
                <span className="text-xs text-white/70 font-medium">ค้าง/ผิดนัด</span>
              </div>
              <AnimatedCounter value={(kpis.contracts.overdue ?? 0) + (kpis.contracts.default ?? 0)} className="text-2xl lg:text-3xl font-bold" />
              <div className="text-xs text-white/60 mt-1">{(kpis.overdueRate ?? 0).toFixed(1)}%</div>
            </div>
            <div className="cursor-pointer group" onClick={() => navigate('/payments')}>
              <div className="flex items-center gap-2 mb-2">
                <div className="size-8 rounded-lg bg-white/15 flex items-center justify-center group-hover:bg-white/25 transition-colors">
                  <TrendingUp className="size-4" />
                </div>
                <span className="text-xs text-white/70 font-medium">ยอดรับวันนี้</span>
              </div>
              <AnimatedCounter value={kpis.financial.todayPayments} prefix="฿" className="text-2xl lg:text-3xl font-bold" />
              <div className="text-xs text-white/60 mt-1"><AnimatedCounter value={kpis.financial.todayPaymentCount} /> รายการ</div>
            </div>
            <div className="cursor-pointer group" onClick={() => navigate('/stock')}>
              <div className="flex items-center gap-2 mb-2">
                <div className="size-8 rounded-lg bg-white/15 flex items-center justify-center group-hover:bg-white/25 transition-colors">
                  <Warehouse className="size-4" />
                </div>
                <span className="text-xs text-white/70 font-medium">สินค้าในสต็อก</span>
              </div>
              <AnimatedCounter value={kpis.products.inStock} className="text-2xl lg:text-3xl font-bold" />
              <div className="text-xs text-white/60 mt-1">จาก <AnimatedCounter value={kpis.products.total} /></div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Two-Column: Shortcuts + Monthly Revenue ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-7">
        {/* Quick Action Shortcuts — role-based */}
        <div className="lg:col-span-5">
          <div className="grid grid-cols-2 gap-4">
            <ShortcutCard icon={ShoppingCart} label="POS ขายสินค้า" path="/pos" color="bg-blue-500" />
            <ShortcutCard icon={FileCheck} label="สัญญาผ่อน" path="/contracts" color="bg-indigo-500" />
            {(user?.role !== 'SALES') && (
              <ShortcutCard icon={DollarSign} label="ชำระเงิน" path="/payments" color="bg-green-500" />
            )}
            <ShortcutCard icon={Users} label="ลูกค้า" path="/customers" color="bg-purple-500" />
            {(user?.role === 'OWNER' || user?.role === 'BRANCH_MANAGER') && (
              <ShortcutCard icon={Warehouse} label="คลังสินค้า" path="/stock" color="bg-orange-500" />
            )}
            {(user?.role === 'OWNER' || user?.role === 'BRANCH_MANAGER' || user?.role === 'ACCOUNTANT') && (
              <ShortcutCard icon={BarChart3} label="รายงาน" path="/reports" color="bg-cyan-500" />
            )}
          </div>
        </div>

        {/* Monthly Revenue + Financial Summary — lg:col-span-7 */}
        <div className="lg:col-span-7 flex flex-col gap-5 lg:gap-7">
          {/* Monthly Revenue — OWNER/BRANCH_MANAGER/ACCOUNTANT only */}
          {user?.role !== 'SALES' && (
            <Card>
              <CardHeader>
                <CardTitle>รายได้เดือนนี้</CardTitle>
                <CardToolbar>
                  {revenue && (
                    <span className="text-2xs text-muted-foreground bg-muted px-2.5 py-1 rounded-md font-medium">
                      {revenue.paymentCount} รายการ
                    </span>
                  )}
                </CardToolbar>
              </CardHeader>
              <CardContent className="p-0">
                {revenueError ? (
                  <ErrorBlock message="โหลดข้อมูลรายได้ไม่สำเร็จ" onRetry={() => refetchRevenue()} />
                ) : revenue ? (
                  <div className="divide-y divide-border/50">
                    <div className="flex items-center gap-4 px-5 py-3.5">
                      <div className="w-1 h-8 rounded-full bg-blue-500" />
                      <div className="flex-1">
                        <div className="text-sm font-medium text-foreground">ยอดชำระรวม</div>
                        <div className="text-2xs text-muted-foreground">รับชำระทั้งเดือน</div>
                      </div>
                      <div className="text-sm font-semibold text-foreground">{revenue.totalPayments.toLocaleString()} ฿</div>
                    </div>
                    <div className="flex items-center gap-4 px-5 py-3.5">
                      <div className="w-1 h-8 rounded-full bg-green-500" />
                      <div className="flex-1">
                        <div className="text-sm font-medium text-foreground">ดอกเบี้ยรับ</div>
                        <div className="text-2xs text-muted-foreground">ส่วนดอกเบี้ยจากค่างวด</div>
                      </div>
                      <div className="text-sm font-semibold text-success">{revenue.interestIncome.toLocaleString()} ฿</div>
                    </div>
                    <div className="flex items-center gap-4 px-5 py-3.5">
                      <div className="w-1 h-8 rounded-full bg-yellow-500" />
                      <div className="flex-1">
                        <div className="text-sm font-medium text-foreground">ค่าปรับ</div>
                        <div className="text-2xs text-muted-foreground">ค่าปรับล่าช้าสะสม</div>
                      </div>
                      <div className="text-sm font-semibold text-warning">{revenue.lateFeeIncome.toLocaleString()} ฿</div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center text-muted-foreground py-8 text-sm">กำลังโหลด...</div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Financial Summary */}
          {kpis && (
            <Card>
              <CardHeader>
                <CardTitle>สรุปภาพรวม</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-border/50">
                  <div
                    className="flex items-center gap-4 px-5 py-3.5 cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => navigate('/contracts')}
                  >
                    <div className="w-1 h-8 rounded-full bg-blue-500" />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-foreground">ลูกหนี้คงค้าง</div>
                      <div className="text-2xs text-muted-foreground">ยอดค้างรับทั้งหมด</div>
                    </div>
                    <div className="text-sm font-semibold text-foreground">{kpis.financial.totalReceivable.toLocaleString()} ฿</div>
                    <ArrowRight className="size-4 text-muted-foreground" />
                  </div>
                  <div
                    className="flex items-center gap-4 px-5 py-3.5 cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => navigate('/contracts')}
                  >
                    <div className="w-1 h-8 rounded-full bg-green-500" />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-foreground">ปิดสัญญาแล้ว</div>
                      <div className="text-2xs text-muted-foreground">สัญญาที่ชำระครบ</div>
                    </div>
                    <div className="text-sm font-semibold text-primary">{kpis.contracts.completed} สัญญา</div>
                    <ArrowRight className="size-4 text-muted-foreground" />
                  </div>
                  <div className="flex items-center gap-4 px-5 py-3.5">
                    <div className="w-1 h-8 rounded-full bg-yellow-500" />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-foreground">ค่าปรับรวม</div>
                      <div className="text-2xs text-muted-foreground">ค่าปรับสะสมทั้งหมด</div>
                    </div>
                    <div className="text-sm font-semibold text-warning">{kpis.financial.totalLateFees.toLocaleString()} ฿</div>
                  </div>
                  <div
                    className="flex items-center gap-4 px-5 py-3.5 cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => navigate('/overdue')}
                  >
                    <div className="w-1 h-8 rounded-full bg-red-500" />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-foreground">ค้างชำระ / ผิดนัด</div>
                      <div className="text-2xs text-muted-foreground">สัญญาที่ต้องติดตาม</div>
                    </div>
                    <div className="text-sm font-semibold">
                      <span className="text-warning">{kpis.contracts.overdue}</span>
                      <span className="text-muted-foreground mx-1">/</span>
                      <span className="text-destructive">{kpis.contracts.default}</span>
                    </div>
                    <ArrowRight className="size-4 text-muted-foreground" />
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* ═══ Aging Buckets (full-width) — hide for SALES ═══ */}
      {user?.role !== 'SALES' && <Card>
        <CardHeader>
          <CardTitle>อายุหนี้ค้างชำระ (Aging)</CardTitle>
          <CardToolbar>
            {aging && (
              <span className="text-2xs text-destructive bg-destructive/10 px-2.5 py-1 rounded-md font-medium">
                {aging.total.count} รายการ — {aging.total.amount.toLocaleString()} ฿
              </span>
            )}
          </CardToolbar>
        </CardHeader>
        <CardContent>
          {agingError ? (
            <ErrorBlock message="โหลดข้อมูลอายุหนี้ไม่สำเร็จ" onRetry={() => refetchAging()} />
          ) : aging ? (
            <div className="space-y-4">
              {aging.buckets.map((bucket) => (
                <div key={bucket.range} className="flex items-center gap-4">
                  <div className="w-16 text-xs font-medium text-foreground shrink-0">{bucket.range} วัน</div>
                  <div className="flex-1 bg-muted rounded-full h-4 overflow-hidden">
                    <div
                      className={cn('h-full rounded-full opacity-80', agingBarColors[bucket.color] || 'bg-zinc-400')}
                      style={{
                        width: agingMax > 0 ? `${(bucket.amount / agingMax) * 100}%` : '0%',
                        minWidth: bucket.amount > 0 ? '8px' : '0',
                      }}
                    />
                  </div>
                  <div className="w-14 text-right text-xs font-medium text-muted-foreground">{bucket.count} รายการ</div>
                  <div className={cn('w-28 text-right text-sm font-semibold', agingTextColors[bucket.color] || 'text-foreground')}>
                    {bucket.amount.toLocaleString()} ฿
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center text-muted-foreground py-8 text-sm">กำลังโหลด...</div>
          )}
        </CardContent>
      </Card>}

      {/* ═══ Staff Performance (Tabs) — OWNER only ═══ */}
      {user?.role === 'OWNER' && <Card>
        <CardHeader>
          <CardTitle>กำกับพนักงาน</CardTitle>
          <CardToolbar>
            {staffPerf && (
              <span className="text-2xs text-muted-foreground bg-muted px-2.5 py-1 rounded-md font-medium">
                เดือนนี้
              </span>
            )}
          </CardToolbar>
        </CardHeader>
        <CardContent>
          {staffError ? (
            <ErrorBlock message="โหลดข้อมูลพนักงานไม่สำเร็จ" onRetry={() => refetchStaff()} />
          ) : staffPerf ? (
            <Tabs defaultValue="sales">
              <TabsList variant="line" size="sm">
                <TabsTrigger value="sales">
                  <UserCheck className="size-3.5" />
                  ยอดขายรายคน
                </TabsTrigger>
                <TabsTrigger value="activity">
                  <Clock className="size-3.5" />
                  กิจกรรมล่าสุด
                </TabsTrigger>
              </TabsList>

              {/* Tab: Sales by person */}
              <TabsContent value="sales">
                {staffPerf.salesMetrics.length > 0 ? (
                  <div className="overflow-x-auto -mx-1">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border/50 text-left text-muted-foreground">
                          <th className="px-3 pb-3 pt-2 font-medium text-xs">พนักงาน</th>
                          <th className="px-3 pb-3 pt-2 font-medium text-xs">สาขา</th>
                          <th className="px-3 pb-3 pt-2 font-medium text-xs text-right">สัญญา</th>
                          <th className="px-3 pb-3 pt-2 font-medium text-xs text-right">ยอดขาย</th>
                          <th className="px-3 pb-3 pt-2 font-medium text-xs text-right">ค้างชำระ</th>
                          <th className="px-3 pb-3 pt-2 font-medium text-xs text-right">อัตราค้าง</th>
                        </tr>
                      </thead>
                      <tbody>
                        {staffPerf.salesMetrics.map((s) => (
                          <tr key={s.salespersonId} className="border-b border-border/30 last:border-0 hover:bg-muted/50 transition-colors">
                            <td className="px-3 py-2.5 font-medium text-foreground">{s.name}</td>
                            <td className="px-3 py-2.5 text-muted-foreground">{s.branch}</td>
                            <td className="px-3 py-2.5 text-right text-foreground">{s.totalContracts}</td>
                            <td className="px-3 py-2.5 text-right text-foreground font-medium">{s.totalSales.toLocaleString()} ฿</td>
                            <td className="px-3 py-2.5 text-right">
                              <span className={s.overdueCount > 0 ? 'text-destructive font-semibold' : 'text-foreground'}>
                                {s.overdueCount}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              <span
                                className={cn(
                                  'px-2 py-0.5 rounded-md text-2xs font-medium',
                                  s.overdueRate > 20
                                    ? 'bg-destructive/10 text-destructive'
                                    : s.overdueRate > 10
                                      ? 'bg-warning/10 text-warning'
                                      : 'bg-success/10 text-success dark:bg-success/15 dark:bg-green-900/30 dark:text-green-400',
                                )}
                              >
                                {s.overdueRate}%
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center text-muted-foreground py-8 text-sm">ยังไม่มีข้อมูลเดือนนี้</div>
                )}
              </TabsContent>

              {/* Tab: Recent Activity */}
              <TabsContent value="activity">
                {staffPerf.recentActivity.length > 0 ? (
                  <div className="space-y-1">
                    {staffPerf.recentActivity.map((a) => (
                      <div key={`${a.type}-${a.id}`} className="flex items-start gap-3 py-2.5 border-b border-border/30 last:border-0">
                        <div className={cn(
                          'size-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5',
                          a.type === 'contract_created' ? 'bg-primary/10' : 'bg-success/10',
                        )}>
                          {a.type === 'contract_created'
                            ? <FileCheck className="size-4 text-primary" />
                            : <DollarSign className="size-4 text-success" />
                          }
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-foreground">
                            <span className="font-medium">{a.userName}</span>{' '}
                            <span className="text-muted-foreground">{a.description}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-2xs text-muted-foreground">{timeAgo(a.createdAt)}</span>
                          </div>
                        </div>
                        <div className="text-sm font-semibold text-foreground shrink-0">
                          {a.amount.toLocaleString()} ฿
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center text-muted-foreground py-8 text-sm">ยังไม่มีกิจกรรมใน 7 วันที่ผ่านมา</div>
                )}
              </TabsContent>
            </Tabs>
          ) : (
            <div className="text-center text-muted-foreground py-8 text-sm">กำลังโหลด...</div>
          )}
        </CardContent>
      </Card>}

      {/* ═══ Two-Column: Trend (AreaChart) + Status Distribution (PieChart + bars) ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-7">
        {/* Monthly Trend — Recharts AreaChart */}
        <div className="lg:col-span-7">
          <Card>
            <CardHeader>
              <CardTitle>แนวโน้ม 12 เดือน</CardTitle>
              <CardToolbar>
                <div className="flex gap-4 text-2xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span className="size-2.5 bg-primary rounded-full inline-block" /> สัญญาใหม่
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="size-2.5 bg-success rounded-full inline-block" /> ยอดชำระ
                  </span>
                </div>
              </CardToolbar>
            </CardHeader>
            <CardContent>
              {trendError ? (
                <ErrorBlock message="โหลดข้อมูลไม่สำเร็จ" onRetry={() => refetchTrend()} />
              ) : trend.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={trend} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gradContracts" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(217 91% 60%)" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(217 91% 60%)" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gradPayments" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(142 71% 45%)" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(142 71% 45%)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis
                      dataKey="month"
                      tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <RechartsTooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--popover))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                        fontSize: '12px',
                        boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
                      }}
                      labelStyle={{ fontWeight: 600, marginBottom: 4 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="newContracts"
                      name="สัญญาใหม่"
                      stroke="hsl(217 91% 60%)"
                      strokeWidth={2}
                      fill="url(#gradContracts)"
                    />
                    <Area
                      type="monotone"
                      dataKey="paymentsReceived"
                      name="ยอดชำระ (฿)"
                      stroke="hsl(142 71% 45%)"
                      strokeWidth={2}
                      fill="url(#gradPayments)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="text-center text-muted-foreground py-8 text-sm">ไม่มีข้อมูล</div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Status Distribution — PieChart + legend bars */}
        <div className="lg:col-span-5">
          <Card>
            <CardHeader>
              <CardTitle>สถานะสัญญา</CardTitle>
              <CardToolbar>
                <span className="text-2xs text-muted-foreground bg-muted px-2.5 py-1 rounded-md font-medium">
                  ทั้งหมด {totalStatusCount}
                </span>
              </CardToolbar>
            </CardHeader>
            <CardContent>
              {statusDistError ? (
                <ErrorBlock message="โหลดข้อมูลไม่สำเร็จ" onRetry={() => refetchStatusDist()} />
              ) : statusDist.length > 0 ? (
                <div>
                  {/* Donut chart */}
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie
                        data={statusDist.map((s) => ({
                          name: statusLabels[s.status] || s.status,
                          value: s.count,
                          fill: pieColors[s.status] || '#a1a1aa',
                        }))}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={75}
                        paddingAngle={2}
                        dataKey="value"
                        stroke="none"
                      >
                        {statusDist.map((s) => (
                          <Cell key={s.status} fill={pieColors[s.status] || '#a1a1aa'} />
                        ))}
                      </Pie>
                      <RechartsTooltip
                        contentStyle={{
                          backgroundColor: 'hsl(var(--popover))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px',
                          fontSize: '12px',
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>

                  {/* Legend bars */}
                  <div className="space-y-2.5 mt-2">
                    {statusDist.map((s) => (
                      <div key={s.status} className="flex items-center gap-3">
                        <div className="w-24 text-xs text-foreground font-medium flex items-center gap-2">
                          <span className={cn('size-2 rounded-full', statusColors[s.status] || 'bg-zinc-400')} />
                          {statusLabels[s.status] || s.status}
                        </div>
                        <div className="flex-1 bg-muted rounded-full h-2.5 overflow-hidden">
                          <div
                            className={cn('h-full rounded-full opacity-80', statusColors[s.status] || 'bg-zinc-400')}
                            style={{
                              width: totalStatusCount > 0 ? `${(s.count / totalStatusCount) * 100}%` : '0%',
                              minWidth: s.count > 0 ? '8px' : '0',
                            }}
                          />
                        </div>
                        <div className="w-10 text-right text-2sm font-semibold text-foreground">{s.count}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center text-muted-foreground py-8 text-sm">ไม่มีข้อมูล</div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ═══ Top Overdue Table ═══ */}
      {topOverdueError && (
        <Card>
          <CardContent>
            <ErrorBlock message="โหลดข้อมูลค้างชำระไม่สำเร็จ" onRetry={() => refetchTopOverdue()} />
          </CardContent>
        </Card>
      )}
      {topOverdue.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>สัญญาค้างชำระสูงสุด (Top 10)</CardTitle>
            <CardToolbar>
              <span className="text-2xs text-destructive bg-destructive/10 px-2.5 py-1 rounded-md font-medium">
                {topOverdue.length} รายการ
              </span>
            </CardToolbar>
          </CardHeader>
          <CardTable>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50 text-left text-muted-foreground">
                    <th className="px-5 pb-3 pt-4 font-medium text-xs">เลขสัญญา</th>
                    <th className="px-5 pb-3 pt-4 font-medium text-xs">ลูกค้า</th>
                    <th className="px-5 pb-3 pt-4 font-medium text-xs">เบอร์โทร</th>
                    <th className="px-5 pb-3 pt-4 font-medium text-xs text-right">ยอดค้าง (บาท)</th>
                    <th className="px-5 pb-3 pt-4 font-medium text-xs text-right">เกินกำหนด</th>
                  </tr>
                </thead>
                <tbody>
                  {topOverdue.map((item) => (
                    <tr key={item.contractNumber} className="border-b border-border/30 last:border-0 hover:bg-muted/50 transition-colors">
                      <td className="px-5 py-3 font-medium text-primary">{item.contractNumber}</td>
                      <td className="px-5 py-3 text-foreground">{item.customer.name}</td>
                      <td className="px-5 py-3 text-muted-foreground">{item.customer.phone}</td>
                      <td className="px-5 py-3 text-right text-destructive font-semibold">
                        {item.totalOutstanding.toLocaleString()}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <span
                          className={cn(
                            'px-2 py-0.5 rounded-md text-2xs font-medium',
                            item.daysOverdue > 60
                              ? 'bg-destructive/10 text-destructive'
                              : item.daysOverdue > 30
                                ? 'bg-warning/10 text-warning'
                                : 'bg-warning/10 text-warning dark:bg-warning/15 dark:bg-orange-900/30 dark:text-orange-400',
                          )}
                        >
                          {item.daysOverdue} วัน
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardTable>
        </Card>
      )}

      {/* ═══ Branch Comparison (OWNER only) ═══ */}
      {user?.role === 'OWNER' && branchError && (
        <Card>
          <CardContent>
            <ErrorBlock message="โหลดข้อมูลสาขาไม่สำเร็จ" onRetry={() => refetchBranch()} />
          </CardContent>
        </Card>
      )}
      {user?.role === 'OWNER' && branchData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>เปรียบเทียบสาขา</CardTitle>
            <CardToolbar>
              <span className="text-2xs text-muted-foreground bg-muted px-2.5 py-1 rounded-md font-medium">
                {branchData.length} สาขา
              </span>
            </CardToolbar>
          </CardHeader>
          <CardTable>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50 text-left text-muted-foreground">
                    <th className="px-5 pb-3 pt-4 font-medium text-xs">สาขา</th>
                    <th className="px-5 pb-3 pt-4 font-medium text-xs text-right">สัญญา</th>
                    <th className="px-5 pb-3 pt-4 font-medium text-xs text-right">สินค้า</th>
                    <th className="px-5 pb-3 pt-4 font-medium text-xs text-right">พนักงาน</th>
                    <th className="px-5 pb-3 pt-4 font-medium text-xs text-right">ค้างชำระ</th>
                    <th className="px-5 pb-3 pt-4 font-medium text-xs text-right">ยอดชำระ/เดือน</th>
                  </tr>
                </thead>
                <tbody>
                  {branchData.map((b) => (
                    <tr key={b.name} className="border-b border-border/30 last:border-0 hover:bg-muted/50 transition-colors">
                      <td className="px-5 py-3 font-medium text-foreground">{b.name}</td>
                      <td className="px-5 py-3 text-right text-foreground">{b.contracts}</td>
                      <td className="px-5 py-3 text-right text-foreground">{b.products}</td>
                      <td className="px-5 py-3 text-right text-foreground">{b.users}</td>
                      <td className="px-5 py-3 text-right">
                        <span className={b.overdueContracts > 0 ? 'text-destructive font-semibold' : 'text-foreground'}>
                          {b.overdueContracts}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right text-success font-medium">
                        {b.monthlyPayments.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardTable>
        </Card>
      )}
    </div>
  );
}
