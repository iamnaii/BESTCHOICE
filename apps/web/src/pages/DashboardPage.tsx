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
  ACTIVE: 'bg-green-500',
  OVERDUE: 'bg-yellow-500',
  DEFAULT: 'bg-red-500',
  COMPLETED: 'bg-primary-500',
  EXCHANGED: 'bg-primary-500',
  CLOSED_BAD_DEBT: 'bg-gray-500',
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
      {/* Welcome Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">
          สวัสดี, {user?.name}
        </h1>
        <p className="text-sm text-gray-500 mt-1">ภาพรวมระบบจัดการร้านของคุณวันนี้</p>
      </div>

      {/* Error State */}
      {kpisError && (
        <div className="bg-red-50 border border-red-100 rounded-2xl p-4 mb-6 flex items-center justify-between">
          <div className="text-sm text-red-700">ไม่สามารถโหลดข้อมูลได้ กรุณาลองใหม่</div>
          <button onClick={() => refetchKpis()} className="px-4 py-1.5 bg-red-100 text-red-700 rounded-lg text-sm font-medium hover:bg-red-200 transition-colors">
            ลองใหม่
          </button>
        </div>
      )}

      {/* KPI Cards */}
      {kpis && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div
            className="bg-gradient-to-br from-primary-600 to-primary-700 rounded-2xl p-5 cursor-pointer hover:shadow-xl hover:shadow-primary-600/20 transition-all duration-300 hover:-translate-y-0.5"
            onClick={() => navigate('/contracts')}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
            </div>
            <div className="text-2xl font-bold text-white">{kpis.contracts.total}</div>
            <div className="text-sm text-primary-200 mt-1">สัญญาทั้งหมด</div>
            <div className="text-xs text-primary-300 mt-1">ปกติ {kpis.contracts.active}</div>
          </div>

          <div
            className="bg-gradient-to-br from-red-500 to-red-600 rounded-2xl p-5 cursor-pointer hover:shadow-xl hover:shadow-red-500/20 transition-all duration-300 hover:-translate-y-0.5"
            onClick={() => navigate('/overdue')}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
            </div>
            <div className="text-2xl font-bold text-white">
              {kpis.contracts.overdue + kpis.contracts.default}
            </div>
            <div className="text-sm text-red-200 mt-1">ค้างชำระ / ผิดนัด</div>
            <div className="text-xs text-red-300 mt-1">อัตรา {kpis.overdueRate.toFixed(1)}%</div>
          </div>

          <div
            className="bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-2xl p-5 cursor-pointer hover:shadow-xl hover:shadow-emerald-500/20 transition-all duration-300 hover:-translate-y-0.5"
            onClick={() => navigate('/payments')}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
            <div className="text-2xl font-bold text-white">
              {kpis.financial.todayPayments.toLocaleString()}
            </div>
            <div className="text-sm text-emerald-200 mt-1">ยอดรับชำระวันนี้ (฿)</div>
            <div className="text-xs text-emerald-300 mt-1">{kpis.financial.todayPaymentCount} รายการ</div>
          </div>

          <div
            className="bg-gradient-to-br from-primary-500 to-primary-600 rounded-2xl p-5 cursor-pointer hover:shadow-xl hover:shadow-primary-500/20 transition-all duration-300 hover:-translate-y-0.5"
            onClick={() => navigate('/products')}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
              </div>
            </div>
            <div className="text-2xl font-bold text-white">{kpis.products.inStock}</div>
            <div className="text-sm text-primary-200 mt-1">สินค้าในสต็อก</div>
            <div className="text-xs text-primary-300 mt-1">จาก {kpis.products.total} ชิ้น</div>
          </div>
        </div>
      )}

      {/* Secondary Stats */}
      {kpis && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-2xl border border-gray-100 p-5 hover:shadow-md transition-all cursor-pointer" onClick={() => navigate('/contracts')}>
            <div className="text-sm text-gray-500">ลูกหนี้คงค้าง</div>
            <div className="text-xl font-bold text-gray-900 mt-1">{kpis.financial.totalReceivable.toLocaleString()}</div>
            <div className="text-xs text-gray-400 mt-1">บาท</div>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 p-5 hover:shadow-md transition-all cursor-pointer" onClick={() => navigate('/contracts')}>
            <div className="text-sm text-gray-500">ปิดสัญญาแล้ว</div>
            <div className="text-xl font-bold text-primary-600 mt-1">{kpis.contracts.completed}</div>
            <div className="text-xs text-gray-400 mt-1">สัญญา</div>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 p-5 hover:shadow-md transition-all">
            <div className="text-sm text-gray-500">ค่าปรับรวม</div>
            <div className="text-xl font-bold text-orange-600 mt-1">{kpis.financial.totalLateFees.toLocaleString()}</div>
            <div className="text-xs text-gray-400 mt-1">บาท</div>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 p-5 hover:shadow-md transition-all cursor-pointer" onClick={() => navigate('/overdue')}>
            <div className="text-sm text-gray-500">ค้างชำระ / ผิดนัด</div>
            <div className="text-xl font-bold text-yellow-600 mt-1">
              {kpis.contracts.overdue}
              <span className="text-red-500 ml-2 text-base">/ {kpis.contracts.default}</span>
            </div>
            <div className="text-xs text-gray-400 mt-1">ค้างชำระ / ผิดนัด</div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Monthly Trend */}
        <div className="bg-white rounded-2xl border border-gray-100 p-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-5">แนวโน้ม 12 เดือน</h3>
          {trendError ? (
            <div className="text-center py-8">
              <p className="text-sm text-red-500 mb-2">โหลดข้อมูลไม่สำเร็จ</p>
              <button onClick={() => refetchTrend()} className="text-xs text-primary-600 hover:underline">ลองใหม่</button>
            </div>
          ) : trend.length > 0 ? (
            <div className="space-y-2.5">
              {trend.map((t) => (
                <div key={t.month} className="flex items-center gap-3 text-xs">
                  <div className="w-16 text-gray-500 shrink-0 font-medium">{t.month}</div>
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <div
                        className="h-3 bg-gradient-to-r from-primary-400 to-primary-600 rounded-full"
                        style={{ width: `${(t.newContracts / trendMax) * 100}%`, minWidth: '2px' }}
                      />
                      <span className="text-gray-600 font-medium">{t.newContracts}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div
                        className="h-3 bg-gradient-to-r from-emerald-400 to-emerald-600 rounded-full"
                        style={{ width: `${(t.paymentsReceived / trendMax) * 100}%`, minWidth: '2px' }}
                      />
                      <span className="text-gray-600 font-medium">{t.paymentsReceived.toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              ))}
              <div className="flex gap-4 text-xs text-gray-500 mt-4 pt-3 border-t border-gray-100">
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 bg-gradient-to-r from-primary-400 to-primary-600 rounded-full inline-block" /> สัญญาใหม่
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 bg-gradient-to-r from-emerald-400 to-emerald-600 rounded-full inline-block" /> ยอดชำระ (บาท)
                </span>
              </div>
            </div>
          ) : (
            <div className="text-center text-gray-400 py-8">ไม่มีข้อมูล</div>
          )}
        </div>

        {/* Status Distribution */}
        <div className="bg-white rounded-2xl border border-gray-100 p-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-5">สถานะสัญญา</h3>
          {statusDistError ? (
            <div className="text-center py-8">
              <p className="text-sm text-red-500 mb-2">โหลดข้อมูลไม่สำเร็จ</p>
              <button onClick={() => refetchStatusDist()} className="text-xs text-primary-600 hover:underline">ลองใหม่</button>
            </div>
          ) : statusDist.length > 0 ? (
            <div className="space-y-4">
              {statusDist.map((s) => (
                <div key={s.status} className="flex items-center gap-3">
                  <div className="w-24 text-xs text-gray-600 font-medium">
                    {statusLabels[s.status] || s.status}
                  </div>
                  <div className="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${statusColors[s.status] || 'bg-gray-400'}`}
                      style={{
                        width: totalStatusCount > 0 ? `${(s.count / totalStatusCount) * 100}%` : '0%',
                        minWidth: s.count > 0 ? '8px' : '0',
                      }}
                    />
                  </div>
                  <div className="w-12 text-right text-sm font-bold text-gray-700">{s.count}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center text-gray-400 py-8">ไม่มีข้อมูล</div>
          )}
        </div>
      </div>

      {/* Top Overdue */}
      {topOverdueError && (
        <div className="bg-white rounded-2xl border border-red-100 p-6 mb-6 text-center">
          <p className="text-sm text-red-500 mb-2">โหลดข้อมูลค้างชำระไม่สำเร็จ</p>
          <button onClick={() => refetchTopOverdue()} className="text-xs text-primary-600 hover:underline">ลองใหม่</button>
        </div>
      )}
      {topOverdue.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-5">สัญญาค้างชำระสูงสุด (Top 10)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-gray-500">
                  <th className="pb-3 font-medium">เลขสัญญา</th>
                  <th className="pb-3 font-medium">ลูกค้า</th>
                  <th className="pb-3 font-medium">เบอร์โทร</th>
                  <th className="pb-3 font-medium text-right">ยอดค้าง (บาท)</th>
                  <th className="pb-3 font-medium text-right">เกินกำหนด (วัน)</th>
                </tr>
              </thead>
              <tbody>
                {topOverdue.map((item) => (
                  <tr key={item.contractNumber} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors">
                    <td className="py-3 font-medium text-primary-600">{item.contractNumber}</td>
                    <td className="py-3">{item.customer.name}</td>
                    <td className="py-3 text-gray-500">{item.customer.phone}</td>
                    <td className="py-3 text-right text-red-600 font-bold">
                      {item.totalOutstanding.toLocaleString()}
                    </td>
                    <td className="py-3 text-right">
                      <span
                        className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                          item.daysOverdue > 60
                            ? 'bg-red-100 text-red-700'
                            : item.daysOverdue > 30
                              ? 'bg-yellow-100 text-yellow-700'
                              : 'bg-orange-100 text-orange-700'
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
        <div className="bg-white rounded-2xl border border-red-100 p-6 mb-6 text-center">
          <p className="text-sm text-red-500 mb-2">โหลดข้อมูลสาขาไม่สำเร็จ</p>
          <button onClick={() => refetchBranch()} className="text-xs text-primary-600 hover:underline">ลองใหม่</button>
        </div>
      )}
      {user?.role === 'OWNER' && branchData.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-5">เปรียบเทียบสาขา</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-gray-500">
                  <th className="pb-3 font-medium">สาขา</th>
                  <th className="pb-3 font-medium text-right">สัญญา</th>
                  <th className="pb-3 font-medium text-right">สินค้า</th>
                  <th className="pb-3 font-medium text-right">พนักงาน</th>
                  <th className="pb-3 font-medium text-right">ค้างชำระ</th>
                  <th className="pb-3 font-medium text-right">ยอดชำระ/เดือน</th>
                </tr>
              </thead>
              <tbody>
                {branchData.map((b) => (
                  <tr key={b.name} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors">
                    <td className="py-3 font-medium">{b.name}</td>
                    <td className="py-3 text-right">{b.contracts}</td>
                    <td className="py-3 text-right">{b.products}</td>
                    <td className="py-3 text-right">{b.users}</td>
                    <td className="py-3 text-right">
                      <span className={b.overdueContracts > 0 ? 'text-red-600 font-bold' : ''}>
                        {b.overdueContracts}
                      </span>
                    </td>
                    <td className="py-3 text-right text-emerald-600 font-medium">
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
