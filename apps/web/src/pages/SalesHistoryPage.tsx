import { useState, useMemo, useEffect, useRef } from 'react';
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
  downPaymentAmount: string | null;
  financeCompany: string | null;
  financeRefNumber: string | null;
  notes: string | null;
  createdAt: string;
  customer: { id: string; name: string; phone: string };
  product: { id: string; name: string; brand: string; model: string; imeiSerial: string | null; serialNumber: string | null };
  branch: { id: string; name: string };
  salesperson: { id: string; name: string };
  contract: { id: string; contractNumber: string; status: string; monthlyPayment: string; totalMonths: number } | null;
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
  INSTALLMENT: { label: 'ผ่อนร้าน', className: 'bg-primary-100 text-primary-700' },
  EXTERNAL_FINANCE: { label: 'ไฟแนนซ์', className: 'bg-primary-100 text-primary-700' },
};

const paymentMethodLabels: Record<string, string> = {
  CASH: 'เงินสด',
  BANK_TRANSFER: 'โอนเงิน',
  QR_EWALLET: 'QR/E-Wallet',
};

export default function SalesHistoryPage() {
  const navigate = useNavigate();
  const [saleTypeFilter, setSaleTypeFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    debounceRef.current = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 400);
    return () => clearTimeout(debounceRef.current);
  }, [searchInput]);
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
      key: 'index',
      label: '#',
      render: (_s: Sale, _col: unknown, idx?: number) => (
        <span className="text-xs text-gray-400">{((salesData?.page ?? 1) - 1) * limit + (idx ?? 0) + 1}</span>
      ),
    },
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
          {(s.product.imeiSerial || s.product.serialNumber) && (
            <div className="text-xs text-gray-400 font-mono">{s.product.imeiSerial || s.product.serialNumber}</div>
          )}
        </div>
      ),
    },
    {
      key: 'customer',
      label: 'ลูกค้า',
      render: (s: Sale) => (
        <button onClick={(e) => { e.stopPropagation(); navigate(`/customers/${s.customer.id}`); }} className="text-left hover:underline">
          <div className="text-sm text-primary-600">{s.customer.name}</div>
          <div className="text-xs text-gray-400">{s.customer.phone}</div>
        </button>
      ),
    },
    {
      key: 'netAmount',
      label: 'ยอดสุทธิ',
      render: (s: Sale) => (
        <div>
          <div className="text-sm font-medium">{Number(s.netAmount).toLocaleString()} ฿</div>
          {Number(s.discount) > 0 && (
            <div className="text-xs text-red-500">ลด {Number(s.discount).toLocaleString()} ฿</div>
          )}
        </div>
      ),
    },
    {
      key: 'payment',
      label: 'การชำระ',
      render: (s: Sale) => (
        <div className="text-xs">
          <div>{paymentMethodLabels[s.paymentMethod] || s.paymentMethod || '-'}</div>
          {s.saleType === 'INSTALLMENT' && s.contract && (
            <div className="text-primary-600">
              ดาวน์ {Number(s.downPaymentAmount || 0).toLocaleString()} ฿
              <br />ผ่อน {Number(s.contract.monthlyPayment).toLocaleString()} x {s.contract.totalMonths} งวด
            </div>
          )}
          {s.saleType === 'EXTERNAL_FINANCE' && s.financeCompany && (
            <div className="text-primary-600">
              {s.financeCompany}
              {s.downPaymentAmount && Number(s.downPaymentAmount) > 0 && (
                <span> / ดาวน์ {Number(s.downPaymentAmount).toLocaleString()} ฿</span>
              )}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'contract',
      label: 'สัญญา',
      render: (s: Sale) => {
        if (!s.contract) return <span className="text-xs text-gray-400">-</span>;
        const statusMap: Record<string, { label: string; cls: string }> = {
          DRAFT: { label: 'ร่าง', cls: 'text-gray-500' },
          ACTIVE: { label: 'ใช้งาน', cls: 'text-green-600' },
          OVERDUE: { label: 'ค้างชำระ', cls: 'text-red-600' },
          DEFAULT: { label: 'ผิดนัด', cls: 'text-red-700 font-semibold' },
          COMPLETED: { label: 'ปิดแล้ว', cls: 'text-gray-500' },
        };
        const cs = statusMap[s.contract.status] || { label: s.contract.status, cls: 'text-gray-500' };
        return (
          <div className="text-xs">
            <div className="font-mono text-primary-600">{s.contract.contractNumber}</div>
            <div className={cs.cls}>{cs.label}</div>
          </div>
        );
      },
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
  ], [navigate, salesData?.page, limit]);

  // Summary stats
  const stats = useMemo(() => {
    if (!salesData?.data) return null;
    const sales = salesData.data;
    const totalRevenue = sales.reduce((sum, s) => sum + Number(s.netAmount), 0);
    const cashSales = sales.filter(s => s.saleType === 'CASH');
    const installmentSales = sales.filter(s => s.saleType === 'INSTALLMENT');
    const financeSales = sales.filter(s => s.saleType === 'EXTERNAL_FINANCE');
    return {
      totalRevenue,
      cashCount: cashSales.length,
      cashRevenue: cashSales.reduce((sum, s) => sum + Number(s.netAmount), 0),
      installmentCount: installmentSales.length,
      installmentRevenue: installmentSales.reduce((sum, s) => sum + Number(s.netAmount), 0),
      financeCount: financeSales.length,
      financeRevenue: financeSales.reduce((sum, s) => sum + Number(s.netAmount), 0),
      totalDiscount: sales.reduce((sum, s) => sum + Number(s.discount), 0),
    };
  }, [salesData]);

  return (
    <div>
      <PageHeader title="ประวัติการขาย" subtitle="ดูรายการขายทั้งหมด" />

      {/* Summary Cards */}
      {stats && salesData && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg border p-4">
            <div className="text-xs text-gray-500 mb-1">ทั้งหมด {salesData.total.toLocaleString()} รายการ (หน้านี้ {salesData.data.length})</div>
            <div className="text-xl font-bold">{stats.totalRevenue.toLocaleString()} <span className="text-sm font-normal text-gray-400">฿ (หน้านี้)</span></div>
            {stats.totalDiscount > 0 && <div className="text-xs text-red-500">ส่วนลดรวม {stats.totalDiscount.toLocaleString()} ฿</div>}
          </div>
          <div className="bg-white rounded-lg border p-4">
            <div className="text-xs text-gray-500 mb-1">เงินสด (หน้านี้)</div>
            <div className="text-xl font-bold text-green-600">{stats.cashCount}</div>
            <div className="text-sm text-green-600 mt-1">{stats.cashRevenue.toLocaleString()} ฿</div>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <div className="text-xs text-gray-500 mb-1">ผ่อนร้าน (หน้านี้)</div>
            <div className="text-xl font-bold text-primary-600">{stats.installmentCount}</div>
            <div className="text-sm text-primary-600 mt-1">{stats.installmentRevenue.toLocaleString()} ฿</div>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <div className="text-xs text-gray-500 mb-1">ไฟแนนซ์ (หน้านี้)</div>
            <div className="text-xl font-bold text-primary-600">{stats.financeCount}</div>
            <div className="text-sm text-primary-600 mt-1">{stats.financeRevenue.toLocaleString()} ฿</div>
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
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
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
        onRowClick={(sale) => navigate(`/sales/${sale.id}`)}
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
