import { useMemo, useCallback, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import WorkflowStatusBadge from '@/components/contract/WorkflowStatusBadge';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from 'sonner';

import { exportToExcel } from '@/utils/excel.util';

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
  DRAFT: { label: 'ร่าง', className: 'bg-muted text-foreground' },
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
  summary?: {
    totalContracts: number;
    activeContracts: number;
    overdueContracts: number;
    portfolioValue: number;
  };
}

type ViewTab = 'all' | 'my' | 'pending_review';

export default function ContractsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showDatePicker, setShowDatePicker] = useState(false);

  const search = searchParams.get('q') || '';
  const statusFilter = searchParams.get('status') || '';
  const workflowFilter = searchParams.get('workflow') || '';
  const branchFilter = searchParams.get('branchId') || '';
  const startDateFilter = searchParams.get('startDate') || '';
  const endDateFilter = searchParams.get('endDate') || '';
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
  const setBranchFilter = useCallback((v: string) => updateParams({ branchId: v, page: '' }), [updateParams]);
  const setStartDate = useCallback((v: string) => updateParams({ startDate: v, page: '' }), [updateParams]);
  const setEndDate = useCallback((v: string) => updateParams({ endDate: v, page: '' }), [updateParams]);
  const setViewTab = useCallback((v: ViewTab) => updateParams({ tab: v === 'all' ? '' : v, page: '' }), [updateParams]);
  const setPage = useCallback((p: number) => updateParams({ page: p > 1 ? String(p) : '' }), [updateParams]);

  const debouncedSearch = useDebounce(search);

  const { data: result, isLoading, isError, refetch } = useQuery<PaginatedResponse<Contract>>({
    queryKey: ['contracts', debouncedSearch, statusFilter, workflowFilter, viewTab, page, branchFilter, startDateFilter, endDateFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (statusFilter) params.set('status', statusFilter);
      if (branchFilter) params.set('branchId', branchFilter);
      if (startDateFilter) params.set('startDate', startDateFilter);
      if (endDateFilter) params.set('endDate', endDateFilter);

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
  const summary = result?.summary;

  const isManager = user && ['OWNER', 'BRANCH_MANAGER'].includes(user.role);
  const isOwner = user?.role === 'OWNER';

  // Branches list for filter (OWNER only)
  const { data: branches = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['branches'],
    queryFn: async () => {
      const { data } = await api.get('/branches');
      return data;
    },
    enabled: isOwner,
  });

  // Excel export handler
  const handleExport = async () => {
    await exportToExcel({
      columns: [
        { header: 'เลขสัญญา', key: 'contractNumber', width: 15 },
        { header: 'ลูกค้า', key: 'customer', width: 15 },
        { header: 'เบอร์โทร', key: 'phone', width: 15 },
        { header: 'สินค้า', key: 'product', width: 15 },
        { header: 'ราคาขาย', key: 'sellingPrice', width: 15 },
        { header: 'ค่างวด', key: 'monthlyPayment', width: 15 },
        { header: 'สถานะ', key: 'status', width: 15 },
        { header: 'สาขา', key: 'branch', width: 15 },
        { header: 'พนักงาน', key: 'salesperson', width: 15 },
        { header: 'วันที่สร้าง', key: 'createdAt', width: 15 },
      ],
      data: contracts.map((c) => ({
        contractNumber: c.contractNumber,
        customer: c.customer.name,
        phone: c.customer.phone,
        product: `${c.product.brand} ${c.product.model}`,
        sellingPrice: Number(c.sellingPrice).toLocaleString(),
        monthlyPayment: Number(c.monthlyPayment).toLocaleString(),
        status: statusLabels[c.status]?.label || c.status,
        branch: c.branch.name,
        salesperson: c.salesperson.name,
        createdAt: new Date(c.createdAt).toLocaleDateString('th-TH'),
      })),
      sheetName: 'สัญญา',
      filename: `contracts-${new Date().toISOString().split('T')[0]}.xlsx`,
    });
    toast.success('ส่งออก Excel สำเร็จ');
  };

  const columns = useMemo(() => [
    {
      key: 'contractNumber',
      label: 'เลขสัญญา',
      render: (c: Contract) => (
        <Link to={`/contracts/${c.id}`} className="font-mono text-sm text-primary hover:underline">
          {c.contractNumber}
        </Link>
      ),
    },
    {
      key: 'customer',
      label: 'ลูกค้า',
      render: (c: Contract) => (
        <div>
          <div className="text-sm font-medium">{c.customer.name}</div>
          <div className="text-xs text-muted-foreground">{c.customer.phone}</div>
        </div>
      ),
    },
    {
      key: 'product',
      label: 'สินค้า',
      render: (c: Contract) => (
        <div>
          <span className="text-sm">{c.product.brand} {c.product.model}</span>
          <span className="ml-1 text-2xs px-1 py-0.5 bg-muted rounded">
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
        return <span className="text-xs text-muted-foreground">-</span>;
      },
    },
    {
      key: 'status',
      label: 'สถานะ',
      render: (c: Contract) => {
        const s = statusLabels[c.status] || { label: c.status, className: 'bg-muted' };
        return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.className}`}>{s.label}</span>;
      },
    },
    {
      key: 'monthlyPayment',
      label: 'ค่างวด',
      render: (c: Contract) => (
        <div>
          <span className="text-sm">{parseFloat(c.monthlyPayment).toLocaleString()} ฿ x {c.totalMonths}</span>
          {c.paymentDueDay && <div className="text-2xs text-muted-foreground">วันที่ {c.paymentDueDay}</div>}
        </div>
      ),
    },
    {
      key: 'docs',
      label: 'เอกสาร',
      render: (c: Contract) => (
        <span className="text-xs text-muted-foreground">{c._count.contractDocuments} ไฟล์</span>
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
  ], []);

  return (
    <div>
      <PageHeader
        title="สัญญาผ่อนชำระ"
        subtitle="จัดการสัญญาผ่อนชำระทั้งหมด"
        action={
          <div className="flex gap-2">
            {contracts.length > 0 && (
              <button onClick={handleExport} className="px-4 py-2 border border-input rounded-lg text-sm font-medium hover:bg-muted">
                Export Excel
              </button>
            )}
            <button onClick={() => navigate('/contracts/create')} className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90">
              + สร้างสัญญา
            </button>
          </div>
        }
      />

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground mb-1">สัญญาทั้งหมด</div>
              <div className="text-2xl font-bold">{summary.totalContracts}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground mb-1">สัญญาอยู่</div>
              <div className="text-2xl font-bold text-green-600">{summary.activeContracts}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground mb-1">ค้างชำระ</div>
              <div className="text-2xl font-bold text-red-600">{summary.overdueContracts}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground mb-1">มูลค่าพอร์ตโฟลิโอ</div>
              <div className="text-2xl font-bold text-blue-600">{summary.portfolioValue.toLocaleString()} ฿</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* View Tabs */}
      <div className="flex gap-1 mb-4 border-b">
        <button
          onClick={() => updateParams({ tab: '', status: '', workflow: '', q: '', page: '' })}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${viewTab === 'all' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          ทั้งหมด
        </button>
        <button
          onClick={() => updateParams({ tab: 'my', status: '', workflow: '', q: '', page: '' })}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${viewTab === 'my' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          สัญญาของฉัน
        </button>
        {isManager && (
          <button
            onClick={() => updateParams({ tab: 'pending_review', status: '', workflow: '', q: '', page: '' })}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${viewTab === 'pending_review' ? 'border-amber-600 text-amber-700' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
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
          className="flex-1 min-w-[200px] px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background focus:border-transparent"
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-2 border border-input rounded-lg text-sm">
          <option value="">ทุกสถานะ</option>
          <option value="DRAFT">ร่าง</option>
          <option value="ACTIVE">ผ่อนอยู่</option>
          <option value="OVERDUE">ค้างชำระ</option>
          <option value="DEFAULT">ผิดนัด</option>
          <option value="EARLY_PAYOFF">ปิดก่อน</option>
          <option value="COMPLETED">ครบ</option>
          <option value="EXCHANGED">เปลี่ยนเครื่อง</option>
          <option value="CLOSED_BAD_DEBT">หนี้สูญ</option>
        </select>
        {isOwner && (
          <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="px-3 py-2 border border-input rounded-lg text-sm">
            <option value="">ทุกสาขา</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        )}
        <button
          onClick={() => setShowDatePicker(!showDatePicker)}
          className="px-3 py-2 border border-input rounded-lg text-sm hover:bg-muted"
        >
          {startDateFilter || endDateFilter ? '📅 กำหนดเวลา' : '📅 ช่วงเวลา'}
        </button>
        {viewTab === 'all' && (
          <select value={workflowFilter} onChange={(e) => setWorkflowFilter(e.target.value)} className="px-3 py-2 border border-input rounded-lg text-sm">
            <option value="">ทุก Workflow</option>
            <option value="CREATING">กำลังสร้าง</option>
            <option value="PENDING_REVIEW">รอตรวจสอบ</option>
            <option value="APPROVED">อนุมัติแล้ว</option>
            <option value="REJECTED">ปฏิเสธ</option>
          </select>
        )}
      </div>

      {/* Date Range Picker */}
      {showDatePicker && (
        <div className="flex gap-3 mb-4 p-4 bg-muted rounded-lg">
          <div className="flex-1">
            <label className="text-xs text-muted-foreground block mb-1">วันเริ่มต้น</label>
            <input
              type="date"
              value={startDateFilter}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3 py-2 border border-input rounded-lg text-sm"
            />
          </div>
          <div className="flex-1">
            <label className="text-xs text-muted-foreground block mb-1">วันสิ้นสุด</label>
            <input
              type="date"
              value={endDateFilter}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-2 border border-input rounded-lg text-sm"
            />
          </div>
          {(startDateFilter || endDateFilter) && (
            <div className="flex items-end">
              <button
                onClick={() => { setStartDate(''); setEndDate(''); }}
                className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
              >
                ล้าง
              </button>
            </div>
          )}
        </div>
      )}

      {isError && (
        <div className="text-center py-10 rounded-xl border border-red-200">
          <div className="text-red-500 mb-2">เกิดข้อผิดพลาดในการโหลดข้อมูล</div>
          <button onClick={() => refetch()} className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">ลองใหม่</button>
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
