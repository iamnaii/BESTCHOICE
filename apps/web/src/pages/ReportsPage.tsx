import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';

type ReportType = 'aging' | 'revenue' | 'high-risk' | 'sales' | 'branch' | 'daily-payment' | 'stock';

const reportTabs: { key: ReportType; label: string }[] = [
  { key: 'aging', label: 'อายุหนี้' },
  { key: 'revenue', label: 'รายได้ / กำไร-ขาดทุน' },
  { key: 'high-risk', label: 'ลูกค้าเสี่ยงสูง' },
  { key: 'sales', label: 'เปรียบเทียบพนักงาน' },
  { key: 'branch', label: 'เปรียบเทียบสาขา' },
  { key: 'daily-payment', label: 'ชำระรายวัน' },
  { key: 'stock', label: 'สต็อกสินค้า' },
];

export default function ReportsPage() {
  const [activeTab, setActiveTab] = useState<ReportType>('aging');
  const [dateFilter, setDateFilter] = useState(new Date().toISOString().slice(0, 10));

  return (
    <div>
      <PageHeader title="รายงาน" subtitle="รายงานสรุปข้อมูลต่างๆ" />

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 mb-6 bg-gray-100 rounded-lg p-1">
        {reportTabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-2 text-xs font-medium rounded-md transition-colors ${
              activeTab === tab.key
                ? 'bg-white text-primary-700 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
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
    </div>
  );
}

function AgingReport() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['report-aging'],
    queryFn: async () => (await api.get('/reports/aging')).data,
  });

  if (isLoading) return <LoadingState />;
  if (isError) return <ErrorState onRetry={() => refetch()} />;

  const buckets = data?.buckets || [];
  const total = data?.total || { count: 0, amount: 0 };

  return (
    <div className="bg-white rounded-lg border p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">รายงานอายุหนี้ (Aging Report)</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-gray-500">
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
                <td className="py-2 text-right text-red-600">{b.amount.toLocaleString()}</td>
                <td className="py-2 text-right text-gray-500">
                  {total.amount > 0 ? ((b.amount / total.amount) * 100).toFixed(1) : 0}%
                </td>
              </tr>
            ))}
            <tr className="font-semibold bg-gray-50">
              <td className="py-2">รวม</td>
              <td className="py-2 text-right">{total.count}</td>
              <td className="py-2 text-right text-red-600">{total.amount.toLocaleString()}</td>
              <td className="py-2 text-right">100%</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RevenueReport() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['report-revenue'],
    queryFn: async () => (await api.get('/reports/revenue-pl')).data,
  });
  if (isError) return <ErrorState onRetry={() => refetch()} />;

  if (isLoading) return <LoadingState />;

  return (
    <div className="bg-white rounded-lg border p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">รายงานรายได้ / กำไร-ขาดทุน</h3>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard label="รายได้ดอกเบี้ย" value={data?.interestIncome || 0} color="text-green-600" />
        <SummaryCard label="ค่าปรับ" value={data?.lateFeeIncome || 0} color="text-orange-600" />
        <SummaryCard label="ยอดชำระรับ" value={data?.paymentsReceived || 0} color="text-blue-600" />
        <SummaryCard label="ยอดค้างชำระ" value={data?.outstandingTotal || 0} color="text-red-600" />
      </div>
    </div>
  );
}

function HighRiskReport() {
  const { data = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['report-high-risk'],
    queryFn: async () => (await api.get('/reports/high-risk')).data,
  });
  if (isError) return <ErrorState onRetry={() => refetch()} />;

  if (isLoading) return <LoadingState />;

  return (
    <div className="bg-white rounded-lg border p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">ลูกค้าเสี่ยงสูง</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-gray-500">
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
                <td className="py-2 text-gray-500">{c.phone}</td>
                <td className="py-2 text-right">{c.overdueContracts}</td>
                <td className="py-2 text-right text-red-600 font-medium">
                  {c.totalOutstanding.toLocaleString()}
                </td>
              </tr>
            ))}
            {data.length === 0 && (
              <tr>
                <td colSpan={4} className="py-8 text-center text-gray-400">ไม่พบข้อมูล</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SalesReport() {
  const { data = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['report-sales'],
    queryFn: async () => (await api.get('/reports/sales-comparison')).data,
  });
  if (isError) return <ErrorState onRetry={() => refetch()} />;

  if (isLoading) return <LoadingState />;

  return (
    <div className="bg-white rounded-lg border p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">เปรียบเทียบพนักงานขาย</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-gray-500">
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
                <td className="py-2 text-right">{s.totalSales.toLocaleString()}</td>
                <td className="py-2 text-right">
                  <span className={s.overdueContracts > 0 ? 'text-red-600 font-medium' : ''}>
                    {s.overdueContracts}
                  </span>
                </td>
                <td className="py-2 text-right">
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      s.overdueRate > 20
                        ? 'bg-red-100 text-red-700'
                        : s.overdueRate > 10
                          ? 'bg-yellow-100 text-yellow-700'
                          : 'bg-green-100 text-green-700'
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
  );
}

function BranchReport() {
  const { data = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['report-branch'],
    queryFn: async () => (await api.get('/reports/branch-comparison')).data,
  });
  if (isError) return <ErrorState onRetry={() => refetch()} />;

  if (isLoading) return <LoadingState />;

  return (
    <div className="bg-white rounded-lg border p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">เปรียบเทียบสาขา</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-gray-500">
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
                <td className="py-2 text-right">{b.totalSales.toLocaleString()}</td>
                <td className="py-2 text-right text-red-600">{b.overdueContracts}</td>
                <td className="py-2 text-right text-green-600">{b.paymentsReceived.toLocaleString()}</td>
                <td className="py-2 text-right">{b.stockCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DailyPaymentReport({ date, onDateChange }: { date: string; onDateChange: (d: string) => void }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['report-daily-payment', date],
    queryFn: async () => (await api.get(`/reports/daily-payments?date=${date}`)).data,
  });
  if (isError) return <ErrorState onRetry={() => refetch()} />;

  if (isLoading) return <LoadingState />;

  return (
    <div className="bg-white rounded-lg border p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-700">สรุปชำระรายวัน</h3>
        <input
          type="date"
          value={date}
          onChange={(e) => onDateChange(e.target.value)}
          className="px-3 py-1.5 border rounded-lg text-sm"
        />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <SummaryCard label="รายการชำระ" value={data?.totalCount || 0} isCurrency={false} />
        <SummaryCard label="ยอดรวม" value={data?.totalAmount || 0} color="text-green-600" />
        <SummaryCard label="เงินสด" value={data?.byMethod?.CASH || 0} color="text-blue-600" />
        <SummaryCard label="โอน" value={data?.byMethod?.TRANSFER || 0} color="text-purple-600" />
      </div>
      {data?.byBranch && data.byBranch.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500">
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
                  <td className="py-2 text-right text-green-600">{b.amount.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StockReport() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['report-stock'],
    queryFn: async () => (await api.get('/reports/stock')).data,
  });

  if (isLoading) return <LoadingState />;
  if (isError) return <ErrorState onRetry={() => refetch()} />;

  const byStatus = data?.byStatus || [];
  const byBranch = data?.byBranch || [];

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg border p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">สต็อกตามสถานะ</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          <SummaryCard label="ทั้งหมด" value={data?.totalCount || 0} isCurrency={false} />
          <SummaryCard label="มูลค่ารวม" value={data?.totalValue || 0} color="text-blue-600" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500">
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
                  <td className="py-2 text-right">{s.value.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {byBranch.length > 0 && (
        <div className="bg-white rounded-lg border p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">สต็อกตามสาขา</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
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
                    <td className="py-2 text-right">{b.value.toLocaleString()}</td>
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

function SummaryCard({
  label,
  value,
  color = 'text-gray-900',
  isCurrency = true,
}: {
  label: string;
  value: number;
  color?: string;
  isCurrency?: boolean;
}) {
  return (
    <div className="bg-gray-50 rounded-lg p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-lg font-bold ${color}`}>
        {isCurrency ? value.toLocaleString() : value}
      </div>
      {isCurrency && <div className="text-xs text-gray-400">บาท</div>}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="bg-white rounded-lg border p-8 text-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-3" />
      <div className="text-sm text-gray-500">กำลังโหลดข้อมูล...</div>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="bg-white rounded-lg border p-8 text-center">
      <div className="text-red-500 text-lg mb-2">!</div>
      <div className="text-sm text-gray-600 mb-3">ไม่สามารถโหลดข้อมูลรายงานได้</div>
      <button onClick={onRetry} className="px-4 py-2 bg-red-50 text-red-600 rounded-lg text-sm hover:bg-red-100">
        ลองใหม่
      </button>
    </div>
  );
}
