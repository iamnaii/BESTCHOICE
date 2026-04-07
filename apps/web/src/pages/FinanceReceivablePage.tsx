import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Banknote, Clock, AlertTriangle, CheckCircle2, Ban, Pencil, MoreVertical, Receipt, Percent, Wallet } from 'lucide-react';
import AnimatedCounter from '@/components/ui/animated-counter';
import { Button } from '@/components/ui/button';
import { formatDateShortThai, formatDateShort } from '@/utils/formatters';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

interface FinanceReceivable {
  id: string; financeCompany: string; financeRefNumber: string | null;
  expectedAmount: string; commissionRate: string | null; commissionAmount: string | null;
  netExpectedAmount: string; receivedAmount: string | null; receivedDate: string | null;
  bankRef: string | null; expectedDate: string; status: string; note: string | null;
  createdAt: string;
  sale: {
    id: string; saleNumber: string; sellingPrice: string; netAmount: string;
    financeAmount: string | null; downPaymentAmount: string | null; createdAt: string;
    customer: { id: string; name: string; phone: string | null };
    product: { id: string; name: string; brand: string | null };
    salesperson: { id: string; name: string };
  };
  branch: { id: string; name: string };
  recordedBy: { id: string; name: string } | null;
}

interface Summary {
  totalPending: number; totalReceived: number; totalOverdue: number; totalDisputed: number;
  pendingAmount: string; receivedAmount: string; overdueAmount: string; disputedAmount: string;
}

const statusLabels: Record<string, string> = {
  PENDING: 'รอรับเงิน', RECEIVED: 'ได้รับแล้ว', PARTIALLY_RECEIVED: 'ได้รับบางส่วน',
  OVERDUE: 'เกินกำหนด', DISPUTED: 'มีปัญหา',
};
const statusColors: Record<string, string> = {
  PENDING: 'bg-warning/10 text-warning dark:bg-warning/15', RECEIVED: 'bg-success/10 text-success dark:bg-success/15',
  PARTIALLY_RECEIVED: 'bg-warning/10 text-warning dark:bg-warning/15', OVERDUE: 'bg-destructive/10 text-destructive dark:bg-destructive/15',
  DISPUTED: 'bg-destructive/10 text-destructive dark:bg-destructive/15',
};
const inputClass = 'w-full px-3 py-2 border border-input rounded-lg focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none';

interface InterCompanyTransaction {
  id: string;
  principal: string;
  commission: string;
  totalAmount: string;
  status: string;
  createdAt: string;
  sale: {
    id: string;
    saleNumber: string;
    customer: { id: string; name: string };
  };
  branch: { id: string; name: string };
}

interface InterCompanyProfitSummary {
  transactionCount: number;
  shop: { totalRevenue: number; totalCost: number; totalCommission: number; totalProfit: number };
  finance: { totalInterest: number; totalCommissionPaid: number; totalProfit: number };
  combined: { totalVat: number; totalProfit: number };
}

const icStatusLabels: Record<string, string> = {
  PENDING: 'รอดำเนินการ',
  CONFIRMED: 'ยืนยันแล้ว',
  RECONCILED: 'กระทบยอดแล้ว',
};
const icStatusColors: Record<string, string> = {
  PENDING: 'bg-warning/10 text-warning dark:bg-warning/15',
  CONFIRMED: 'bg-primary/10 text-primary dark:bg-primary/15',
  RECONCILED: 'bg-success/10 text-success dark:bg-success/15',
};

function fmt(n: string | number | null | undefined): string {
  if (n == null) return '-';
  return Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function BestchoiceFinanceTab() {
  const [icPage, setIcPage] = useState(1);
  const [icStatus, setIcStatus] = useState('');

  const { data: profitSummary } = useQuery<InterCompanyProfitSummary>({
    queryKey: ['inter-company-profit-summary'],
    queryFn: async () => (await api.get('/inter-company/profit-summary')).data,
  });

  const { data: icData, isLoading: icLoading } = useQuery<{ data: InterCompanyTransaction[]; total: number }>({
    queryKey: ['inter-company', icPage, icStatus],
    queryFn: async () => {
      const p = new URLSearchParams({ limit: '20', page: String(icPage) });
      if (icStatus) p.set('status', icStatus);
      return (await api.get(`/inter-company?${p}`)).data;
    },
  });

  const icSummaryCards = [
    { label: 'รายการทั้งหมด', value: profitSummary?.transactionCount || 0, isCount: true, icon: Receipt, color: 'text-primary', iconBg: 'bg-primary/20', stripe: 'bg-primary' },
    { label: 'ยอดเงินต้นรวม', value: profitSummary?.shop?.totalRevenue || 0, isCount: false, icon: Banknote, color: 'text-blue-600', iconBg: 'bg-blue-100 dark:bg-blue-900/30', stripe: 'bg-blue-500' },
    { label: 'ค่าคอมมิชชันรวม', value: profitSummary?.finance?.totalCommissionPaid || 0, isCount: false, icon: Percent, color: 'text-amber-600', iconBg: 'bg-amber-100 dark:bg-amber-900/30', stripe: 'bg-amber-500' },
    { label: 'ยอดจ่ายรวม', value: profitSummary?.shop?.totalCost || 0, isCount: false, icon: Wallet, color: 'text-success', iconBg: 'bg-success/20', stripe: 'bg-success' },
  ];

  const icColumns = [
    {
      key: 'customer', label: 'ลูกค้า/สินค้า',
      render: (r: InterCompanyTransaction) => (
        <div className="min-w-0">
          <div className="font-medium truncate">{r.sale.customer.name}</div>
          <div className="text-xs text-muted-foreground">{r.sale.saleNumber}</div>
        </div>
      ),
    },
    { key: 'branch', label: 'สาขา', render: (r: InterCompanyTransaction) => r.branch.name },
    {
      key: 'principal', label: 'เงินต้น',
      render: (r: InterCompanyTransaction) => <div className="text-right font-medium">{fmt(r.principal)} ฿</div>,
    },
    {
      key: 'commission', label: 'ค่าคอม',
      render: (r: InterCompanyTransaction) => <div className="text-right font-medium">{fmt(r.commission)} ฿</div>,
    },
    {
      key: 'totalAmount', label: 'ยอดจ่ายหน้าร้าน',
      render: (r: InterCompanyTransaction) => <div className="text-right font-semibold text-primary">{fmt(r.totalAmount)} ฿</div>,
    },
    {
      key: 'status', label: 'สถานะ',
      render: (r: InterCompanyTransaction) => (
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${icStatusColors[r.status] || 'bg-muted'}`}>
          {icStatusLabels[r.status] || r.status}
        </span>
      ),
    },
    {
      key: 'createdAt', label: 'วันที่',
      render: (r: InterCompanyTransaction) => formatDateShort(r.createdAt),
    },
  ];

  const icTotalPages = Math.ceil((icData?.total || 0) / 20);

  return (
    <div>
      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {icSummaryCards.map((card) => (
          <Card key={card.label} className="h-full overflow-hidden hover:shadow-card-hover transition-all">
            <div className="flex h-full">
              <div className={`w-1 shrink-0 ${card.stripe}`} />
              <CardContent className="p-4 flex flex-col justify-between flex-1">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-medium text-muted-foreground">{card.label}</span>
                  <div className={`size-8 rounded-lg flex items-center justify-center shrink-0 ${card.iconBg}`}>
                    <card.icon className={`size-4 ${card.color}`} />
                  </div>
                </div>
                <div>
                  {card.isCount ? (
                    <AnimatedCounter value={card.value} className={`text-2xl font-bold ${card.color}`} />
                  ) : (
                    <div className={`text-2xl font-bold ${card.color}`}>{fmt(card.value)}</div>
                  )}
                  {!card.isCount && <div className="text-2xs text-muted-foreground mt-1">บาท</div>}
                </div>
              </CardContent>
            </div>
          </Card>
        ))}
      </div>

      {/* Status Filter */}
      <div className="flex flex-wrap gap-4 mb-5 bg-card rounded-xl border border-border p-4">
        <div>
          <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">สถานะ</label>
          <select value={icStatus} onChange={(e) => { setIcStatus(e.target.value); setIcPage(1); }} className={`${inputClass} w-auto min-w-[160px]`}>
            <option value="">ทั้งหมด</option>
            <option value="PENDING">รอดำเนินการ</option>
            <option value="CONFIRMED">ยืนยันแล้ว</option>
            <option value="RECONCILED">กระทบยอดแล้ว</option>
          </select>
        </div>
      </div>

      <DataTable columns={icColumns} data={icData?.data || []} isLoading={icLoading} emptyMessage="ไม่พบรายการ BESTCHOICE ไฟแนนซ์" />

      {/* Pagination */}
      {icTotalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <span className="text-sm text-muted-foreground">หน้า {icPage} / {icTotalPages} (ทั้งหมด {icData?.total} รายการ)</span>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" disabled={icPage <= 1} onClick={() => setIcPage(icPage - 1)}>ก่อนหน้า</Button>
            <Button variant="outline" size="sm" disabled={icPage >= icTotalPages} onClick={() => setIcPage(icPage + 1)}>ถัดไป</Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function FinanceReceivablePage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const statusFilter = searchParams.get('status') || '';
  const companyFilter = searchParams.get('company') || '';
  const branchFilter = searchParams.get('branch') || '';
  const startDate = searchParams.get('startDate') || '';
  const endDate = searchParams.get('endDate') || '';
  const page = parseInt(searchParams.get('page') || '1');
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const debouncedSearch = useDebounce(search, 300);

  const [selectedRecord, setSelectedRecord] = useState<FinanceReceivable | null>(null);
  const [isReceiveModalOpen, setIsReceiveModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDisputeModalOpen, setIsDisputeModalOpen] = useState(false);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [receiveForm, setReceiveForm] = useState({ receivedAmount: '', receivedDate: new Date().toISOString().split('T')[0], bankRef: '', note: '' });
  const [editForm, setEditForm] = useState({ financeRefNumber: '', commissionRate: '', expectedDate: '', note: '' });
  const [disputeReason, setDisputeReason] = useState('');

  const setFilter = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams);
    if (value) params.set(key, value); else params.delete(key);
    if (key !== 'page') params.delete('page');
    setSearchParams(params, { replace: true });
  };

  const now = new Date();
  const quickPresets = [
    { label: 'เดือนนี้', fn: () => { setFilter('startDate', new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]); setFilter('endDate', now.toISOString().split('T')[0]); } },
    { label: '3 เดือน', fn: () => { const d = new Date(); d.setMonth(d.getMonth() - 3); setFilter('startDate', d.toISOString().split('T')[0]); setFilter('endDate', now.toISOString().split('T')[0]); } },
    { label: 'ทั้งหมด', fn: () => { setFilter('startDate', ''); setFilter('endDate', ''); } },
  ];

  const invalidateAll = () => { queryClient.invalidateQueries({ queryKey: ['finance-receivable'] }); queryClient.invalidateQueries({ queryKey: ['finance-receivable-summary'] }); };

  const { data: branches = [] } = useQuery<{ id: string; name: string }[]>({ queryKey: ['branches'], queryFn: async () => (await api.get('/branches')).data });
  const { data: companies = [] } = useQuery<string[]>({ queryKey: ['finance-companies'], queryFn: async () => (await api.get('/finance-receivable/companies')).data });

  const { data: summary } = useQuery<Summary>({
    queryKey: ['finance-receivable-summary', branchFilter],
    queryFn: async () => { const p = new URLSearchParams(); if (branchFilter) p.set('branchId', branchFilter); return (await api.get(`/finance-receivable/summary?${p}`)).data; },
  });

  const { data: receivables, isLoading } = useQuery<{ data: FinanceReceivable[]; total: number }>({
    queryKey: ['finance-receivable', statusFilter, companyFilter, branchFilter, startDate, endDate, debouncedSearch, page],
    queryFn: async () => {
      const p = new URLSearchParams({ limit: '20', page: String(page) });
      if (statusFilter) p.set('status', statusFilter);
      if (companyFilter) p.set('financeCompany', companyFilter);
      if (branchFilter) p.set('branchId', branchFilter);
      if (startDate) p.set('startDate', startDate);
      if (endDate) p.set('endDate', endDate);
      if (debouncedSearch) p.set('search', debouncedSearch);
      return (await api.get(`/finance-receivable?${p}`)).data;
    },
  });

  const recordReceiveMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof receiveForm }) =>
      api.post(`/finance-receivable/${id}/receive`, { receivedAmount: parseFloat(data.receivedAmount), receivedDate: data.receivedDate, bankRef: data.bankRef || undefined, note: data.note || undefined }),
    onSuccess: () => { invalidateAll(); toast.success('บันทึกรับเงินจากไฟแนนซ์สำเร็จ'); setIsReceiveModalOpen(false); },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => api.patch(`/finance-receivable/${id}`, data),
    onSuccess: () => { invalidateAll(); toast.success('อัปเดตข้อมูลสำเร็จ'); setIsEditModalOpen(false); },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const disputeMutation = useMutation({
    mutationFn: async ({ id, note }: { id: string; note: string }) => api.patch(`/finance-receivable/${id}`, { status: 'DISPUTED', note }),
    onSuccess: () => { invalidateAll(); toast.success('แจ้งปัญหาสำเร็จ'); setIsDisputeModalOpen(false); setDisputeReason(''); },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const openReceiveModal = (r: FinanceReceivable) => { setSelectedRecord(r); setReceiveForm({ receivedAmount: r.netExpectedAmount, receivedDate: new Date().toISOString().split('T')[0], bankRef: '', note: '' }); setIsReceiveModalOpen(true); setOpenMenuId(null); };
  const openEditModal = (r: FinanceReceivable) => { setSelectedRecord(r); setEditForm({ financeRefNumber: r.financeRefNumber || '', commissionRate: r.commissionRate ? (Number(r.commissionRate) * 100).toString() : '', expectedDate: r.expectedDate.slice(0, 10), note: r.note || '' }); setIsEditModalOpen(true); setOpenMenuId(null); };
  const openDisputeModal = (r: FinanceReceivable) => { setSelectedRecord(r); setDisputeReason(''); setIsDisputeModalOpen(true); setOpenMenuId(null); };
  const openDetailModal = (r: FinanceReceivable) => { setSelectedRecord(r); setIsDetailModalOpen(true); };

  const totalAll = (Number(summary?.pendingAmount || 0) + Number(summary?.receivedAmount || 0) + Number(summary?.overdueAmount || 0));
  const receivedPct = totalAll > 0 ? (Number(summary?.receivedAmount || 0) / totalAll * 100) : 0;

  const summaryCards = [
    { label: 'รอรับเงิน', count: summary?.totalPending || 0, amount: summary?.pendingAmount, icon: Clock, color: 'text-warning', iconBg: 'bg-warning/20', stripe: 'bg-warning' },
    { label: 'ได้รับแล้ว', count: summary?.totalReceived || 0, amount: summary?.receivedAmount, icon: CheckCircle2, color: 'text-success', iconBg: 'bg-success/20', stripe: 'bg-success' },
    { label: 'เกินกำหนด', count: summary?.totalOverdue || 0, amount: summary?.overdueAmount, icon: AlertTriangle, color: 'text-destructive', iconBg: 'bg-destructive/20', stripe: 'bg-destructive' },
    { label: 'มีปัญหา', count: summary?.totalDisputed || 0, amount: summary?.disputedAmount, icon: Ban, color: 'text-destructive', iconBg: 'bg-destructive/20', stripe: 'bg-destructive/60' },
  ];

  const totalPages = Math.ceil((receivables?.total || 0) / 20);

  const columns = [
    {
      key: 'sale', label: 'รายการขาย',
      render: (r: FinanceReceivable) => (
        <button onClick={() => openDetailModal(r)} className="text-left min-w-0 hover:text-primary transition-colors">
          <div className="font-medium truncate">{r.sale.customer.name}</div>
          <div className="text-xs text-muted-foreground">{r.sale.saleNumber} &middot; {r.sale.product.name}</div>
        </button>
      ),
    },
    {
      key: 'financeCompany', label: 'ไฟแนนซ์',
      render: (r: FinanceReceivable) => (<div><div className="font-medium">{r.financeCompany}</div>{r.financeRefNumber && <div className="text-xs text-muted-foreground">Ref: {r.financeRefNumber}</div>}</div>),
    },
    { key: 'branch', label: 'สาขา', render: (r: FinanceReceivable) => r.branch.name },
    {
      key: 'netExpectedAmount', label: 'ยอดสุทธิ',
      render: (r: FinanceReceivable) => (<div className="text-right"><div className="font-medium">{fmt(r.netExpectedAmount)}</div>{r.commissionRate && <div className="text-xs text-muted-foreground">หัก {(Number(r.commissionRate) * 100).toFixed(1)}%</div>}</div>),
    },
    {
      key: 'receivedAmount', label: 'ได้รับ',
      render: (r: FinanceReceivable) => <div className="text-right font-medium">{r.receivedAmount ? <span className="text-success">{fmt(r.receivedAmount)}</span> : '-'}</div>,
    },
    {
      key: 'expectedDate', label: 'กำหนดรับ',
      render: (r: FinanceReceivable) => {
        const d = new Date(r.expectedDate);
        const isOverdue = d < new Date() && r.status !== 'RECEIVED';
        return <span className={isOverdue ? 'text-destructive font-medium' : ''}>{formatDateShortThai(d)}</span>;
      },
    },
    {
      key: 'status', label: 'สถานะ',
      render: (r: FinanceReceivable) => (
        <div><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[r.status] || 'bg-muted'}`}>{statusLabels[r.status] || r.status}</span>
          {r.note && r.status === 'DISPUTED' && <div className="text-xs text-red-500 mt-0.5 truncate max-w-[100px]">{r.note}</div>}</div>
      ),
    },
    {
      key: 'actions', label: '',
      render: (r: FinanceReceivable) => {
        if (r.status === 'RECEIVED') return null;
        return (
          <div className="flex items-center gap-1.5">
            <button onClick={() => openReceiveModal(r)} className="px-2.5 py-1 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700">บันทึกรับเงิน</button>
            <div className="relative">
              <button onClick={() => setOpenMenuId(openMenuId === r.id ? null : r.id)} className="p-1 hover:bg-muted rounded"><MoreVertical className="size-4 text-muted-foreground" /></button>
              {openMenuId === r.id && (
                <div className="absolute right-0 top-full mt-1 z-10 bg-background border rounded-lg shadow-lg py-1 min-w-[120px]">
                  <button onClick={() => openEditModal(r)} className="w-full px-3 py-1.5 text-sm text-left hover:bg-muted flex items-center gap-2"><Pencil className="size-3.5" /> แก้ไข</button>
                  {r.status !== 'DISPUTED' && <button onClick={() => openDisputeModal(r)} className="w-full px-3 py-1.5 text-sm text-left hover:bg-muted text-destructive">แจ้งปัญหา</button>}
                </div>
              )}
            </div>
          </div>
        );
      },
    },
  ];

  return (
    <div onClick={() => setOpenMenuId(null)}>
      <PageHeader title="เงินรับจากไฟแนนซ์" subtitle={`ทั้งหมด ${receivables?.total || 0} รายการ`} />

      <Tabs defaultValue="external" className="mb-6">
        <TabsList variant="line" size="lg" className="mb-6">
          <TabsTrigger value="external">ไฟแนนซ์ภายนอก</TabsTrigger>
          <TabsTrigger value="bestchoice">BESTCHOICE ไฟแนนซ์</TabsTrigger>
        </TabsList>

        <TabsContent value="external">

      {/* Summary Cards — color stripe */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {summaryCards.map((card) => (
          <Card key={card.label} className="h-full overflow-hidden hover:shadow-card-hover transition-all">
            <div className="flex h-full">
              <div className={`w-1 shrink-0 ${card.stripe}`} />
              <CardContent className="p-4 flex flex-col justify-between flex-1">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-medium text-muted-foreground">{card.label}</span>
                  <div className={`size-8 rounded-lg flex items-center justify-center shrink-0 ${card.iconBg}`}>
                    <card.icon className={`size-4 ${card.color}`} />
                  </div>
                </div>
                <div>
                  <AnimatedCounter value={card.count} className={`text-2xl font-bold ${card.color}`} />
                  <div className="text-2xs text-muted-foreground mt-1">{fmt(card.amount)} บาท</div>
                </div>
              </CardContent>
            </div>
          </Card>
        ))}
      </div>

      {/* Progress bar — enhanced */}
      <div className="mb-6 p-4 bg-card rounded-xl border border-border">
        <div className="flex justify-between text-xs text-muted-foreground mb-2">
          <span className="font-medium">ยอดรับแล้ว <span className="text-success">{receivedPct.toFixed(0)}%</span></span>
          <span>{fmt(summary?.receivedAmount)} / {fmt(totalAll)} บาท</span>
        </div>
        <div className="h-3 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-success rounded-full transition-all duration-700" style={{ width: `${Math.min(receivedPct, 100)}%` }} />
        </div>
      </div>

      {/* Filters — grouped in card */}
      <div className="flex flex-wrap gap-4 mb-5 bg-card rounded-xl border border-border p-4">
        <div>
          <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">สถานะ</label>
          <select value={statusFilter} onChange={(e) => setFilter('status', e.target.value)} className={`${inputClass} w-auto min-w-[130px]`}>
            <option value="">ทั้งหมด</option>
            {Object.entries(statusLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ไฟแนนซ์</label>
          <select value={companyFilter} onChange={(e) => setFilter('company', e.target.value)} className={`${inputClass} w-auto min-w-[130px]`}>
            <option value="">ทั้งหมด</option>
            {companies.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">สาขา</label>
          <select value={branchFilter} onChange={(e) => setFilter('branch', e.target.value)} className={`${inputClass} w-auto min-w-[130px]`}>
            <option value="">ทุกสาขา</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ตั้งแต่</label>
          <ThaiDateInput value={startDate} onChange={(e) => setFilter('startDate', e.target.value)} className={`${inputClass} w-auto`} />
        </div>
        <div>
          <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ถึง</label>
          <ThaiDateInput value={endDate} onChange={(e) => setFilter('endDate', e.target.value)} className={`${inputClass} w-auto`} />
        </div>
        <div className="flex items-end gap-1">
          {quickPresets.map((p) => <button key={p.label} onClick={p.fn} className="px-3 py-2 text-xs border border-input rounded-lg hover:bg-muted">{p.label}</button>)}
        </div>
        <div className="flex-1 min-w-[180px]">
          <label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ค้นหา</label>
          <input type="text" placeholder="เลขที่ขาย, ชื่อลูกค้า, Ref..." value={search} onChange={(e) => setSearch(e.target.value)} className={inputClass} />
        </div>
      </div>

      <DataTable columns={columns} data={receivables?.data || []} isLoading={isLoading} emptyMessage="ไม่พบรายการเงินรับจากไฟแนนซ์" />

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <span className="text-sm text-muted-foreground">หน้า {page} / {totalPages} (ทั้งหมด {receivables?.total} รายการ)</span>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setFilter('page', String(page - 1))}>ก่อนหน้า</Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setFilter('page', String(page + 1))}>ถัดไป</Button>
          </div>
        </div>
      )}

        </TabsContent>

        <TabsContent value="bestchoice">
          <BestchoiceFinanceTab />
        </TabsContent>
      </Tabs>

      {/* Detail Modal */}
      <Modal isOpen={isDetailModalOpen} onClose={() => setIsDetailModalOpen(false)} title="รายละเอียดเงินรับจากไฟแนนซ์">
        {selectedRecord && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground">ลูกค้า</div>
                <div className="font-medium">{selectedRecord.sale.customer.name}</div>
                <div className="text-sm text-muted-foreground">{selectedRecord.sale.customer.phone}</div>
              </div>
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground">สินค้า</div>
                <div className="font-medium">{selectedRecord.sale.product.name}</div>
                <div className="text-sm text-muted-foreground">พนักงาน: {selectedRecord.sale.salesperson.name}</div>
              </div>
            </div>
            <div className="border-t pt-3 space-y-2">
              <div className="flex justify-between"><span className="text-muted-foreground">เลขที่ขาย</span><span className="font-medium">{selectedRecord.sale.saleNumber}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">ไฟแนนซ์</span><span className="font-medium">{selectedRecord.financeCompany}</span></div>
              {selectedRecord.financeRefNumber && <div className="flex justify-between"><span className="text-muted-foreground">Ref</span><span>{selectedRecord.financeRefNumber}</span></div>}
              <div className="flex justify-between"><span className="text-muted-foreground">ยอดเต็ม</span><span>{fmt(selectedRecord.expectedAmount)}</span></div>
              {selectedRecord.commissionRate && <div className="flex justify-between"><span className="text-muted-foreground">ค่าคอม ({(Number(selectedRecord.commissionRate)*100).toFixed(1)}%)</span><span className="text-destructive">-{fmt(selectedRecord.commissionAmount)}</span></div>}
              <div className="flex justify-between font-semibold"><span>ยอดสุทธิ</span><span>{fmt(selectedRecord.netExpectedAmount)}</span></div>
              {selectedRecord.receivedAmount && <div className="flex justify-between text-success"><span>ได้รับแล้ว</span><span>{fmt(selectedRecord.receivedAmount)}</span></div>}
            </div>
            <div className="border-t pt-3 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">วันที่สร้าง</span><span>{formatDateShort(selectedRecord.createdAt)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">กำหนดรับเงิน</span><span>{formatDateShort(selectedRecord.expectedDate)}</span></div>
              {selectedRecord.receivedDate && <div className="flex justify-between"><span className="text-muted-foreground">วันที่ได้รับ</span><span>{formatDateShort(selectedRecord.receivedDate)}</span></div>}
              {selectedRecord.bankRef && <div className="flex justify-between"><span className="text-muted-foreground">Ref ธนาคาร</span><span>{selectedRecord.bankRef}</span></div>}
              {selectedRecord.note && <div><span className="text-muted-foreground">หมายเหตุ:</span> {selectedRecord.note}</div>}
            </div>
          </div>
        )}
      </Modal>

      {/* Record Receive Modal */}
      <Modal isOpen={isReceiveModalOpen} onClose={() => setIsReceiveModalOpen(false)} title="บันทึกรับเงินจากไฟแนนซ์">
        {selectedRecord && (
          <form onSubmit={(e) => { e.preventDefault(); recordReceiveMutation.mutate({ id: selectedRecord.id, data: receiveForm }); }} className="space-y-4">
            <div className="p-3 bg-muted rounded-lg text-sm space-y-1">
              <div>ลูกค้า: <span className="font-medium">{selectedRecord.sale.customer.name}</span></div>
              <div>ไฟแนนซ์: <span className="font-medium">{selectedRecord.financeCompany}</span></div>
              <div>ยอดสุทธิ: <span className="font-medium text-primary">{fmt(selectedRecord.netExpectedAmount)} บาท</span></div>
            </div>
            <div><label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">จำนวนเงินที่ได้รับ *</label><input type="number" step="0.01" min="0.01" value={receiveForm.receivedAmount} onChange={(e) => setReceiveForm({ ...receiveForm, receivedAmount: e.target.value })} required className={inputClass} /></div>
            <div><label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">วันที่ได้รับ *</label><ThaiDateInput value={receiveForm.receivedDate} onChange={(e) => setReceiveForm({ ...receiveForm, receivedDate: e.target.value })} required className={inputClass} /></div>
            <div><label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">เลขอ้างอิงธนาคาร</label><input type="text" value={receiveForm.bankRef} onChange={(e) => setReceiveForm({ ...receiveForm, bankRef: e.target.value })} placeholder="เลขอ้างอิงการโอน" className={inputClass} /></div>
            <div><label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">หมายเหตุ</label><textarea value={receiveForm.note} onChange={(e) => setReceiveForm({ ...receiveForm, note: e.target.value })} rows={2} className={inputClass} /></div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setIsReceiveModalOpen(false)} className="px-4 py-2 text-sm text-muted-foreground">ยกเลิก</button>
              <button type="submit" disabled={recordReceiveMutation.isPending} className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50">{recordReceiveMutation.isPending ? 'กำลังบันทึก...' : 'บันทึกรับเงิน'}</button>
            </div>
          </form>
        )}
      </Modal>

      {/* Edit Modal */}
      <Modal isOpen={isEditModalOpen} onClose={() => setIsEditModalOpen(false)} title="แก้ไขข้อมูล">
        {selectedRecord && (
          <form onSubmit={(e) => { e.preventDefault(); const d: Record<string, unknown> = {}; if (editForm.financeRefNumber) d.financeRefNumber = editForm.financeRefNumber; if (editForm.commissionRate) d.commissionRate = parseFloat(editForm.commissionRate) / 100; if (editForm.expectedDate) d.expectedDate = editForm.expectedDate; if (editForm.note) d.note = editForm.note; updateMutation.mutate({ id: selectedRecord.id, data: d }); }} className="space-y-4">
            <div><label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">เลข Ref ไฟแนนซ์</label><input type="text" value={editForm.financeRefNumber} onChange={(e) => setEditForm({ ...editForm, financeRefNumber: e.target.value })} className={inputClass} /></div>
            <div><label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ค่าคอมมิชชั่น (%)</label><input type="number" step="0.1" min="0" max="100" value={editForm.commissionRate} onChange={(e) => setEditForm({ ...editForm, commissionRate: e.target.value })} className={inputClass} /></div>
            <div><label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">กำหนดรับเงิน</label><ThaiDateInput value={editForm.expectedDate} onChange={(e) => setEditForm({ ...editForm, expectedDate: e.target.value })} className={inputClass} /></div>
            <div><label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">หมายเหตุ</label><textarea value={editForm.note} onChange={(e) => setEditForm({ ...editForm, note: e.target.value })} rows={2} className={inputClass} /></div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setIsEditModalOpen(false)} className="px-4 py-2 text-sm text-muted-foreground">ยกเลิก</button>
              <button type="submit" disabled={updateMutation.isPending} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50">{updateMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}</button>
            </div>
          </form>
        )}
      </Modal>

      {/* Dispute Modal */}
      <Modal isOpen={isDisputeModalOpen} onClose={() => setIsDisputeModalOpen(false)} title="แจ้งปัญหา">
        {selectedRecord && (
          <div className="space-y-4">
            <div className="p-3 bg-muted rounded-lg text-sm">ไฟแนนซ์: <span className="font-medium">{selectedRecord.financeCompany}</span> &middot; ยอด: <span className="font-medium">{fmt(selectedRecord.netExpectedAmount)}</span></div>
            <div><label className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">เหตุผล *</label><textarea value={disputeReason} onChange={(e) => setDisputeReason(e.target.value)} rows={3} placeholder="เช่น ไฟแนนซ์ปฏิเสธ, ยอดไม่ตรง..." className={inputClass} /></div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setIsDisputeModalOpen(false)} className="px-4 py-2 text-sm text-muted-foreground">ยกเลิก</button>
              <button onClick={() => { if (!disputeReason.trim()) { toast.error('กรุณาระบุเหตุผล'); return; } disputeMutation.mutate({ id: selectedRecord.id, note: disputeReason }); }}
                disabled={disputeMutation.isPending} className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50">{disputeMutation.isPending ? 'กำลังบันทึก...' : 'ยืนยัน'}</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
