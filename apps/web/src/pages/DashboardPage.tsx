import { useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';

interface KPIs {
  totalContracts: number;
  activeContracts: number;
  overdueContracts: number;
  defaultContracts: number;
  completedContracts: number;
  totalProducts: number;
  inStockProducts: number;
  totalReceivable: number;
  totalLateFees: number;
  todayPayments: number;
  overdueRate: number;
}

interface MonthlyTrend {
  month: string;
  newContracts: number;
  paymentsReceived: number;
}

interface TopOverdue {
  contractNumber: string;
  customerName: string;
  outstandingAmount: number;
  daysOverdue: number;
  phone: string;
}

interface StatusDistribution {
  status: string;
  count: number;
}

interface BranchComparison {
  branchName: string;
  contracts: number;
  products: number;
  users: number;
  overdueCount: number;
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
  CLOSED_BAD_DEBT: 'bg-gray-500',
};

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const dashboardStaleTime = 5 * 60 * 1000; // 5 minutes - dashboard data cached in RAM

  const { data: kpis } = useQuery<KPIs>({
    queryKey: ['dashboard-kpis'],
    queryFn: async () => (await api.get('/dashboard/kpis')).data,
    staleTime: dashboardStaleTime,
  });

  const { data: trend = [] } = useQuery<MonthlyTrend[]>({
    queryKey: ['dashboard-trend'],
    queryFn: async () => (await api.get('/dashboard/monthly-trend')).data,
    staleTime: dashboardStaleTime,
  });

  const { data: topOverdue = [] } = useQuery<TopOverdue[]>({
    queryKey: ['dashboard-top-overdue'],
    queryFn: async () => (await api.get('/dashboard/top-overdue')).data,
    staleTime: dashboardStaleTime,
  });

  const { data: statusDist = [] } = useQuery<StatusDistribution[]>({
    queryKey: ['dashboard-status-dist'],
    queryFn: async () => (await api.get('/dashboard/status-distribution')).data,
    staleTime: dashboardStaleTime,
  });

  const { data: branchData = [] } = useQuery<BranchComparison[]>({
    queryKey: ['dashboard-branches'],
    queryFn: async () => (await api.get('/dashboard/branch-comparison')).data,
    enabled: user?.role === 'OWNER',
    staleTime: dashboardStaleTime,
  });

  const totalStatusCount = useMemo(() => statusDist.reduce((sum, s) => sum + s.count, 0), [statusDist]);
  const trendMax = useMemo(() => Math.max(...trend.map((t) => Math.max(t.newContracts, t.paymentsReceived)), 1), [trend]);

  return (
    <div>
      <PageHeader title="หน้าหลัก" subtitle={`ยินดีต้อนรับ ${user?.name}`} />

      {/* KPI Cards */}
      {kpis && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg border p-4 cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/contracts')}>
            <div className="text-sm text-gray-500">สัญญาทั้งหมด</div>
            <div className="text-2xl font-bold text-gray-900">{kpis.totalContracts}</div>
            <div className="text-xs text-green-600 mt-1">ปกติ {kpis.activeContracts}</div>
          </div>
          <div className="bg-white rounded-lg border p-4 cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/overdue')}>
            <div className="text-sm text-gray-500">ค้างชำระ / ผิดนัด</div>
            <div className="text-2xl font-bold text-red-600">
              {kpis.overdueContracts + kpis.defaultContracts}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              อัตรา {(kpis.overdueRate * 100).toFixed(1)}%
            </div>
          </div>
          <div className="bg-white rounded-lg border p-4 cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/payments')}>
            <div className="text-sm text-gray-500">ยอดรับชำระวันนี้</div>
            <div className="text-2xl font-bold text-green-600">
              {kpis.todayPayments.toLocaleString()}
            </div>
            <div className="text-xs text-gray-500 mt-1">บาท</div>
          </div>
          <div className="bg-white rounded-lg border p-4 cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/contracts')}>
            <div className="text-sm text-gray-500">ลูกหนี้คงค้าง</div>
            <div className="text-2xl font-bold text-blue-600">
              {kpis.totalReceivable.toLocaleString()}
            </div>
            <div className="text-xs text-gray-500 mt-1">บาท</div>
          </div>
          <div className="bg-white rounded-lg border p-4 cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/products')}>
            <div className="text-sm text-gray-500">สินค้าในสต็อก</div>
            <div className="text-2xl font-bold text-purple-600">{kpis.inStockProducts}</div>
            <div className="text-xs text-gray-500 mt-1">จาก {kpis.totalProducts} ชิ้น</div>
          </div>
          <div className="bg-white rounded-lg border p-4 cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/contracts')}>
            <div className="text-sm text-gray-500">ปิดสัญญาแล้ว</div>
            <div className="text-2xl font-bold text-blue-500">{kpis.completedContracts}</div>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <div className="text-sm text-gray-500">ค่าปรับรวม</div>
            <div className="text-2xl font-bold text-orange-600">
              {kpis.totalLateFees.toLocaleString()}
            </div>
            <div className="text-xs text-gray-500 mt-1">บาท</div>
          </div>
          <div className="bg-white rounded-lg border p-4 cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/overdue')}>
            <div className="text-sm text-gray-500">ค้างชำระ</div>
            <div className="text-2xl font-bold text-yellow-600">{kpis.overdueContracts}</div>
            <div className="text-xs text-red-600 mt-1">ผิดนัด {kpis.defaultContracts}</div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Monthly Trend */}
        <div className="bg-white rounded-lg border p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">แนวโน้ม 12 เดือน</h3>
          {trend.length > 0 ? (
            <div className="space-y-2">
              {trend.map((t) => (
                <div key={t.month} className="flex items-center gap-3 text-xs">
                  <div className="w-16 text-gray-500 shrink-0">{t.month}</div>
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <div
                        className="h-3 bg-blue-400 rounded-sm"
                        style={{ width: `${(t.newContracts / trendMax) * 100}%`, minWidth: '2px' }}
                      />
                      <span className="text-gray-600">{t.newContracts}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div
                        className="h-3 bg-green-400 rounded-sm"
                        style={{ width: `${(t.paymentsReceived / trendMax) * 100}%`, minWidth: '2px' }}
                      />
                      <span className="text-gray-600">{t.paymentsReceived.toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              ))}
              <div className="flex gap-4 text-xs text-gray-500 mt-3 pt-2 border-t">
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 bg-blue-400 rounded-sm inline-block" /> สัญญาใหม่
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 bg-green-400 rounded-sm inline-block" /> ยอดชำระ (บาท)
                </span>
              </div>
            </div>
          ) : (
            <div className="text-center text-gray-400 py-8">ไม่มีข้อมูล</div>
          )}
        </div>

        {/* Status Distribution */}
        <div className="bg-white rounded-lg border p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">สถานะสัญญา</h3>
          {statusDist.length > 0 ? (
            <div className="space-y-3">
              {statusDist.map((s) => (
                <div key={s.status} className="flex items-center gap-3">
                  <div className="w-24 text-xs text-gray-600">
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
                  <div className="w-12 text-right text-sm font-medium">{s.count}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center text-gray-400 py-8">ไม่มีข้อมูล</div>
          )}
        </div>
      </div>

      {/* Top Overdue */}
      {topOverdue.length > 0 && (
        <div className="bg-white rounded-lg border p-5 mb-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">สัญญาค้างชำระสูงสุด (Top 10)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="pb-2 font-medium">เลขสัญญา</th>
                  <th className="pb-2 font-medium">ลูกค้า</th>
                  <th className="pb-2 font-medium">เบอร์โทร</th>
                  <th className="pb-2 font-medium text-right">ยอดค้าง (บาท)</th>
                  <th className="pb-2 font-medium text-right">เกินกำหนด (วัน)</th>
                </tr>
              </thead>
              <tbody>
                {topOverdue.map((item) => (
                  <tr key={item.contractNumber} className="border-b last:border-0">
                    <td className="py-2 font-medium text-primary-600">{item.contractNumber}</td>
                    <td className="py-2">{item.customerName}</td>
                    <td className="py-2 text-gray-500">{item.phone}</td>
                    <td className="py-2 text-right text-red-600 font-medium">
                      {item.outstandingAmount.toLocaleString()}
                    </td>
                    <td className="py-2 text-right">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${
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
      {user?.role === 'OWNER' && branchData.length > 0 && (
        <div className="bg-white rounded-lg border p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">เปรียบเทียบสาขา</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="pb-2 font-medium">สาขา</th>
                  <th className="pb-2 font-medium text-right">สัญญา</th>
                  <th className="pb-2 font-medium text-right">สินค้า</th>
                  <th className="pb-2 font-medium text-right">พนักงาน</th>
                  <th className="pb-2 font-medium text-right">ค้างชำระ</th>
                  <th className="pb-2 font-medium text-right">ยอดชำระ/เดือน</th>
                </tr>
              </thead>
              <tbody>
                {branchData.map((b) => (
                  <tr key={b.branchName} className="border-b last:border-0">
                    <td className="py-2 font-medium">{b.branchName}</td>
                    <td className="py-2 text-right">{b.contracts}</td>
                    <td className="py-2 text-right">{b.products}</td>
                    <td className="py-2 text-right">{b.users}</td>
                    <td className="py-2 text-right">
                      <span className={b.overdueCount > 0 ? 'text-red-600 font-medium' : ''}>
                        {b.overdueCount}
                      </span>
                    </td>
                    <td className="py-2 text-right text-green-600">
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
