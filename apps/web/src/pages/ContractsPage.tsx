import { useMemo, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import WorkflowStatusBadge from '@/components/contract/WorkflowStatusBadge';

interface Contract {
  id: string;
  contractNumber: string;
  status: string;
  workflowStatus: string;
  sellingPrice: string;
  downPayment: string;
  monthlyPayment: string;
  totalMonths: number;
  paymentDueDay: number | null;
  createdAt: string;
  customer: { id: string; name: string; phone: string };
  product: { id: string; name: string; brand: string; model: string; category: string };
  branch: { id: string; name: string };
  salesperson: { id: string; name: string };
  reviewedBy: { id: string; name: string } | null;
  signatures: { signerType: string }[];
  _count: { payments: number; contractDocuments: number };
}

const statusLabels: Record<string, { label: string; className: string }> = {
  DRAFT: { label: 'ร่าง', className: 'bg-gray-100 text-gray-700' },
  ACTIVE: { label: 'ผ่อนอยู่', className: 'bg-green-100 text-green-700' },
  OVERDUE: { label: 'ค้างชำระ', className: 'bg-yellow-100 text-yellow-700' },
  DEFAULT: { label: 'ผิดนัด', className: 'bg-red-100 text-red-700' },
  EARLY_PAYOFF: { label: 'ปิดก่อน', className: 'bg-primary-100 text-primary-700' },
  COMPLETED: { label: 'ครบ', className: 'bg-teal-100 text-teal-700' },
  EXCHANGED: { label: 'เปลี่ยนเครื่อง', className: 'bg-primary-100 text-primary-700' },
  CLOSED_BAD_DEBT: { label: 'หนี้สูญ', className: 'bg-red-200 text-red-800' },
};

interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  totalPages: number;
}

type ViewTab = 'all' | 'my' | 'pending_review';

export default function ContractsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const search = searchParams.get('q') || '';
  const statusFilter = searchParams.get('status') || '';
  const workflowFilter = searchParams.get('workflow') || '';
  const viewTab = (searchParams.get('tab') || 'all') as ViewTab;
  const page = parseInt(searchParams.get('page') || '1', 10);

  const updateParams = useCallback((updates: Record<string, string>) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(updates)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const setSearch = useCallback((v: string) => updateParams({ q: v, page: '' }), [updateParams]);
  const setStatusFilter = useCallback((v: string) => updateParams({ status: v, page: '' }), [updateParams]);
  const setWorkflowFilter = useCallback((v: string) => updateParams({ workflow: v, page: '' }), [updateParams]);
  const setViewTab = useCallback((v: ViewTab) => updateParams({ tab: v === 'all' ? '' : v, page: '' }), [updateParams]);
  const setPage = useCallback((p: number) => updateParams({ page: p > 1 ? String(p) : '' }), [updateParams]);

  const debouncedSearch = useDebounce(search);

  const { data: result, isLoading, isError, refetch } = useQuery<PaginatedResponse<Contract>>({
    queryKey: ['contracts', debouncedSearch, statusFilter, workflowFilter, viewTab, page],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (statusFilter) params.set('status', statusFilter);

      // View tab logic
      if (viewTab === 'my' && user) {
        params.set('salespersonId', user.id);
      } else if (viewTab === 'pending_review') {
        params.set('workflowStatus', 'PENDING_REVIEW');
      } else if (workflowFilter) {
        params.set('workflowStatus', workflowFilter);
      }

      params.set('page', String(page));
      const { data } = await api.get(`/contracts?${params}`);
      return data;
    },
  });

  const contracts = result?.data ?? [];

  const navigateToContract = useCallback((id: string) => navigate(`/contracts/${id}`), [navigate]);

  const isManager = user && ['OWNER', 'BRANCH_MANAGER'].includes(user.role);

  const columns = useMemo(() => [
    {
      key: 'contractNumber',
      label: 'เลขสัญญา',
      render: (c: Contract) => (
        <button onClick={() => navigateToContract(c.id)} className="font-mono text-sm text-primary-600 hover:underline">
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
        <div>
          <span className="text-sm">{c.product.brand} {c.product.model}</span>
          <span className="ml-1 text-[10px] px-1 py-0.5 bg-gray-100 rounded">
            {c.product.category === 'PHONE_NEW' ? 'มือ1' : c.product.category === 'PHONE_USED' ? 'มือ2' : c.product.category}
          </span>
        </div>
      ),
    },
    {
      key: 'workflowStatus',
      label: 'Workflow',
      render: (c: Contract) => <WorkflowStatusBadge status={c.workflowStatus} />,
    },
    {
      key: 'signatures',
      label: 'ลงนาม',
      render: (c: Contract) => {
        const hasCust = c.signatures?.some(s => s.signerType === 'CUSTOMER');
        const hasCompany = c.signatures?.some(s => s.signerType === 'COMPANY' || s.signerType === 'STAFF');
        const hasW1 = c.signatures?.some(s => s.signerType === 'WITNESS_1');
        const hasW2 = c.signatures?.some(s => s.signerType === 'WITNESS_2');
        const allFour = hasCust && hasCompany && hasW1 && hasW2;
        const count = [hasCust, hasCompany, hasW1, hasW2].filter(Boolean).length;
        if (allFour) return <span className="text-xs text-green-600 font-medium">ครบ ({count}/4)</span>;
        if (count > 0) return <span className="text-xs text-amber-600">{count}/4</span>;
        return <span className="text-xs text-gray-400">-</span>;
      },
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
        <div>
          <span className="text-sm">{parseFloat(c.monthlyPayment).toLocaleString()} ฿ x {c.totalMonths}</span>
          {c.paymentDueDay && <div className="text-[10px] text-gray-400">วันที่ {c.paymentDueDay}</div>}
        </div>
      ),
    },
    {
      key: 'docs',
      label: 'เอกสาร',
      render: (c: Contract) => (
        <span className="text-xs text-gray-500">{c._count.contractDocuments} ไฟล์</span>
      ),
    },
    {
      key: 'salesperson',
      label: 'พนักงาน',
      render: (c: Contract) => <span className="text-xs">{c.salesperson.name}</span>,
    },
    {
      key: 'createdAt',
      label: 'วันที่สร้าง',
      render: (c: Contract) => <span className="text-xs">{new Date(c.createdAt).toLocaleDateString('th-TH')}</span>,
    },
  ], [navigateToContract]);

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

      {/* View Tabs */}
      <div className="flex gap-1 mb-4 border-b">
        <button
          onClick={() => updateParams({ tab: '', status: '', workflow: '', q: '', page: '' })}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${viewTab === 'all' ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          ทั้งหมด
        </button>
        <button
          onClick={() => updateParams({ tab: 'my', status: '', workflow: '', q: '', page: '' })}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${viewTab === 'my' ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          สัญญาของฉัน
        </button>
        {isManager && (
          <button
            onClick={() => updateParams({ tab: 'pending_review', status: '', workflow: '', q: '', page: '' })}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${viewTab === 'pending_review' ? 'border-amber-600 text-amber-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            รอตรวจสอบ
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <input
          type="text"
          placeholder="ค้นหาเลขสัญญา, ชื่อลูกค้า..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
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
        {viewTab === 'all' && (
          <select value={workflowFilter} onChange={(e) => setWorkflowFilter(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="">ทุก Workflow</option>
            <option value="CREATING">กำลังสร้าง</option>
            <option value="PENDING_REVIEW">รอตรวจสอบ</option>
            <option value="APPROVED">อนุมัติแล้ว</option>
            <option value="REJECTED">ปฏิเสธ</option>
          </select>
        )}
      </div>

      {isError && (
        <div className="text-center py-10 bg-white rounded-xl border border-red-200">
          <div className="text-red-500 mb-2">เกิดข้อผิดพลาดในการโหลดข้อมูล</div>
          <button onClick={() => refetch()} className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700">ลองใหม่</button>
        </div>
      )}

      {!isError && <DataTable
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
      />}
    </div>
  );
}
