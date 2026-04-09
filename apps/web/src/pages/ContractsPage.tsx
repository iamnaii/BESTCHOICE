import { useMemo, useCallback, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';
import DataTable from '@/components/ui/DataTable';
import WorkflowStatusBadge from '@/components/contract/WorkflowStatusBadge';
import AnimatedCounter from '@/components/ui/animated-counter';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from 'sonner';
import { Download, Plus, LayoutGrid, List, Calendar, DollarSign, User } from 'lucide-react';
import { KanbanBoard, type KanbanColumn } from '@/components/ui/KanbanBoard';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { exportToExcel } from '@/utils/excel.util';
import { formatDateShort, formatDateShortThai } from '@/utils/formatters';
import QueryBoundary from '@/components/QueryBoundary';

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
  ACTIVE: { label: 'ผ่อนอยู่', className: 'bg-success/10 text-success dark:bg-success/15' },
  OVERDUE: { label: 'ค้างชำระ', className: 'bg-warning/10 text-warning dark:bg-warning/15' },
  DEFAULT: { label: 'ผิดนัด', className: 'bg-destructive/10 text-destructive dark:bg-destructive/15' },
  EARLY_PAYOFF: { label: 'ปิดก่อน', className: 'bg-primary/10 text-primary dark:bg-primary/15' },
  COMPLETED: { label: 'ครบ', className: 'bg-success/10 text-success dark:bg-success/15' },
  EXCHANGED: { label: 'เปลี่ยนเครื่อง', className: 'bg-info/10 text-info dark:bg-info/15' },
  CLOSED_BAD_DEBT: { label: 'หนี้สูญ', className: 'bg-destructive/15 text-destructive dark:bg-destructive/20' },
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
type ViewMode = 'table' | 'kanban';

export default function ContractsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('table');

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

  const { data: result, isLoading, isError, error, refetch } = useQuery<PaginatedResponse<Contract>>({
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
        createdAt: formatDateShort(c.createdAt),
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
          <span className="ml-1 text-2xs px-1.5 py-0.5 bg-muted rounded-md">
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
        if (allFour) return <span className="text-xs text-success font-medium">ครบ ({count}/4)</span>;
        if (count > 0) return <span className="text-xs text-amber-600">{count}/4</span>;
        return <span className="text-xs text-muted-foreground">-</span>;
      },
    },
    {
      key: 'status',
      label: 'สถานะ',
      render: (c: Contract) => {
        const s = statusLabels[c.status] || { label: c.status, className: 'bg-muted text-foreground' };
        return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${s.className}`}>{s.label}</span>;
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
      render: (c: Contract) => <span className="text-xs">{formatDateShort(c.createdAt)}</span>,
    },
  ], []);

  /* ─── Kanban columns: group contracts by status ─── */
  const kanbanColumns = useMemo<KanbanColumn<Contract>[]>(() => {
    const groups: { id: string; title: string; color: string; statuses: string[] }[] = [
      { id: 'draft', title: 'ร่าง', color: 'bg-zinc-400', statuses: ['DRAFT'] },
      { id: 'active', title: 'ผ่อนอยู่', color: 'bg-green-500', statuses: ['ACTIVE'] },
      { id: 'overdue', title: 'ค้างชำระ', color: 'bg-yellow-500', statuses: ['OVERDUE'] },
      { id: 'default', title: 'ผิดนัด', color: 'bg-red-500', statuses: ['DEFAULT'] },
      { id: 'completed', title: 'ปิดสัญญา', color: 'bg-blue-500', statuses: ['COMPLETED', 'EARLY_PAYOFF'] },
      { id: 'other', title: 'อื่นๆ', color: 'bg-purple-500', statuses: ['EXCHANGED', 'CLOSED_BAD_DEBT'] },
    ];
    return groups.map((g) => ({
      ...g,
      items: contracts.filter((c) => g.statuses.includes(c.status)),
    })).filter((g) => g.items.length > 0 || ['draft', 'active', 'overdue', 'default'].includes(g.id));
  }, [contracts]);

  return (
    <div>
      <PageHeader
        title="สัญญาผ่อนชำระ"
        subtitle="จัดการสัญญาผ่อนชำระทั้งหมด"
        action={
          <div className="flex gap-2">
            {contracts.length > 0 && (
              <Button variant="outline" size="md" onClick={handleExport}>
                <Download className="size-4" />
                ส่งออก Excel
              </Button>
            )}
            <Button variant="primary" size="md" onClick={() => navigate('/contracts/create')}>
              <Plus className="size-4" />
              สร้างสัญญา
            </Button>
          </div>
        }
      />

      {/* Summary Cards — Metronic KPI style */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 lg:gap-5 mb-6">
          <Card className="hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 overflow-hidden">
            <CardContent className="p-5 relative">
              <div className="absolute inset-y-0 left-0 w-1 bg-primary rounded-l-xl" />
              <div className="pl-2">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">สัญญาทั้งหมด</div>
                <AnimatedCounter value={summary.totalContracts} className="text-2xl font-bold text-foreground" />
              </div>
            </CardContent>
          </Card>
          <Card className="hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 overflow-hidden">
            <CardContent className="p-5 relative">
              <div className="absolute inset-y-0 left-0 w-1 bg-success rounded-l-xl" />
              <div className="pl-2">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">กำลังผ่อน</div>
                <AnimatedCounter value={summary.activeContracts} className="text-2xl font-bold text-success" />
              </div>
            </CardContent>
          </Card>
          <Card className="hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 overflow-hidden">
            <CardContent className="p-5 relative">
              <div className="absolute inset-y-0 left-0 w-1 bg-destructive rounded-l-xl" />
              <div className="pl-2">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ค้างชำระ</div>
                <AnimatedCounter value={summary.overdueContracts} className="text-2xl font-bold text-destructive" />
              </div>
            </CardContent>
          </Card>
          <Card className="hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 overflow-hidden">
            <CardContent className="p-5 relative">
              <div className="absolute inset-y-0 left-0 w-1 bg-primary rounded-l-xl" />
              <div className="pl-2">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">มูลค่าพอร์ตโฟลิโอ</div>
                <AnimatedCounter value={summary.portfolioValue} suffix=" ฿" className="text-2xl font-bold text-primary" />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* View Tabs — Metronic line tabs style */}
      <div className="flex gap-0 mb-5 border-b border-border/60">
        <button
          onClick={() => updateParams({ tab: '', status: '', workflow: '', q: '', page: '' })}
          className={`px-5 py-3 text-sm font-medium border-b-2 -mb-px transition-all ${viewTab === 'all' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          ทั้งหมด
          {result && <span className={`ml-2 text-xs px-1.5 py-0.5 rounded-full ${viewTab === 'all' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>{result.total}</span>}
        </button>
        <button
          onClick={() => updateParams({ tab: 'my', status: '', workflow: '', q: '', page: '' })}
          className={`px-5 py-3 text-sm font-medium border-b-2 -mb-px transition-all ${viewTab === 'my' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          สัญญาของฉัน
        </button>
        {isManager && (
          <button
            onClick={() => updateParams({ tab: 'pending_review', status: '', workflow: '', q: '', page: '' })}
            className={`px-5 py-3 text-sm font-medium border-b-2 -mb-px transition-all ${viewTab === 'pending_review' ? 'border-amber-500 text-amber-600 dark:text-amber-400' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            รอตรวจสอบ
          </button>
        )}
      </div>

      {/* Filters — single clean bar */}
      <div className="bg-card rounded-xl border border-border/50 p-4 mb-5 shadow-sm">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input
              type="text"
              placeholder="ค้นหาเลขสัญญา, ชื่อลูกค้า..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-input rounded-lg text-sm bg-background outline-none focus:ring-2 focus:ring-ring/30"
            />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-2 border border-input rounded-lg text-sm bg-background outline-none focus:ring-2 focus:ring-ring/30">
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
            <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="px-3 py-2 border border-input rounded-lg text-sm bg-background outline-none focus:ring-2 focus:ring-ring/30">
              <option value="">ทุกสาขา</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          )}
          <button
            onClick={() => setShowDatePicker(!showDatePicker)}
            className={`inline-flex items-center gap-2 px-3 py-2 border rounded-lg text-sm transition-colors ${
              startDateFilter || endDateFilter
                ? 'border-primary/40 bg-primary/5 text-primary font-medium'
                : 'border-input hover:bg-accent text-muted-foreground'
            }`}
          >
            <Calendar className="size-4" />
            {startDateFilter || endDateFilter ? 'กำหนดเวลาไว้' : 'ช่วงเวลา'}
          </button>
          {viewTab === 'all' && (
            <select value={workflowFilter} onChange={(e) => setWorkflowFilter(e.target.value)} className="px-3 py-2 border border-input rounded-lg text-sm bg-background outline-none focus:ring-2 focus:ring-ring/30">
              <option value="">ทุก Workflow</option>
              <option value="CREATING">กำลังสร้าง</option>
              <option value="PENDING_REVIEW">รอตรวจสอบ</option>
              <option value="APPROVED">อนุมัติแล้ว</option>
              <option value="REJECTED">ปฏิเสธ</option>
            </select>
          )}
        </div>
      </div>

      {/* Date Range Picker */}
      {showDatePicker && (
        <div className="flex gap-3 mb-4 p-4 bg-muted/60 rounded-xl border border-border/40">
          <div className="flex-1">
            <label className="text-xs text-muted-foreground block mb-1">วันเริ่มต้น</label>
            <ThaiDateInput
              value={startDateFilter}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3 py-2 border border-input rounded-lg text-sm"
            />
          </div>
          <div className="flex-1">
            <label className="text-xs text-muted-foreground block mb-1">วันสิ้นสุด</label>
            <ThaiDateInput
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

      {/* View mode toggle */}
      <div className="flex items-center justify-between mb-4">
        <div />
        <div className="flex gap-1 bg-muted rounded-lg p-1">
          <button
            onClick={() => setViewMode('table')}
            className={`p-2 rounded-md transition-all ${viewMode === 'table' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            aria-label="มุมมองตาราง"
          >
            <List className="size-4" />
          </button>
          <button
            onClick={() => setViewMode('kanban')}
            className={`p-2 rounded-md transition-all ${viewMode === 'kanban' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            aria-label="มุมมอง Kanban"
          >
            <LayoutGrid className="size-4" />
          </button>
        </div>
      </div>

      <QueryBoundary
        isLoading={isLoading && !result}
        isError={isError}
        error={error}
        onRetry={refetch}
        errorTitle="ไม่สามารถโหลดสัญญาได้"
      >
      {/* Table View */}
      {viewMode === 'table' && (
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
      )}

      {/* Kanban View */}
      {viewMode === 'kanban' && !isLoading && (
        <KanbanBoard<Contract>
          columns={kanbanColumns}
          onCardClick={(c) => navigate(`/contracts/${c.id}`)}
          renderCard={(c) => (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-mono text-primary font-medium">{c.contractNumber}</span>
                <span className={`px-1.5 py-0.5 rounded text-2xs font-medium ${(statusLabels[c.status] || { className: 'bg-muted' }).className}`}>
                  {(statusLabels[c.status] || { label: c.status }).label}
                </span>
              </div>
              <div className="text-sm font-medium text-foreground mb-1 flex items-center gap-1.5">
                <User className="size-3 text-muted-foreground" />
                {c.customer.name}
              </div>
              <div className="text-xs text-muted-foreground mb-2">
                {c.product.brand} {c.product.model}
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1 text-muted-foreground">
                  <DollarSign className="size-3" />
                  {parseFloat(c.monthlyPayment).toLocaleString()} ฿ x {c.totalMonths}
                </span>
                <span className="flex items-center gap-1 text-muted-foreground">
                  <Calendar className="size-3" />
                  {formatDateShortThai(c.createdAt)}
                </span>
              </div>
            </div>
          )}
        />
      )}
      </QueryBoundary>
    </div>
  );
}
