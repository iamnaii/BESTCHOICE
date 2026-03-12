import { useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardToolbar, CardTable } from '@/components/ui/card';
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
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

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

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const dashboardStaleTime = 5 * 60 * 1000;

  const { data: kpis, isError: kpisError, refetch: refetchKpis } = useQuery<KPIs>({
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

  const totalStatusCount = useMemo(() => statusDist.reduce((sum, s) => sum + s.count, 0), [statusDist]);
  const trendMax = useMemo(() => Math.max(...trend.map((t) => Math.max(t.newContracts, t.paymentsReceived)), 1), [trend]);

  return (
    <div className="flex flex-col gap-5 lg:gap-7">
      {/* Page Title — Demo 9 pattern */}
      <div>
        <h1 className="text-xl font-semibold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          สวัสดี {user?.name} — ภาพรวมระบบจัดการร้านของคุณวันนี้
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

      {/* ═══ Demo 9 Two-Column Layout ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-7">
        {/* ─── Left Column: Shortcuts + Activities ─── */}
        <div className="lg:col-span-5 flex flex-col gap-5 lg:gap-7">
          {/* Quick Action Shortcuts — Demo 9 icon card grid */}
          <div className="grid grid-cols-2 gap-4">
            <ShortcutCard icon={ShoppingCart} label="POS ขายสินค้า" path="/pos" color="bg-blue-500" />
            <ShortcutCard icon={FileCheck} label="สัญญาผ่อน" path="/contracts" color="bg-indigo-500" />
            <ShortcutCard icon={DollarSign} label="ชำระเงิน" path="/payments" color="bg-green-500" />
            <ShortcutCard icon={Users} label="ลูกค้า" path="/customers" color="bg-purple-500" />
            <ShortcutCard icon={Warehouse} label="คลังสินค้า" path="/stock" color="bg-orange-500" />
            <ShortcutCard icon={BarChart3} label="รายงาน" path="/reports" color="bg-cyan-500" />
          </div>

          {/* Activities — Monthly Trend (styled as timeline) */}
          <Card>
            <CardHeader>
              <CardTitle>แนวโน้ม 12 เดือน</CardTitle>
              <CardToolbar>
                <span className="text-2xs text-muted-foreground">Latest trends</span>
              </CardToolbar>
            </CardHeader>
            <CardContent>
              {trendError ? (
                <div className="text-center py-8">
                  <p className="text-sm text-destructive mb-2">โหลดข้อมูลไม่สำเร็จ</p>
                  <button onClick={() => refetchTrend()} className="text-xs text-primary hover:underline">ลองใหม่</button>
                </div>
              ) : trend.length > 0 ? (
                <div className="space-y-2">
                  {trend.map((t) => (
                    <div key={t.month} className="flex items-center gap-3 text-xs">
                      <div className="w-14 text-muted-foreground shrink-0 font-medium">{t.month}</div>
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <div
                            className="h-2.5 bg-primary rounded-full"
                            style={{ width: `${(t.newContracts / trendMax) * 100}%`, minWidth: '2px' }}
                          />
                          <span className="text-foreground font-medium">{t.newContracts}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div
                            className="h-2.5 bg-success rounded-full"
                            style={{ width: `${(t.paymentsReceived / trendMax) * 100}%`, minWidth: '2px' }}
                          />
                          <span className="text-foreground font-medium">{t.paymentsReceived.toLocaleString()}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                  <div className="flex gap-4 text-2xs text-muted-foreground mt-4 pt-3 border-t border-border/50">
                    <span className="flex items-center gap-1.5">
                      <span className="size-2.5 bg-primary rounded-full inline-block" /> สัญญาใหม่
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="size-2.5 bg-success rounded-full inline-block" /> ยอดชำระ (บาท)
                    </span>
                  </div>
                </div>
              ) : (
                <div className="text-center text-muted-foreground py-8 text-sm">ไม่มีข้อมูล</div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ─── Right Column: KPI Banner + Status + Todo ─── */}
        <div className="lg:col-span-7 flex flex-col gap-5 lg:gap-7">
          {/* KPI Summary Banner — Demo 9 blue promo style */}
          {kpis && (
            <div className="rounded-xl bg-gradient-to-br from-blue-500 via-blue-600 to-indigo-700 text-white p-6 lg:p-8">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="cursor-pointer" onClick={() => navigate('/contracts')}>
                  <div className="flex items-center gap-2 mb-2">
                    <FileCheck className="size-4 opacity-70" />
                    <span className="text-xs text-white/70 font-medium">สัญญาทั้งหมด</span>
                  </div>
                  <div className="text-2xl lg:text-3xl font-bold">{kpis.contracts.total}</div>
                  <div className="text-xs text-white/60 mt-1">ปกติ {kpis.contracts.active}</div>
                </div>
                <div className="cursor-pointer" onClick={() => navigate('/overdue')}>
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="size-4 opacity-70" />
                    <span className="text-xs text-white/70 font-medium">ค้าง/ผิดนัด</span>
                  </div>
                  <div className="text-2xl lg:text-3xl font-bold">{kpis.contracts.overdue + kpis.contracts.default}</div>
                  <div className="text-xs text-white/60 mt-1">{kpis.overdueRate.toFixed(1)}%</div>
                </div>
                <div className="cursor-pointer" onClick={() => navigate('/payments')}>
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingUp className="size-4 opacity-70" />
                    <span className="text-xs text-white/70 font-medium">ยอดรับวันนี้</span>
                  </div>
                  <div className="text-2xl lg:text-3xl font-bold">฿{kpis.financial.todayPayments.toLocaleString()}</div>
                  <div className="text-xs text-white/60 mt-1">{kpis.financial.todayPaymentCount} รายการ</div>
                </div>
                <div className="cursor-pointer" onClick={() => navigate('/stock')}>
                  <div className="flex items-center gap-2 mb-2">
                    <Warehouse className="size-4 opacity-70" />
                    <span className="text-xs text-white/70 font-medium">สินค้าในสต็อก</span>
                  </div>
                  <div className="text-2xl lg:text-3xl font-bold">{kpis.products.inStock}</div>
                  <div className="text-xs text-white/60 mt-1">จาก {kpis.products.total}</div>
                </div>
              </div>
            </div>
          )}

          {/* Status Distribution — Demo 9 "Trends" card style */}
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
                <div className="text-center py-8">
                  <p className="text-sm text-destructive mb-2">โหลดข้อมูลไม่สำเร็จ</p>
                  <button onClick={() => refetchStatusDist()} className="text-xs text-primary hover:underline">ลองใหม่</button>
                </div>
              ) : statusDist.length > 0 ? (
                <div className="space-y-3">
                  {statusDist.map((s) => (
                    <div key={s.status} className="flex items-center gap-3">
                      <div className="w-24 text-xs text-foreground font-medium flex items-center gap-2">
                        <span className={cn('size-2 rounded-full', statusColors[s.status] || 'bg-zinc-400')} />
                        {statusLabels[s.status] || s.status}
                      </div>
                      <div className="flex-1 bg-muted rounded-full h-3 overflow-hidden">
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
              ) : (
                <div className="text-center text-muted-foreground py-8 text-sm">ไม่มีข้อมูล</div>
              )}
            </CardContent>
          </Card>

          {/* Secondary KPI Cards — Demo 9 "Todo" style with colored left border */}
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

      {/* ═══ Full-Width Sections Below ═══ */}

      {/* Top Overdue Table — Demo 9 "Latest Products" table style */}
      {topOverdueError && (
        <Card>
          <CardContent className="text-center py-8">
            <p className="text-sm text-destructive mb-2">โหลดข้อมูลค้างชำระไม่สำเร็จ</p>
            <button onClick={() => refetchTopOverdue()} className="text-xs text-primary hover:underline">ลองใหม่</button>
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
                                : 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
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

      {/* Branch Comparison (OWNER only) */}
      {user?.role === 'OWNER' && branchError && (
        <Card>
          <CardContent className="text-center py-8">
            <p className="text-sm text-destructive mb-2">โหลดข้อมูลสาขาไม่สำเร็จ</p>
            <button onClick={() => refetchBranch()} className="text-xs text-primary hover:underline">ลองใหม่</button>
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
