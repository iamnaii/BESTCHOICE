import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';

interface Sale {
  id: string;
  saleNumber: string;
  saleType: string;
  sellingPrice: string;
  discount: string;
  netAmount: string;
  paymentMethod: string;
  amountReceived: string;
  financeCompany: string | null;
  notes: string | null;
  createdAt: string;
  customer: { id: string; name: string; phone: string };
  product: { id: string; name: string; brand: string; model: string; imeiSerial: string | null };
  branch: { id: string; name: string };
  salesperson: { id: string; name: string };
}

interface SalesResponse {
  data: Sale[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const saleTypeLabels: Record<string, { label: string; className: string }> = {
  CASH: { label: 'เงินสด', className: 'bg-green-100 text-green-700' },
  INSTALLMENT: { label: 'ผ่อนร้าน', className: 'bg-blue-100 text-blue-700' },
  EXTERNAL_FINANCE: { label: 'ไฟแนนซ์', className: 'bg-purple-100 text-purple-700' },
};

const paymentMethodLabels: Record<string, string> = {
  CASH: 'เงินสด',
  BANK_TRANSFER: 'โอนเงิน',
  QR_EWALLET: 'QR/E-Wallet',
};

export default function SalesHistoryPage() {
  const navigate = useNavigate();
  const [saleTypeFilter, setSaleTypeFilter] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const limit = 20;

  const { data: salesData, isLoading } = useQuery<SalesResponse>({
    queryKey: ['sales-history', saleTypeFilter, search, page],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (saleTypeFilter) params.set('saleType', saleTypeFilter);
      if (search) params.set('search', search);
      params.set('page', String(page));
      params.set('limit', String(limit));
      const { data } = await api.get(`/sales?${params}`);
      return data;
    },
  });

  const columns = useMemo(() => [
    {
      key: 'saleNumber',
      label: 'เลขที่',
      render: (s: Sale) => (
        <span className="font-mono text-sm text-primary-600 font-medium">{s.saleNumber}</span>
      ),
    },
    {
      key: 'createdAt',
      label: 'วันที่',
      render: (s: Sale) => (
        <div>
          <div className="text-sm">{new Date(s.createdAt).toLocaleDateString('th-TH')}</div>
          <div className="text-xs text-gray-400">{new Date(s.createdAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}</div>
        </div>
      ),
    },
    {
      key: 'saleType',
      label: 'ประเภท',
      render: (s: Sale) => {
        const st = saleTypeLabels[s.saleType] || { label: s.saleType, className: 'bg-gray-100 text-gray-700' };
        return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${st.className}`}>{st.label}</span>;
      },
    },
    {
      key: 'product',
      label: 'สินค้า',
      render: (s: Sale) => (
        <div>
          <div className="text-sm font-medium">{s.product.brand} {s.product.model}</div>
          {s.product.imeiSerial && <div className="text-xs text-gray-400 font-mono">{s.product.imeiSerial}</div>}
        </div>
      ),
    },
    {
      key: 'customer',
      label: 'ลูกค้า',
      render: (s: Sale) => (
        <div>
          <div className="text-sm">{s.customer.name}</div>
          <div className="text-xs text-gray-400">{s.customer.phone}</div>
        </div>
      ),
    },
    {
      key: 'netAmount',
      label: 'ยอดสุทธิ',
      render: (s: Sale) => (
        <span className="text-sm font-medium">{Number(s.netAmount).toLocaleString()} ฿</span>
      ),
    },
    {
      key: 'paymentMethod',
      label: 'วิธีชำระ',
      render: (s: Sale) => (
        <div>
          <div className="text-xs">{paymentMethodLabels[s.paymentMethod] || s.paymentMethod}</div>
          {s.financeCompany && <div className="text-xs text-purple-600">{s.financeCompany}</div>}
        </div>
      ),
    },
    {
      key: 'salesperson',
      label: 'พนักงาน',
      render: (s: Sale) => <span className="text-xs">{s.salesperson.name}</span>,
    },
    {
      key: 'branch',
      label: 'สาขา',
      render: (s: Sale) => <span className="text-xs">{s.branch.name}</span>,
    },
  ], []);

  // Summary stats
  const stats = useMemo(() => {
    if (!salesData?.data) return null;
    const sales = salesData.data;
    const totalRevenue = sales.reduce((sum, s) => sum + Number(s.netAmount), 0);
    const cashCount = sales.filter(s => s.saleType === 'CASH').length;
    const installmentCount = sales.filter(s => s.saleType === 'INSTALLMENT').length;
    const financeCount = sales.filter(s => s.saleType === 'EXTERNAL_FINANCE').length;
    return { totalRevenue, cashCount, installmentCount, financeCount };
  }, [salesData]);

  return (
    <div>
      <PageHeader title="ประวัติการขาย" subtitle="ดูรายการขายทั้งหมด" />

      {/* Summary Cards */}
      {stats && salesData && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg border p-4">
            <div className="text-xs text-gray-500 mb-1">ทั้งหมด</div>
            <div className="text-xl font-bold">{salesData.total.toLocaleString()} <span className="text-sm font-normal text-gray-400">รายการ</span></div>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <div className="text-xs text-gray-500 mb-1">เงินสด</div>
            <div className="text-xl font-bold text-green-600">{stats.cashCount}</div>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <div className="text-xs text-gray-500 mb-1">ผ่อนร้าน</div>
            <div className="text-xl font-bold text-blue-600">{stats.installmentCount}</div>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <div className="text-xs text-gray-500 mb-1">ไฟแนนซ์</div>
            <div className="text-xl font-bold text-purple-600">{stats.financeCount}</div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <select
          value={saleTypeFilter}
          onChange={(e) => { setSaleTypeFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
        >
          <option value="">ทุกประเภท</option>
          <option value="CASH">เงินสด</option>
          <option value="INSTALLMENT">ผ่อนร้าน</option>
          <option value="EXTERNAL_FINANCE">ไฟแนนซ์</option>
        </select>
        <input
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="ค้นหาเลขที่ขาย, ชื่อลูกค้า, ชื่อสินค้า..."
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm w-72"
        />
      </div>

      {/* Sales Table */}
      <DataTable
        columns={columns}
        data={salesData?.data || []}
        isLoading={isLoading}
        emptyMessage="ยังไม่มีรายการขาย"
        onRowClick={(sale) => navigate(`/products/${sale.product.id}`)}
        pagination={salesData ? {
          page: salesData.page,
          totalPages: salesData.totalPages,
          total: salesData.total,
          onPageChange: setPage,
        } : undefined}
      />
    </div>
  );
}
