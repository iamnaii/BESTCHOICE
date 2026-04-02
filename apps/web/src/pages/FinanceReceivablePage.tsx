import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Banknote, Clock, AlertTriangle, CheckCircle2, Ban, Pencil } from 'lucide-react';

interface FinanceReceivable {
  id: string;
  financeCompany: string;
  financeRefNumber: string | null;
  expectedAmount: string;
  commissionRate: string | null;
  commissionAmount: string | null;
  netExpectedAmount: string;
  receivedAmount: string | null;
  receivedDate: string | null;
  bankRef: string | null;
  expectedDate: string;
  status: string;
  note: string | null;
  createdAt: string;
  sale: {
    id: string;
    saleNumber: string;
    sellingPrice: string;
    netAmount: string;
    financeAmount: string | null;
    downPaymentAmount: string | null;
    createdAt: string;
    customer: { id: string; name: string; phone: string | null };
    product: { id: string; name: string; brand: string | null };
    salesperson: { id: string; name: string };
  };
  branch: { id: string; name: string };
  recordedBy: { id: string; name: string } | null;
}

interface Summary {
  totalPending: number;
  totalReceived: number;
  totalOverdue: number;
  totalDisputed: number;
  pendingAmount: string;
  receivedAmount: string;
  overdueAmount: string;
  disputedAmount: string;
}

const statusLabels: Record<string, string> = {
  PENDING: 'รอรับเงิน', RECEIVED: 'ได้รับแล้ว', PARTIALLY_RECEIVED: 'ได้รับบางส่วน',
  OVERDUE: 'เกินกำหนด', DISPUTED: 'มีปัญหา',
};

const statusColors: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-700', RECEIVED: 'bg-green-100 text-green-700',
  PARTIALLY_RECEIVED: 'bg-orange-100 text-orange-700', OVERDUE: 'bg-red-100 text-red-700',
  DISPUTED: 'bg-red-100 text-red-800',
};

const inputClass = 'w-full px-3 py-2 border border-input rounded-lg focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none';

function fmt(n: string | number | null | undefined): string {
  if (n == null) return '-';
  return Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function FinanceReceivablePage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [companyFilter, setCompanyFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [search, setSearch] = useState('');
  const [selectedRecord, setSelectedRecord] = useState<FinanceReceivable | null>(null);
  const [isReceiveModalOpen, setIsReceiveModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDisputeModalOpen, setIsDisputeModalOpen] = useState(false);
  const [receiveForm, setReceiveForm] = useState({ receivedAmount: '', receivedDate: new Date().toISOString().split('T')[0], bankRef: '', note: '' });
  const [editForm, setEditForm] = useState({ financeRefNumber: '', commissionRate: '', expectedDate: '', note: '' });
  const [disputeReason, setDisputeReason] = useState('');

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['finance-receivable'] });
    queryClient.invalidateQueries({ queryKey: ['finance-receivable-summary'] });
  };

  const { data: branches = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['branches'],
    queryFn: async () => (await api.get('/branches')).data,
  });

  const { data: summary } = useQuery<Summary>({
    queryKey: ['finance-receivable-summary', branchFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (branchFilter) params.set('branchId', branchFilter);
      return (await api.get(`/finance-receivable/summary?${params}`)).data;
    },
  });

  const { data: companies = [] } = useQuery<string[]>({
    queryKey: ['finance-companies'],
    queryFn: async () => (await api.get('/finance-receivable/companies')).data,
  });

  const { data: receivables, isLoading } = useQuery<{ data: FinanceReceivable[]; total: number }>({
    queryKey: ['finance-receivable', statusFilter, companyFilter, branchFilter, startDate, endDate, search],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '100' });
      if (statusFilter) params.set('status', statusFilter);
      if (companyFilter) params.set('financeCompany', companyFilter);
      if (branchFilter) params.set('branchId', branchFilter);
      if (search) params.set('search', search);
      // Date filtering done client-side since backend filters by expectedDate range aren't implemented
      return (await api.get(`/finance-receivable?${params}`)).data;
    },
  });

  // Filter by date client-side
  const filteredData = (receivables?.data || []).filter((r) => {
    if (startDate && new Date(r.expectedDate) < new Date(startDate)) return false;
    if (endDate && new Date(r.expectedDate) > new Date(endDate + 'T23:59:59')) return false;
    return true;
  });

  const recordReceiveMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof receiveForm }) =>
      api.post(`/finance-receivable/${id}/receive`, {
        receivedAmount: parseFloat(data.receivedAmount),
        receivedDate: data.receivedDate,
        bankRef: data.bankRef || undefined,
        note: data.note || undefined,
      }),
    onSuccess: () => { invalidateAll(); toast.success('บันทึกรับเงินจากไฟแนนซ์สำเร็จ'); setIsReceiveModalOpen(false); },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      api.patch(`/finance-receivable/${id}`, data),
    onSuccess: () => { invalidateAll(); toast.success('อัปเดตข้อมูลสำเร็จ'); setIsEditModalOpen(false); },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const disputeMutation = useMutation({
    mutationFn: async ({ id, note }: { id: string; note: string }) =>
      api.patch(`/finance-receivable/${id}`, { status: 'DISPUTED', note }),
    onSuccess: () => { invalidateAll(); toast.success('แจ้งปัญหาสำเร็จ'); setIsDisputeModalOpen(false); setDisputeReason(''); },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const openReceiveModal = (record: FinanceReceivable) => {
    setSelectedRecord(record);
    setReceiveForm({ receivedAmount: record.netExpectedAmount, receivedDate: new Date().toISOString().split('T')[0], bankRef: '', note: '' });
    setIsReceiveModalOpen(true);
  };

  const openEditModal = (record: FinanceReceivable) => {
    setSelectedRecord(record);
    setEditForm({
      financeRefNumber: record.financeRefNumber || '',
      commissionRate: record.commissionRate ? (Number(record.commissionRate) * 100).toString() : '',
      expectedDate: record.expectedDate.slice(0, 10),
      note: record.note || '',
    });
    setIsEditModalOpen(true);
  };

  const openDisputeModal = (record: FinanceReceivable) => {
    setSelectedRecord(record);
    setDisputeReason('');
    setIsDisputeModalOpen(true);
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRecord) return;
    const data: Record<string, unknown> = {};
    if (editForm.financeRefNumber) data.financeRefNumber = editForm.financeRefNumber;
    if (editForm.commissionRate) data.commissionRate = parseFloat(editForm.commissionRate) / 100;
    if (editForm.expectedDate) data.expectedDate = editForm.expectedDate;
    if (editForm.note) data.note = editForm.note;
    updateMutation.mutate({ id: selectedRecord.id, data });
  };

  const summaryCards = [
    { label: 'รอรับเงิน', count: summary?.totalPending || 0, amount: summary?.pendingAmount, icon: Clock, color: 'text-yellow-600', bg: 'bg-yellow-50' },
    { label: 'ได้รับแล้ว', count: summary?.totalReceived || 0, amount: summary?.receivedAmount, icon: CheckCircle2, color: 'text-green-600', bg: 'bg-green-50' },
    { label: 'เกินกำหนด', count: summary?.totalOverdue || 0, amount: summary?.overdueAmount, icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-50' },
    { label: 'มีปัญหา', count: summary?.totalDisputed || 0, amount: summary?.disputedAmount, icon: Ban, color: 'text-red-800', bg: 'bg-red-50' },
  ];

  const columns = [
    {
      key: 'sale', label: 'รายการขาย',
      render: (r: FinanceReceivable) => (
        <div className="min-w-0">
          <div className="font-medium text-foreground truncate">{r.sale.customer.name}</div>
          <div className="text-xs text-muted-foreground">{r.sale.saleNumber} &middot; {r.sale.product.name}</div>
        </div>
      ),
    },
    {
      key: 'financeCompany', label: 'ไฟแนนซ์',
      render: (r: FinanceReceivable) => (
        <div>
          <div className="font-medium">{r.financeCompany}</div>
          {r.financeRefNumber && <div className="text-xs text-muted-foreground">Ref: {r.financeRefNumber}</div>}
        </div>
      ),
    },
    { key: 'branch', label: 'สาขา', render: (r: FinanceReceivable) => r.branch.name },
    {
      key: 'netExpectedAmount', label: 'ยอดที่ต้องรับ (สุทธิ)',
      render: (r: FinanceReceivable) => (
        <div className="text-right">
          <div className="font-medium">{fmt(r.netExpectedAmount)}</div>
          {r.commissionRate && (
            <div className="text-xs text-muted-foreground">ค่าคอม {(Number(r.commissionRate) * 100).toFixed(1)}% = {fmt(r.commissionAmount)}</div>
          )}
        </div>
      ),
    },
    {
      key: 'receivedAmount', label: 'ได้รับแล้ว',
      render: (r: FinanceReceivable) => <div className="text-right font-medium">{r.receivedAmount ? fmt(r.receivedAmount) : '-'}</div>,
    },
    {
      key: 'expectedDate', label: 'กำหนดรับเงิน',
      render: (r: FinanceReceivable) => {
        const d = new Date(r.expectedDate);
        const isOverdue = d < new Date() && r.status !== 'RECEIVED';
        return <span className={isOverdue ? 'text-red-600 font-medium' : ''}>{d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })}</span>;
      },
    },
    {
      key: 'status', label: 'สถานะ',
      render: (r: FinanceReceivable) => (
        <div>
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[r.status] || 'bg-muted text-foreground'}`}>
            {statusLabels[r.status] || r.status}
          </span>
          {r.note && r.status === 'DISPUTED' && <div className="text-xs text-red-500 mt-0.5 truncate max-w-[120px]">{r.note}</div>}
        </div>
      ),
    },
    {
      key: 'actions', label: '',
      render: (r: FinanceReceivable) => {
        if (r.status === 'RECEIVED') return null;
        return (
          <div className="flex items-center gap-2">
            <button onClick={() => openEditModal(r)} className="text-muted-foreground hover:text-foreground"><Pencil className="size-3.5" /></button>
            <button onClick={() => openReceiveModal(r)} className="text-primary hover:text-primary/80 text-sm font-medium">บันทึกรับเงิน</button>
            {r.status !== 'DISPUTED' && (
              <button onClick={() => openDisputeModal(r)} className="text-red-500 hover:text-red-600 text-sm font-medium">แจ้งปัญหา</button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader title="เงินรับจากไฟแนนซ์" subtitle="ติดตามเงินที่ไฟแนนซ์โอนมาให้ร้าน" icon={<Banknote className="size-6" />} />

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {summaryCards.map((card) => (
          <Card key={card.label}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{card.label}</span>
                <div className={`p-2 rounded-lg ${card.bg}`}><card.icon className={`size-4 ${card.color}`} /></div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{card.count}</div>
              <div className="text-sm text-muted-foreground">{fmt(card.amount)} บาท</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={`${inputClass} w-auto min-w-[140px]`}>
          <option value="">ทุกสถานะ</option>
          {Object.entries(statusLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)} className={`${inputClass} w-auto min-w-[140px]`}>
          <option value="">ทุกไฟแนนซ์</option>
          {companies.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className={`${inputClass} w-auto min-w-[140px]`}>
          <option value="">ทุกสาขา</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={`${inputClass} w-auto`} />
        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={`${inputClass} w-auto`} />
        <input type="text" placeholder="ค้นหา..." value={search} onChange={(e) => setSearch(e.target.value)} className={`${inputClass} w-auto min-w-[200px]`} />
      </div>

      <DataTable columns={columns} data={filteredData} isLoading={isLoading} />

      {/* Record Receive Modal */}
      <Modal isOpen={isReceiveModalOpen} onClose={() => setIsReceiveModalOpen(false)} title="บันทึกรับเงินจากไฟแนนซ์">
        {selectedRecord && (
          <form onSubmit={(e) => { e.preventDefault(); recordReceiveMutation.mutate({ id: selectedRecord.id, data: receiveForm }); }} className="space-y-4">
            <div className="p-3 bg-muted rounded-lg text-sm space-y-1">
              <div>ลูกค้า: <span className="font-medium">{selectedRecord.sale.customer.name}</span></div>
              <div>ไฟแนนซ์: <span className="font-medium">{selectedRecord.financeCompany}</span></div>
              <div>ยอดที่ต้องรับ (สุทธิ): <span className="font-medium text-primary">{fmt(selectedRecord.netExpectedAmount)} บาท</span></div>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">จำนวนเงินที่ได้รับ *</label>
              <input type="number" step="0.01" min="0.01" value={receiveForm.receivedAmount} onChange={(e) => setReceiveForm({ ...receiveForm, receivedAmount: e.target.value })} required className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">วันที่ได้รับเงิน *</label>
              <input type="date" value={receiveForm.receivedDate} onChange={(e) => setReceiveForm({ ...receiveForm, receivedDate: e.target.value })} required className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">เลขอ้างอิงธนาคาร</label>
              <input type="text" value={receiveForm.bankRef} onChange={(e) => setReceiveForm({ ...receiveForm, bankRef: e.target.value })} placeholder="เลขอ้างอิงการโอน" className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">หมายเหตุ</label>
              <textarea value={receiveForm.note} onChange={(e) => setReceiveForm({ ...receiveForm, note: e.target.value })} rows={2} className={inputClass} />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setIsReceiveModalOpen(false)} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">ยกเลิก</button>
              <button type="submit" disabled={recordReceiveMutation.isPending} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
                {recordReceiveMutation.isPending ? 'กำลังบันทึก...' : 'บันทึกรับเงิน'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Edit Modal */}
      <Modal isOpen={isEditModalOpen} onClose={() => setIsEditModalOpen(false)} title="แก้ไขข้อมูลเงินรับ">
        {selectedRecord && (
          <form onSubmit={handleEditSubmit} className="space-y-4">
            <div className="p-3 bg-muted rounded-lg text-sm space-y-1">
              <div>ลูกค้า: <span className="font-medium">{selectedRecord.sale.customer.name}</span></div>
              <div>ไฟแนนซ์: <span className="font-medium">{selectedRecord.financeCompany}</span></div>
              <div>ยอดเต็ม: <span className="font-medium">{fmt(selectedRecord.expectedAmount)}</span></div>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">เลข Ref ไฟแนนซ์</label>
              <input type="text" value={editForm.financeRefNumber} onChange={(e) => setEditForm({ ...editForm, financeRefNumber: e.target.value })} placeholder="เลขอ้างอิงจากไฟแนนซ์" className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">ค่าคอมมิชชั่น (%)</label>
              <input type="number" step="0.1" min="0" max="100" value={editForm.commissionRate} onChange={(e) => setEditForm({ ...editForm, commissionRate: e.target.value })}
                placeholder="เช่น 3 = หัก 3%" className={inputClass} />
              {editForm.commissionRate && (
                <div className="text-xs text-muted-foreground mt-1">
                  หัก {editForm.commissionRate}% = {fmt(Number(selectedRecord.expectedAmount) * parseFloat(editForm.commissionRate) / 100)} บาท
                  &rarr; สุทธิ {fmt(Number(selectedRecord.expectedAmount) * (1 - parseFloat(editForm.commissionRate) / 100))} บาท
                </div>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">กำหนดรับเงิน</label>
              <input type="date" value={editForm.expectedDate} onChange={(e) => setEditForm({ ...editForm, expectedDate: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">หมายเหตุ</label>
              <textarea value={editForm.note} onChange={(e) => setEditForm({ ...editForm, note: e.target.value })} rows={2} className={inputClass} />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setIsEditModalOpen(false)} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">ยกเลิก</button>
              <button type="submit" disabled={updateMutation.isPending} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
                {updateMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Dispute Modal */}
      <Modal isOpen={isDisputeModalOpen} onClose={() => setIsDisputeModalOpen(false)} title="แจ้งปัญหาเงินรับจากไฟแนนซ์">
        {selectedRecord && (
          <div className="space-y-4">
            <div className="p-3 bg-muted rounded-lg text-sm space-y-1">
              <div>ไฟแนนซ์: <span className="font-medium">{selectedRecord.financeCompany}</span></div>
              <div>ลูกค้า: <span className="font-medium">{selectedRecord.sale.customer.name}</span></div>
              <div>ยอด: <span className="font-medium">{fmt(selectedRecord.netExpectedAmount)} บาท</span></div>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">เหตุผลที่แจ้งปัญหา *</label>
              <textarea value={disputeReason} onChange={(e) => setDisputeReason(e.target.value)} rows={3} placeholder="กรุณาระบุเหตุผล เช่น ไฟแนนซ์ปฏิเสธ, ยอดไม่ตรง..." className={inputClass} />
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setIsDisputeModalOpen(false)} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">ยกเลิก</button>
              <button
                onClick={() => {
                  if (!disputeReason.trim()) { toast.error('กรุณาระบุเหตุผล'); return; }
                  disputeMutation.mutate({ id: selectedRecord.id, note: disputeReason });
                }}
                disabled={disputeMutation.isPending}
                className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {disputeMutation.isPending ? 'กำลังบันทึก...' : 'ยืนยันแจ้งปัญหา'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
