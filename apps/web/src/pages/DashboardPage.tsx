import { useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardToolbar, CardTable, CardFooter } from '@/components/ui/card';

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
    <div className="flex flex-col gap-5 lg:gap-7.5">
      {/* Welcome Header - Metronic toolbar pattern */}
      <div className="flex flex-col justify-center gap-2">
        <h1 className="text-xl font-medium leading-none text-foreground">
          สวัสดี, {user?.name}
        </h1>
        <div className="text-sm text-muted-foreground">ภาพรวมระบบจัดการร้านของคุณวันนี้</div>
      </div>

      {/* Error State */}
      {kpisError && (
        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-xl p-4 flex items-center justify-between">
          <div className="text-sm text-red-700 dark:text-red-400">ไม่สามารถโหลดข้อมูลได้ กรุณาลองใหม่</div>
          <button onClick={() => refetchKpis()} className="px-3 py-1.5 bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-400 rounded-lg text-xs font-medium hover:bg-red-200 transition-colors">
            ลองใหม่
          </button>
        </div>
      )}

      {/* KPI Cards - Metronic stat card pattern */}
      {kpis && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-5 lg:gap-7.5 items-stretch">
          <Card className="h-full cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/contracts')}>
            <CardContent className="p-5 lg:p-7.5 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="size-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                  <svg className="size-5 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <span className="text-2xs font-medium text-green-700 dark:text-green-400 bg-green-100 dark:bg-green-900/30 px-2 py-0.5 rounded-md">
                  ปกติ {kpis.contracts.active}
                </span>
              </div>
              <div className="text-3xl font-semibold text-foreground">{kpis.contracts.total}</div>
              <div className="text-sm text-muted-foreground">สัญญาทั้งหมด</div>
            </CardContent>
          </Card>

          <Card className="h-full cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/overdue')}>
            <CardContent className="p-5 lg:p-7.5 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="size-10 rounded-lg bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                  <svg className="size-5 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                </div>
                <span className="text-2xs font-medium text-red-700 dark:text-red-400 bg-red-100 dark:bg-red-900/30 px-2 py-0.5 rounded-md">
                  {kpis.overdueRate.toFixed(1)}%
                </span>
              </div>
              <div className="text-3xl font-semibold text-foreground">
                {kpis.contracts.overdue + kpis.contracts.default}
              </div>
              <div className="text-sm text-muted-foreground">ค้างชำระ / ผิดนัด</div>
            </CardContent>
          </Card>

          <Card className="h-full cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/payments')}>
            <CardContent className="p-5 lg:p-7.5 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="size-10 rounded-lg bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                  <svg className="size-5 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <span className="text-2xs font-medium text-secondary-foreground bg-secondary px-2 py-0.5 rounded-md">
                  {kpis.financial.todayPaymentCount} รายการ
                </span>
              </div>
              <div className="text-3xl font-semibold text-foreground">
                {kpis.financial.todayPayments.toLocaleString()}
              </div>
              <div className="text-sm text-muted-foreground">ยอดรับชำระวันนี้ (฿)</div>
            </CardContent>
          </Card>

          <Card className="h-full cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/products')}>
            <CardContent className="p-5 lg:p-7.5 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="size-10 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                  <svg className="size-5 text-purple-600 dark:text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                </div>
                <span className="text-2xs font-medium text-secondary-foreground bg-secondary px-2 py-0.5 rounded-md">
                  จาก {kpis.products.total}
                </span>
              </div>
              <div className="text-3xl font-semibold text-foreground">{kpis.products.inStock}</div>
              <div className="text-sm text-muted-foreground">สินค้าในสต็อก</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Secondary Stats */}
      {kpis && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-5 lg:gap-7.5 items-stretch">
          <Card className="h-full cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/contracts')}>
            <CardContent className="p-5 flex flex-col gap-1">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">ลูกหนี้คงค้าง</div>
              <div className="text-lg font-semibold text-foreground">{kpis.financial.totalReceivable.toLocaleString()}</div>
              <div className="text-2xs text-muted-foreground">บาท</div>
            </CardContent>
          </Card>
          <Card className="h-full cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/contracts')}>
            <CardContent className="p-5 flex flex-col gap-1">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">ปิดสัญญาแล้ว</div>
              <div className="text-lg font-semibold text-primary">{kpis.contracts.completed}</div>
              <div className="text-2xs text-muted-foreground">สัญญา</div>
            </CardContent>
          </Card>
          <Card className="h-full">
            <CardContent className="p-5 flex flex-col gap-1">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">ค่าปรับรวม</div>
              <div className="text-lg font-semibold text-yellow-600 dark:text-yellow-400">{kpis.financial.totalLateFees.toLocaleString()}</div>
              <div className="text-2xs text-muted-foreground">บาท</div>
            </CardContent>
          </Card>
          <Card className="h-full cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/overdue')}>
            <CardContent className="p-5 flex flex-col gap-1">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">ค้างชำระ / ผิดนัด</div>
              <div className="text-lg font-semibold text-foreground">
                <span className="text-yellow-600 dark:text-yellow-400">{kpis.contracts.overdue}</span>
                <span className="text-muted-foreground mx-1">/</span>
                <span className="text-red-600 dark:text-red-400">{kpis.contracts.default}</span>
              </div>
              <div className="text-2xs text-muted-foreground">ค้างชำระ / ผิดนัด</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 lg:gap-7.5 items-stretch">
        {/* Monthly Trend */}
        <Card className="h-full">
          <CardHeader>
            <CardTitle>แนวโน้ม 12 เดือน</CardTitle>
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
                          className="h-2.5 bg-blue-500 rounded-full"
                          style={{ width: `${(t.newContracts / trendMax) * 100}%`, minWidth: '2px' }}
                        />
                        <span className="text-foreground font-medium">{t.newContracts}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div
                          className="h-2.5 bg-green-500 rounded-full"
                          style={{ width: `${(t.paymentsReceived / trendMax) * 100}%`, minWidth: '2px' }}
                        />
                        <span className="text-foreground font-medium">{t.paymentsReceived.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                ))}
                <div className="flex gap-4 text-2xs text-muted-foreground mt-4 pt-3 border-t border-border">
                  <span className="flex items-center gap-1.5">
                    <span className="size-2.5 bg-blue-500 rounded-full inline-block" /> สัญญาใหม่
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="size-2.5 bg-green-500 rounded-full inline-block" /> ยอดชำระ (บาท)
                  </span>
                </div>
              </div>
            ) : (
              <div className="text-center text-muted-foreground py-8 text-sm">ไม่มีข้อมูล</div>
            )}
          </CardContent>
        </Card>

        {/* Status Distribution */}
        <Card className="h-full">
          <CardHeader>
            <CardTitle>สถานะสัญญา</CardTitle>
            <CardToolbar>
              <span className="text-2xs text-muted-foreground bg-secondary px-2 py-0.5 rounded-md font-medium">
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
                      <span className={`size-2 rounded-full ${statusColors[s.status] || 'bg-zinc-400'}`} />
                      {statusLabels[s.status] || s.status}
                    </div>
                    <div className="flex-1 bg-secondary rounded-full h-4 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${statusColors[s.status] || 'bg-zinc-400'} opacity-80`}
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
      </div>

      {/* Top Overdue Table */}
      {topOverdueError && (
        <Card className="border-red-200 dark:border-red-900">
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
              <span className="text-2xs text-red-700 dark:text-red-400 bg-red-100 dark:bg-red-900/30 px-2 py-0.5 rounded-md font-medium">
                {topOverdue.length} รายการ
              </span>
            </CardToolbar>
          </CardHeader>
          <CardTable>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="px-5 pb-3 pt-4 font-medium text-xs">เลขสัญญา</th>
                    <th className="px-5 pb-3 pt-4 font-medium text-xs">ลูกค้า</th>
                    <th className="px-5 pb-3 pt-4 font-medium text-xs">เบอร์โทร</th>
                    <th className="px-5 pb-3 pt-4 font-medium text-xs text-right">ยอดค้าง (บาท)</th>
                    <th className="px-5 pb-3 pt-4 font-medium text-xs text-right">เกินกำหนด</th>
                  </tr>
                </thead>
                <tbody>
                  {topOverdue.map((item) => (
                    <tr key={item.contractNumber} className="border-b border-border last:border-0 hover:bg-muted/50 transition-colors">
                      <td className="px-5 py-3 font-medium text-primary">{item.contractNumber}</td>
                      <td className="px-5 py-3 text-foreground">{item.customer.name}</td>
                      <td className="px-5 py-3 text-muted-foreground">{item.customer.phone}</td>
                      <td className="px-5 py-3 text-right text-red-600 dark:text-red-400 font-semibold">
                        {item.totalOutstanding.toLocaleString()}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <span
                          className={`px-2 py-0.5 rounded-md text-2xs font-medium ${
                            item.daysOverdue > 60
                              ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                              : item.daysOverdue > 30
                                ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                                : 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
                          }`}
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
        <Card className="border-red-200 dark:border-red-900">
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
              <span className="text-2xs text-muted-foreground bg-secondary px-2 py-0.5 rounded-md font-medium">
                {branchData.length} สาขา
              </span>
            </CardToolbar>
          </CardHeader>
          <CardTable>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
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
                    <tr key={b.name} className="border-b border-border last:border-0 hover:bg-muted/50 transition-colors">
                      <td className="px-5 py-3 font-medium text-foreground">{b.name}</td>
                      <td className="px-5 py-3 text-right text-foreground">{b.contracts}</td>
                      <td className="px-5 py-3 text-right text-foreground">{b.products}</td>
                      <td className="px-5 py-3 text-right text-foreground">{b.users}</td>
                      <td className="px-5 py-3 text-right">
                        <span className={b.overdueContracts > 0 ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-foreground'}>
                          {b.overdueContracts}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right text-green-600 dark:text-green-400 font-medium">
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
