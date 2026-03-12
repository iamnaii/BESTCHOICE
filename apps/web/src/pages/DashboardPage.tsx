import { useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';

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
  ACTIVE: 'bg-emerald-500',
  OVERDUE: 'bg-amber-500',
  DEFAULT: 'bg-red-500',
  COMPLETED: 'bg-primary-500',
  EXCHANGED: 'bg-violet-500',
  CLOSED_BAD_DEBT: 'bg-gray-400',
};

const statusIconBg: Record<string, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400',
  OVERDUE: 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
  DEFAULT: 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400',
  COMPLETED: 'bg-primary-50 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400',
  EXCHANGED: 'bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400',
  CLOSED_BAD_DEBT: 'bg-gray-50 text-gray-500 dark:bg-gray-900/30 dark:text-gray-400',
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
    <div>
      {/* Welcome Header - Metronic style */}
      <div className="mb-6 pb-5 border-b border-border">
        <h1 className="text-xl font-semibold text-foreground tracking-tight">
          สวัสดี, {user?.name}
        </h1>
        <p className="text-[13px] text-muted-foreground mt-0.5">ภาพรวมระบบจัดการร้านของคุณวันนี้</p>
      </div>

      {/* Error State */}
      {kpisError && (
        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-xl p-4 mb-5 flex items-center justify-between">
          <div className="text-[13px] text-red-700 dark:text-red-400">ไม่สามารถโหลดข้อมูลได้ กรุณาลองใหม่</div>
          <button onClick={() => refetchKpis()} className="px-3 py-1.5 bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-400 rounded-lg text-[12px] font-medium hover:bg-red-200 transition-colors">
            ลองใหม่
          </button>
        </div>
      )}

      {/* KPI Cards - Metronic stat card style */}
      {kpis && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div
            className="bg-card rounded-xl border border-border p-5 cursor-pointer hover:shadow-card-hover transition-all group"
            onClick={() => navigate('/contracts')}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="w-10 h-10 rounded-lg bg-primary-50 dark:bg-primary-900/30 flex items-center justify-center">
                <svg className="w-5 h-5 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 px-2 py-0.5 rounded-md">
                ปกติ {kpis.contracts.active}
              </span>
            </div>
            <div className="text-2xl font-bold text-foreground">{kpis.contracts.total}</div>
            <div className="text-[13px] text-muted-foreground mt-0.5">สัญญาทั้งหมด</div>
          </div>

          <div
            className="bg-card rounded-xl border border-border p-5 cursor-pointer hover:shadow-card-hover transition-all group"
            onClick={() => navigate('/overdue')}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="w-10 h-10 rounded-lg bg-red-50 dark:bg-red-900/30 flex items-center justify-center">
                <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <span className="text-[11px] font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 px-2 py-0.5 rounded-md">
                {kpis.overdueRate.toFixed(1)}%
              </span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {kpis.contracts.overdue + kpis.contracts.default}
            </div>
            <div className="text-[13px] text-muted-foreground mt-0.5">ค้างชำระ / ผิดนัด</div>
          </div>

          <div
            className="bg-card rounded-xl border border-border p-5 cursor-pointer hover:shadow-card-hover transition-all group"
            onClick={() => navigate('/payments')}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 flex items-center justify-center">
                <svg className="w-5 h-5 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <span className="text-[11px] font-medium text-muted-foreground bg-secondary px-2 py-0.5 rounded-md">
                {kpis.financial.todayPaymentCount} รายการ
              </span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {kpis.financial.todayPayments.toLocaleString()}
            </div>
            <div className="text-[13px] text-muted-foreground mt-0.5">ยอดรับชำระวันนี้ (฿)</div>
          </div>

          <div
            className="bg-card rounded-xl border border-border p-5 cursor-pointer hover:shadow-card-hover transition-all group"
            onClick={() => navigate('/products')}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="w-10 h-10 rounded-lg bg-violet-50 dark:bg-violet-900/30 flex items-center justify-center">
                <svg className="w-5 h-5 text-violet-600 dark:text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
              </div>
              <span className="text-[11px] font-medium text-muted-foreground bg-secondary px-2 py-0.5 rounded-md">
                จาก {kpis.products.total}
              </span>
            </div>
            <div className="text-2xl font-bold text-foreground">{kpis.products.inStock}</div>
            <div className="text-[13px] text-muted-foreground mt-0.5">สินค้าในสต็อก</div>
          </div>
        </div>
      )}

      {/* Secondary Stats - Metronic compact cards */}
      {kpis && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-card rounded-xl border border-border p-4 hover:shadow-card-hover transition-all cursor-pointer" onClick={() => navigate('/contracts')}>
            <div className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">ลูกหนี้คงค้าง</div>
            <div className="text-lg font-bold text-foreground mt-1">{kpis.financial.totalReceivable.toLocaleString()}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">บาท</div>
          </div>
          <div className="bg-card rounded-xl border border-border p-4 hover:shadow-card-hover transition-all cursor-pointer" onClick={() => navigate('/contracts')}>
            <div className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">ปิดสัญญาแล้ว</div>
            <div className="text-lg font-bold text-primary-600 dark:text-primary-400 mt-1">{kpis.contracts.completed}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">สัญญา</div>
          </div>
          <div className="bg-card rounded-xl border border-border p-4 hover:shadow-card-hover transition-all">
            <div className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">ค่าปรับรวม</div>
            <div className="text-lg font-bold text-amber-600 dark:text-amber-400 mt-1">{kpis.financial.totalLateFees.toLocaleString()}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">บาท</div>
          </div>
          <div className="bg-card rounded-xl border border-border p-4 hover:shadow-card-hover transition-all cursor-pointer" onClick={() => navigate('/overdue')}>
            <div className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">ค้างชำระ / ผิดนัด</div>
            <div className="text-lg font-bold text-foreground mt-1">
              <span className="text-amber-600 dark:text-amber-400">{kpis.contracts.overdue}</span>
              <span className="text-muted-foreground mx-1">/</span>
              <span className="text-red-600 dark:text-red-400">{kpis.contracts.default}</span>
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">ค้างชำระ / ผิดนัด</div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
        {/* Monthly Trend */}
        <div className="bg-card rounded-xl border border-border p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[14px] font-semibold text-foreground">แนวโน้ม 12 เดือน</h3>
          </div>
          {trendError ? (
            <div className="text-center py-8">
              <p className="text-[13px] text-red-500 dark:text-red-400 mb-2">โหลดข้อมูลไม่สำเร็จ</p>
              <button onClick={() => refetchTrend()} className="text-[12px] text-primary-600 dark:text-primary-400 hover:underline">ลองใหม่</button>
            </div>
          ) : trend.length > 0 ? (
            <div className="space-y-2">
              {trend.map((t) => (
                <div key={t.month} className="flex items-center gap-3 text-[12px]">
                  <div className="w-14 text-muted-foreground shrink-0 font-medium">{t.month}</div>
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <div
                        className="h-2.5 bg-primary-500 rounded-full"
                        style={{ width: `${(t.newContracts / trendMax) * 100}%`, minWidth: '2px' }}
                      />
                      <span className="text-foreground font-medium">{t.newContracts}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div
                        className="h-2.5 bg-emerald-500 rounded-full"
                        style={{ width: `${(t.paymentsReceived / trendMax) * 100}%`, minWidth: '2px' }}
                      />
                      <span className="text-foreground font-medium">{t.paymentsReceived.toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              ))}
              <div className="flex gap-4 text-[11px] text-muted-foreground mt-4 pt-3 border-t border-border">
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 bg-primary-500 rounded-full inline-block" /> สัญญาใหม่
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full inline-block" /> ยอดชำระ (บาท)
                </span>
              </div>
            </div>
          ) : (
            <div className="text-center text-muted-foreground py-8 text-[13px]">ไม่มีข้อมูล</div>
          )}
        </div>

        {/* Status Distribution */}
        <div className="bg-card rounded-xl border border-border p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[14px] font-semibold text-foreground">สถานะสัญญา</h3>
            <span className="text-[11px] text-muted-foreground bg-secondary px-2 py-0.5 rounded-md font-medium">
              ทั้งหมด {totalStatusCount}
            </span>
          </div>
          {statusDistError ? (
            <div className="text-center py-8">
              <p className="text-[13px] text-red-500 dark:text-red-400 mb-2">โหลดข้อมูลไม่สำเร็จ</p>
              <button onClick={() => refetchStatusDist()} className="text-[12px] text-primary-600 dark:text-primary-400 hover:underline">ลองใหม่</button>
            </div>
          ) : statusDist.length > 0 ? (
            <div className="space-y-3">
              {statusDist.map((s) => (
                <div key={s.status} className="flex items-center gap-3">
                  <div className="w-24 text-[12px] text-foreground font-medium flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${statusColors[s.status] || 'bg-gray-400'}`} />
                    {statusLabels[s.status] || s.status}
                  </div>
                  <div className="flex-1 bg-secondary rounded-full h-4 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${statusColors[s.status] || 'bg-gray-400'} opacity-80`}
                      style={{
                        width: totalStatusCount > 0 ? `${(s.count / totalStatusCount) * 100}%` : '0%',
                        minWidth: s.count > 0 ? '8px' : '0',
                      }}
                    />
                  </div>
                  <div className="w-10 text-right text-[13px] font-bold text-foreground">{s.count}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center text-muted-foreground py-8 text-[13px]">ไม่มีข้อมูล</div>
          )}
        </div>
      </div>

      {/* Top Overdue */}
      {topOverdueError && (
        <div className="bg-card rounded-xl border border-red-200 dark:border-red-900 p-5 mb-5 text-center">
          <p className="text-[13px] text-red-500 dark:text-red-400 mb-2">โหลดข้อมูลค้างชำระไม่สำเร็จ</p>
          <button onClick={() => refetchTopOverdue()} className="text-[12px] text-primary-600 dark:text-primary-400 hover:underline">ลองใหม่</button>
        </div>
      )}
      {topOverdue.length > 0 && (
        <div className="bg-card rounded-xl border border-border p-5 mb-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[14px] font-semibold text-foreground">สัญญาค้างชำระสูงสุด (Top 10)</h3>
            <span className="text-[11px] text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 px-2 py-0.5 rounded-md font-medium">
              {topOverdue.length} รายการ
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="pb-3 font-medium text-[12px] uppercase tracking-wider">เลขสัญญา</th>
                  <th className="pb-3 font-medium text-[12px] uppercase tracking-wider">ลูกค้า</th>
                  <th className="pb-3 font-medium text-[12px] uppercase tracking-wider">เบอร์โทร</th>
                  <th className="pb-3 font-medium text-[12px] uppercase tracking-wider text-right">ยอดค้าง (บาท)</th>
                  <th className="pb-3 font-medium text-[12px] uppercase tracking-wider text-right">เกินกำหนด</th>
                </tr>
              </thead>
              <tbody>
                {topOverdue.map((item) => (
                  <tr key={item.contractNumber} className="border-b border-border/50 last:border-0 hover:bg-secondary/50 transition-colors">
                    <td className="py-3 font-medium text-primary-600 dark:text-primary-400">{item.contractNumber}</td>
                    <td className="py-3 text-foreground">{item.customer.name}</td>
                    <td className="py-3 text-muted-foreground">{item.customer.phone}</td>
                    <td className="py-3 text-right text-red-600 dark:text-red-400 font-bold">
                      {item.totalOutstanding.toLocaleString()}
                    </td>
                    <td className="py-3 text-right">
                      <span
                        className={`px-2 py-0.5 rounded-md text-[11px] font-semibold ${
                          item.daysOverdue > 60
                            ? 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                            : item.daysOverdue > 30
                              ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                              : 'bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
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
        </div>
      )}

      {/* Branch Comparison (OWNER only) */}
      {user?.role === 'OWNER' && branchError && (
        <div className="bg-card rounded-xl border border-red-200 dark:border-red-900 p-5 mb-5 text-center">
          <p className="text-[13px] text-red-500 dark:text-red-400 mb-2">โหลดข้อมูลสาขาไม่สำเร็จ</p>
          <button onClick={() => refetchBranch()} className="text-[12px] text-primary-600 dark:text-primary-400 hover:underline">ลองใหม่</button>
        </div>
      )}
      {user?.role === 'OWNER' && branchData.length > 0 && (
        <div className="bg-card rounded-xl border border-border p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[14px] font-semibold text-foreground">เปรียบเทียบสาขา</h3>
            <span className="text-[11px] text-muted-foreground bg-secondary px-2 py-0.5 rounded-md font-medium">
              {branchData.length} สาขา
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="pb-3 font-medium text-[12px] uppercase tracking-wider">สาขา</th>
                  <th className="pb-3 font-medium text-[12px] uppercase tracking-wider text-right">สัญญา</th>
                  <th className="pb-3 font-medium text-[12px] uppercase tracking-wider text-right">สินค้า</th>
                  <th className="pb-3 font-medium text-[12px] uppercase tracking-wider text-right">พนักงาน</th>
                  <th className="pb-3 font-medium text-[12px] uppercase tracking-wider text-right">ค้างชำระ</th>
                  <th className="pb-3 font-medium text-[12px] uppercase tracking-wider text-right">ยอดชำระ/เดือน</th>
                </tr>
              </thead>
              <tbody>
                {branchData.map((b) => (
                  <tr key={b.name} className="border-b border-border/50 last:border-0 hover:bg-secondary/50 transition-colors">
                    <td className="py-3 font-medium text-foreground">{b.name}</td>
                    <td className="py-3 text-right text-foreground">{b.contracts}</td>
                    <td className="py-3 text-right text-foreground">{b.products}</td>
                    <td className="py-3 text-right text-foreground">{b.users}</td>
                    <td className="py-3 text-right">
                      <span className={b.overdueContracts > 0 ? 'text-red-600 dark:text-red-400 font-bold' : 'text-foreground'}>
                        {b.overdueContracts}
                      </span>
                    </td>
                    <td className="py-3 text-right text-emerald-600 dark:text-emerald-400 font-medium">
                      {b.monthlyPayments.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
