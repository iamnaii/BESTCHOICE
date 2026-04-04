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
  Layers,
  Package,
  ImageIcon,
  Sparkles,
  Phone,
  ShieldAlert,
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
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';

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

interface CollectionPipelineStage {
  stage: string;
  label: string;
  count: number;
  totalAmount: number;
}

interface CollectionPipeline {
  stages: CollectionPipelineStage[];
  totalContracts: number;
  totalAmount: number;
}

interface DashboardAlert {
  type: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  link: string;
  count: number;
}

interface UpsellCandidate {
  contractId: string;
  contractNumber: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  totalMonths: number;
  paidCount: number;
  paidRatio: number;
  contractStatus: string;
  hasExchangeHistory: boolean;
  productModel: string | null;
  monthlyPayment: number;
  reason: string;
}

interface UpsellCandidates {
  total: number;
  candidates: UpsellCandidate[];
}

interface WatchListEntry {
  customerId: string;
  customerName: string;
  customerPhone: string;
  contractId: string;
  contractNumber: string;
  riskScore: number;
  riskLevel: 'HIGH' | 'MEDIUM' | 'LOW';
  reasons: string[];
  latePaymentCount: number;
  partialPaymentCount: number;
  hadDunningReset: boolean;
  nextDueDate: string | null;
  nextAmountDue: number | null;
}

interface WatchList {
  total: number;
  highCount: number;
  mediumCount: number;
  watchList: WatchListEntry[];
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

/* ─── Alert Icon Map ─── */
const alertIconMap: Record<string, LucideIcon> = {
  overdue: AlertTriangle,
  low_stock: Package,
  pending_contracts: FileCheck,
  payment_mismatch: ImageIcon,
};

const alertSeverityStyles = {
  critical: {
    container: 'border-destructive/30 bg-destructive/5',
    icon: 'bg-destructive/10 text-destructive',
    badge: 'bg-destructive/10 text-destructive',
    count: 'text-destructive',
  },
  warning: {
    container: 'border-yellow-500/30 bg-yellow-500/5',
    icon: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
    badge: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
    count: 'text-yellow-600 dark:text-yellow-400',
  },
  info: {
    container: 'border-primary/20 bg-primary/5',
    icon: 'bg-primary/10 text-primary',
    badge: 'bg-primary/10 text-primary',
    count: 'text-primary',
  },
} as const;

/* ─── Quick Action Shortcut Card (Demo 9 style) ─── */
function ShortcutCard({ icon: Icon, label, path, color }: { icon: LucideIcon; label: string; path: string; color: string }) {
  const navigate = useNavigate();
  return (
    <Card
      className="cursor-pointer hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200 group"
      onClick={() => navigate(path)}
    >
      <CardContent className="p-5 flex flex-col items-center justify-center gap-3 text-center min-h-[120px]">
        <div className={cn('size-11 rounded-xl flex items-center justify-center transition-transform group-hover:scale-105', color)}>
          <Icon className="size-5 text-white" />
        </div>
        <span className="text-2sm font-medium text-foreground leading-tight">{label}</span>
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

  const { data: collectionPipeline, isError: pipelineError, refetch: refetchPipeline } = useQuery<CollectionPipeline>({
    queryKey: ['dashboard-collection-pipeline'],
    queryFn: async () => (await api.get('/overdue/pipeline')).data,
    staleTime: dashboardStaleTime,
  });

  const { data: alerts = [] } = useQuery<DashboardAlert[]>({
    queryKey: ['dashboard-alerts'],
    queryFn: async () => (await api.get('/dashboard/alerts')).data,
    staleTime: 30 * 1000, // 30s — near real-time
    refetchInterval: 60 * 1000, // auto-refresh ทุก 60s
  });

  const { data: upsell } = useQuery<UpsellCandidates>({
    queryKey: ['dashboard-upsell-candidates'],
    queryFn: async () => (await api.get('/customers/upsell-candidates?limit=5')).data,
    staleTime: dashboardStaleTime,
  });

  const { data: watchListData } = useQuery<WatchList>({
    queryKey: ['dashboard-watch-list'],
    queryFn: async () => (await api.get('/dashboard/watch-list')).data,
    staleTime: 2 * 60 * 1000, // 2min
    refetchInterval: 5 * 60 * 1000, // auto-refresh ทุก 5min
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
    <div className="flex flex-col gap-5 lg:gap-7.5.5">
      {/* Page Title */}
      <div>
        <h1 className="text-xl font-bold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">
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

      {/* ═══ Smart Alerts ═══ */}
      {alerts.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {alerts.map((alert) => {
            const Icon = alertIconMap[alert.type] ?? AlertTriangle;
            const styles = alertSeverityStyles[alert.severity];
            return (
              <div
                key={alert.type}
                role="button"
                tabIndex={0}
                onClick={() => navigate(alert.link)}
                onKeyDown={(e) => e.key === 'Enter' && navigate(alert.link)}
                className={cn(
                  'flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer',
                  'hover:-translate-y-0.5 hover:shadow-md transition-all duration-200',
                  styles.container,
                )}
              >
                <div className={cn('size-9 rounded-lg flex items-center justify-center shrink-0', styles.icon)}>
                  <Icon className="size-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground leading-tight truncate">{alert.message}</p>
                  <p className="text-2xs text-muted-foreground mt-0.5">คลิกเพื่อดูรายละเอียด</p>
                </div>
                <span className={cn('text-xs font-bold shrink-0', styles.count)}>{alert.count}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* ═══ KPI Stats (Metronic CRM-style) ═══ */}
      {kpis && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-5">
          <Card className="cursor-pointer group hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200 border-l-[3px] border-l-primary" onClick={() => navigate('/contracts')}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="size-10 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/15 transition-colors">
                  <FileCheck className="size-5 text-primary" />
                </div>
              </div>
              <AnimatedCounter value={kpis.contracts.total} className="text-2xl lg:text-3xl font-bold text-foreground" />
              <div className="text-2xs font-medium text-muted-foreground mt-1.5 uppercase tracking-wider">สัญญาทั้งหมด</div>
              <div className="text-xs text-muted-foreground mt-1">ปกติ <AnimatedCounter value={kpis.contracts.active} className="text-success font-semibold" /></div>
            </CardContent>
          </Card>
          <Card className="cursor-pointer group hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200 border-l-[3px] border-l-destructive" onClick={() => navigate('/overdue')}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="size-10 rounded-xl bg-destructive/10 flex items-center justify-center group-hover:bg-destructive/15 transition-colors">
                  <AlertTriangle className="size-5 text-destructive" />
                </div>
                <span className="text-2xs font-semibold text-destructive bg-destructive/10 px-2 py-0.5 rounded-md">{(kpis.overdueRate ?? 0).toFixed(1)}%</span>
              </div>
              <AnimatedCounter value={(kpis.contracts.overdue ?? 0) + (kpis.contracts.default ?? 0)} className="text-2xl lg:text-3xl font-bold text-foreground" />
              <div className="text-2xs font-medium text-muted-foreground mt-1.5 uppercase tracking-wider">ค้าง/ผิดนัด</div>
            </CardContent>
          </Card>
          <Card className="cursor-pointer group hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200 border-l-[3px] border-l-success" onClick={() => navigate('/payments')}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="size-10 rounded-xl bg-success/10 flex items-center justify-center group-hover:bg-success/15 transition-colors">
                  <TrendingUp className="size-5 text-success" />
                </div>
                <span className="text-2xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-md"><AnimatedCounter value={kpis.financial.todayPaymentCount} /> รายการ</span>
              </div>
              <AnimatedCounter value={kpis.financial.todayPayments} prefix="฿" className="text-2xl lg:text-3xl font-bold text-foreground" />
              <div className="text-2xs font-medium text-muted-foreground mt-1.5 uppercase tracking-wider">ยอดรับวันนี้</div>
            </CardContent>
          </Card>
          <Card className="cursor-pointer group hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200 border-l-[3px] border-l-warning" onClick={() => navigate('/stock')}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="size-10 rounded-xl bg-warning/10 flex items-center justify-center group-hover:bg-warning/15 transition-colors">
                  <Warehouse className="size-5 text-warning" />
                </div>
              </div>
              <AnimatedCounter value={kpis.products.inStock} className="text-2xl lg:text-3xl font-bold text-foreground" />
              <div className="text-2xs font-medium text-muted-foreground mt-1.5 uppercase tracking-wider">สินค้าในสต็อก</div>
              <div className="text-xs text-muted-foreground mt-1">จาก <AnimatedCounter value={kpis.products.total} className="font-semibold" /></div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ═══ Early Warning Watch List ═══ */}
      {watchListData && watchListData.total > 0 && (
        <Card className="border-orange-200 dark:border-orange-900/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="size-4 text-orange-500" />
              Watch List — ลูกค้าเสี่ยงค้างชำระ
            </CardTitle>
            <CardToolbar>
              {watchListData.highCount > 0 && (
                <span className="text-2xs font-semibold text-red-600 bg-red-500/10 px-2.5 py-1 rounded-md">
                  สูง {watchListData.highCount}
                </span>
              )}
              {watchListData.mediumCount > 0 && (
                <span className="text-2xs font-semibold text-orange-600 bg-orange-500/10 px-2.5 py-1 rounded-md ml-1">
                  กลาง {watchListData.mediumCount}
                </span>
              )}
              <button
                onClick={() => navigate('/customers')}
                className="text-xs text-primary hover:underline ml-2 flex items-center gap-1"
              >
                ดูทั้งหมด <ArrowRight className="size-3" />
              </button>
            </CardToolbar>
          </CardHeader>
          <CardTable>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60">
                  <th className="text-left px-5 py-3 text-2xs font-semibold text-muted-foreground uppercase tracking-wider bg-muted/40">ลูกค้า</th>
                  <th className="text-left px-5 py-3 text-2xs font-semibold text-muted-foreground uppercase tracking-wider bg-muted/40 hidden sm:table-cell">สัญญา</th>
                  <th className="text-left px-5 py-3 text-2xs font-semibold text-muted-foreground uppercase tracking-wider bg-muted/40">ความเสี่ยง</th>
                  <th className="text-left px-5 py-3 text-2xs font-semibold text-muted-foreground uppercase tracking-wider bg-muted/40 hidden md:table-cell">สาเหตุ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {watchListData.watchList.slice(0, 8).map((w) => {
                  const riskStyles = {
                    HIGH: { badge: 'bg-red-500/10 text-red-700 dark:text-red-400', dot: 'bg-red-500', label: 'สูง' },
                    MEDIUM: { badge: 'bg-orange-500/10 text-orange-700 dark:text-orange-400', dot: 'bg-orange-500', label: 'กลาง' },
                    LOW: { badge: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400', dot: 'bg-yellow-500', label: 'ต่ำ' },
                  }[w.riskLevel];
                  return (
                    <tr
                      key={w.contractId}
                      className="hover:bg-muted/30 transition-colors cursor-pointer"
                      onClick={() => navigate(`/customers/${w.customerId}`)}
                    >
                      <td className="px-5 py-3.5">
                        <div className="font-medium text-foreground">{w.customerName}</div>
                        <div className="text-2xs text-muted-foreground flex items-center gap-1 mt-0.5">
                          <Phone className="size-3" />{w.customerPhone}
                        </div>
                      </td>
                      <td className="px-5 py-3.5 hidden sm:table-cell">
                        <span className="text-xs text-foreground font-mono">{w.contractNumber}</span>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={cn('text-xs px-2 py-0.5 rounded-full font-semibold flex items-center gap-1.5 w-fit', riskStyles.badge)}>
                          <span className={cn('size-1.5 rounded-full', riskStyles.dot)} />
                          {riskStyles.label}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 hidden md:table-cell">
                        <div className="flex flex-wrap gap-1">
                          {w.reasons.map((r) => (
                            <span key={r} className="text-2xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                              {r}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardTable>
        </Card>
      )}

      {/* ═══ Upsell Candidates Widget ═══ */}
      {upsell && upsell.total > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-amber-500" />
              ลูกค้าพร้อมอัพเกรด
            </CardTitle>
            <CardToolbar>
              <span className="text-2xs font-semibold text-amber-600 bg-amber-500/10 px-2.5 py-1 rounded-md">
                {upsell.total} ราย
              </span>
              <button
                onClick={() => navigate('/customers?contractStatus=ACTIVE')}
                className="text-xs text-primary hover:underline ml-2 flex items-center gap-1"
              >
                ดูทั้งหมด <ArrowRight className="size-3" />
              </button>
            </CardToolbar>
          </CardHeader>
          <CardTable>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60">
                  <th className="text-left px-5 py-3 text-2xs font-semibold text-muted-foreground uppercase tracking-wider bg-muted/40">ลูกค้า</th>
                  <th className="text-left px-5 py-3 text-2xs font-semibold text-muted-foreground uppercase tracking-wider bg-muted/40 hidden sm:table-cell">เครื่อง</th>
                  <th className="text-left px-5 py-3 text-2xs font-semibold text-muted-foreground uppercase tracking-wider bg-muted/40">ความคืบหน้า</th>
                  <th className="text-left px-5 py-3 text-2xs font-semibold text-muted-foreground uppercase tracking-wider bg-muted/40 hidden md:table-cell">เหตุผล</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {upsell.candidates.map((c) => (
                  <tr
                    key={c.contractId}
                    className="hover:bg-muted/30 transition-colors cursor-pointer"
                    onClick={() => navigate(`/customers/${c.customerId}`)}
                  >
                    <td className="px-5 py-3.5">
                      <div className="font-medium text-foreground">{c.customerName}</div>
                      <div className="text-2xs text-muted-foreground flex items-center gap-1 mt-0.5">
                        <Phone className="size-3" />{c.customerPhone}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 hidden sm:table-cell">
                      <span className="text-xs text-foreground">{c.productModel ?? '-'}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-amber-500"
                            style={{ width: `${Math.min(c.paidRatio * 100, 100)}%` }}
                          />
                        </div>
                        <span className="text-xs font-medium text-foreground">
                          {c.paidCount}/{c.totalMonths}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 hidden md:table-cell">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400 font-medium">
                        {c.reason}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardTable>
        </Card>
      )}

      {/* ═══ Two-Column: Shortcuts + Monthly Revenue ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-7.5">
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
        <div className="lg:col-span-7 flex flex-col gap-5 lg:gap-7.5">
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
                        <tr className="bg-muted/40 border-b border-border/60 text-left text-muted-foreground">
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
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-7.5">
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
                <ChartContainer
                  config={{
                    newContracts: { label: 'สัญญาใหม่', color: 'hsl(217 91% 60%)' },
                    paymentsReceived: { label: 'ยอดชำระ (฿)', color: 'hsl(142 71% 45%)' },
                  } satisfies ChartConfig}
                  className="h-[280px] w-full"
                >
                  <AreaChart data={trend} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gradContracts" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--color-newContracts)" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="var(--color-newContracts)" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gradPayments" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--color-paymentsReceived)" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="var(--color-paymentsReceived)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="month"
                      tick={{ fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Area
                      type="monotone"
                      dataKey="newContracts"
                      name="สัญญาใหม่"
                      stroke="var(--color-newContracts)"
                      strokeWidth={2}
                      fill="url(#gradContracts)"
                    />
                    <Area
                      type="monotone"
                      dataKey="paymentsReceived"
                      name="ยอดชำระ (฿)"
                      stroke="var(--color-paymentsReceived)"
                      strokeWidth={2}
                      fill="url(#gradPayments)"
                    />
                  </AreaChart>
                </ChartContainer>
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
                  <tr className="bg-muted/40 border-b border-border/60 text-left text-muted-foreground">
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

      {/* ═══ Collection Pipeline ═══ */}
      {pipelineError && (
        <Card>
          <CardContent>
            <ErrorBlock message="โหลดข้อมูล collection pipeline ไม่สำเร็จ" onRetry={() => refetchPipeline()} />
          </CardContent>
        </Card>
      )}
      {collectionPipeline && collectionPipeline.totalContracts > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Layers className="size-4 text-muted-foreground" />
              Collection Pipeline
            </CardTitle>
            <CardToolbar>
              <span className="text-2xs text-destructive bg-destructive/10 px-2.5 py-1 rounded-md font-medium">
                {collectionPipeline.totalContracts} สัญญา
              </span>
            </CardToolbar>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-3">
              {collectionPipeline.stages.filter((s) => s.count > 0).map((stage) => {
                const pct = collectionPipeline.totalContracts > 0
                  ? Math.round((stage.count / collectionPipeline.totalContracts) * 100)
                  : 0;
                const stageColors: Record<string, { bar: string; badge: string; text: string }> = {
                  NONE:          { bar: 'bg-muted-foreground/40', badge: 'bg-muted/60 text-muted-foreground', text: 'text-muted-foreground' },
                  REMINDER:      { bar: 'bg-yellow-400', badge: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400', text: 'text-yellow-600 dark:text-yellow-400' },
                  NOTICE:        { bar: 'bg-orange-400', badge: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400', text: 'text-orange-600 dark:text-orange-400' },
                  FINAL_WARNING: { bar: 'bg-destructive/80', badge: 'bg-destructive/10 text-destructive', text: 'text-destructive' },
                  LEGAL_ACTION:  { bar: 'bg-destructive', badge: 'bg-destructive/20 text-destructive font-bold', text: 'text-destructive font-semibold' },
                };
                const colors = stageColors[stage.stage] ?? stageColors['NONE'];
                return (
                  <div key={stage.stage} className="flex items-center gap-3">
                    <div className="w-44 shrink-0">
                      <span className={cn('text-xs', colors.text)}>{stage.label}</span>
                    </div>
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className={cn('h-full rounded-full transition-all duration-500', colors.bar)}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="flex items-center gap-2 shrink-0 min-w-[120px] justify-end">
                      <span className={cn('text-xs px-2 py-0.5 rounded-md', colors.badge)}>
                        {stage.count} สัญญา
                      </span>
                      <span className="text-xs text-muted-foreground w-8 text-right">{pct}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 pt-3 border-t border-border/50 flex items-center justify-between text-xs text-muted-foreground">
              <span>ยอดค้างชำระรวม</span>
              <span className="font-semibold text-destructive text-sm">
                {collectionPipeline.totalAmount.toLocaleString('th-TH', { minimumFractionDigits: 0 })} บาท
              </span>
            </div>
          </CardContent>
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
                  <tr className="bg-muted/40 border-b border-border/60 text-left text-muted-foreground">
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
