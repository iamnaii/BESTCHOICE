import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';

interface Contract {
  id: string;
  contractNumber: string;
  status: string;
  sellingPrice: string;
  downPayment: string;
  monthlyPayment: string;
  totalMonths: number;
  createdAt: string;
  customer: { id: string; name: string; phone: string };
  product: { id: string; name: string; brand: string; model: string };
  branch: { id: string; name: string };
  salesperson: { id: string; name: string };
  _count: { payments: number };
}

const statusLabels: Record<string, { label: string; className: string }> = {
  DRAFT: { label: 'ร่าง', className: 'bg-gray-100 text-gray-700' },
  ACTIVE: { label: 'ผ่อนอยู่', className: 'bg-green-100 text-green-700' },
  OVERDUE: { label: 'ค้างชำระ', className: 'bg-yellow-100 text-yellow-700' },
  DEFAULT: { label: 'ผิดนัด', className: 'bg-red-100 text-red-700' },
  EARLY_PAYOFF: { label: 'ปิดก่อน', className: 'bg-blue-100 text-blue-700' },
  COMPLETED: { label: 'ครบ', className: 'bg-teal-100 text-teal-700' },
  EXCHANGED: { label: 'เปลี่ยนเครื่อง', className: 'bg-purple-100 text-purple-700' },
  CLOSED_BAD_DEBT: { label: 'หนี้สูญ', className: 'bg-red-200 text-red-800' },
};

interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  totalPages: number;
}

export default function ContractsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounce(search);

  useEffect(() => { setPage(1); }, [debouncedSearch, statusFilter]);

  const { data: result, isLoading } = useQuery<PaginatedResponse<Contract>>({
    queryKey: ['contracts', debouncedSearch, statusFilter, page],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (statusFilter) params.set('status', statusFilter);
      params.set('page', String(page));
      const { data } = await api.get(`/contracts?${params}`);
      return data;
    },
  });

  const contracts = result?.data ?? [];

  const columns = [
    {
      key: 'contractNumber',
      label: 'เลขสัญญา',
      render: (c: Contract) => (
        <button onClick={() => navigate(`/contracts/${c.id}`)} className="font-mono text-sm text-primary-600 hover:underline">
          {c.contractNumber}
        </button>
      ),
    },
    {
      key: 'customer',
      label: 'ลูกค้า',
      render: (c: Contract) => (
        <div>
          <div className="text-sm font-medium">{c.customer.name}</div>
          <div className="text-xs text-gray-500">{c.customer.phone}</div>
        </div>
      ),
    },
    {
      key: 'product',
      label: 'สินค้า',
      render: (c: Contract) => (
        <span className="text-sm">{c.product.brand} {c.product.model}</span>
      ),
    },
    {
      key: 'status',
      label: 'สถานะ',
      render: (c: Contract) => {
        const s = statusLabels[c.status] || { label: c.status, className: 'bg-gray-100' };
        return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.className}`}>{s.label}</span>;
      },
    },
    {
      key: 'monthlyPayment',
      label: 'ค่างวด',
      render: (c: Contract) => (
        <span className="text-sm">{parseFloat(c.monthlyPayment).toLocaleString()} ฿ × {c.totalMonths}</span>
      ),
    },
    {
      key: 'branch',
      label: 'สาขา',
      render: (c: Contract) => <span className="text-xs">{c.branch.name}</span>,
    },
    {
      key: 'createdAt',
      label: 'วันที่สร้าง',
      render: (c: Contract) => <span className="text-xs">{new Date(c.createdAt).toLocaleDateString('th-TH')}</span>,
    },
  ];

  return (
    <div>
      <PageHeader
        title="สัญญาผ่อนชำระ"
        subtitle="จัดการสัญญาผ่อนชำระทั้งหมด"
        action={
          <button onClick={() => navigate('/contracts/create')} className="px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700">
            + สร้างสัญญา
          </button>
        }
      />

      <div className="flex gap-3 mb-4">
        <input
          type="text"
          placeholder="ค้นหาเลขสัญญา, ชื่อลูกค้า..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
          <option value="">ทุกสถานะ</option>
          <option value="DRAFT">ร่าง</option>
          <option value="ACTIVE">ผ่อนอยู่</option>
          <option value="OVERDUE">ค้างชำระ</option>
          <option value="DEFAULT">ผิดนัด</option>
          <option value="EARLY_PAYOFF">ปิดก่อน</option>
          <option value="COMPLETED">ครบ</option>
        </select>
      </div>

      <DataTable
        columns={columns}
        data={contracts}
        isLoading={isLoading}
        emptyMessage="ยังไม่มีสัญญา"
        pagination={result ? {
          page: result.page,
          totalPages: result.totalPages,
          total: result.total,
          onPageChange: setPage,
        } : undefined}
      />
    </div>
  );
}
