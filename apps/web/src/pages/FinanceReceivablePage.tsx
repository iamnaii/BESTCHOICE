import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Banknote, Clock, AlertTriangle, CheckCircle2, Ban } from 'lucide-react';

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
  PENDING: 'รอรับเงิน',
  RECEIVED: 'ได้รับแล้ว',
  PARTIALLY_RECEIVED: 'ได้รับบางส่วน',
  OVERDUE: 'เกินกำหนด',
  DISPUTED: 'มีปัญหา',
};

const statusColors: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-700',
  RECEIVED: 'bg-green-100 text-green-700',
  PARTIALLY_RECEIVED: 'bg-orange-100 text-orange-700',
  OVERDUE: 'bg-red-100 text-red-700',
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
  const [search, setSearch] = useState('');
  const [selectedRecord, setSelectedRecord] = useState<FinanceReceivable | null>(null);
  const [isReceiveModalOpen, setIsReceiveModalOpen] = useState(false);
  const [receiveForm, setReceiveForm] = useState({
    receivedAmount: '',
    receivedDate: new Date().toISOString().split('T')[0],
    bankRef: '',
    note: '',
  });

  const { data: summary } = useQuery<Summary>({
    queryKey: ['finance-receivable-summary'],
    queryFn: async () => (await api.get('/finance-receivable/summary')).data,
  });

  const { data: companies = [] } = useQuery<string[]>({
    queryKey: ['finance-companies'],
    queryFn: async () => (await api.get('/finance-receivable/companies')).data,
  });

  const { data: receivables, isLoading } = useQuery<{ data: FinanceReceivable[]; total: number }>({
    queryKey: ['finance-receivable', statusFilter, companyFilter, search],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('limit', '100');
      if (statusFilter) params.set('status', statusFilter);
      if (companyFilter) params.set('financeCompany', companyFilter);
      if (search) params.set('search', search);
      return (await api.get(`/finance-receivable?${params}`)).data;
    },
  });

  const recordReceiveMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof receiveForm }) =>
      api.post(`/finance-receivable/${id}/receive`, {
        receivedAmount: parseFloat(data.receivedAmount),
        receivedDate: data.receivedDate,
        bankRef: data.bankRef || undefined,
        note: data.note || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance-receivable'] });
      queryClient.invalidateQueries({ queryKey: ['finance-receivable-summary'] });
      toast.success('บันทึกรับเงินจากไฟแนนซ์สำเร็จ');
      setIsReceiveModalOpen(false);
      setSelectedRecord(null);
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) =>
      api.patch(`/finance-receivable/${id}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance-receivable'] });
      queryClient.invalidateQueries({ queryKey: ['finance-receivable-summary'] });
      toast.success('อัปเดตสถานะสำเร็จ');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const openReceiveModal = (record: FinanceReceivable) => {
    setSelectedRecord(record);
    setReceiveForm({
      receivedAmount: record.netExpectedAmount,
      receivedDate: new Date().toISOString().split('T')[0],
      bankRef: '',
      note: '',
    });
    setIsReceiveModalOpen(true);
  };

  const handleReceiveSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRecord) return;
    recordReceiveMutation.mutate({ id: selectedRecord.id, data: receiveForm });
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
            <div className="text-xs text-muted-foreground">
              ค่าคอม {(Number(r.commissionRate) * 100).toFixed(1)}% = {fmt(r.commissionAmount)}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'receivedAmount', label: 'ได้รับแล้ว',
      render: (r: FinanceReceivable) => (
        <div className="text-right font-medium">
          {r.receivedAmount ? fmt(r.receivedAmount) : '-'}
        </div>
      ),
    },
    {
      key: 'expectedDate', label: 'กำหนดรับเงิน',
      render: (r: FinanceReceivable) => {
        const d = new Date(r.expectedDate);
        const isOverdue = d < new Date() && r.status !== 'RECEIVED';
        return (
          <span className={isOverdue ? 'text-red-600 font-medium' : ''}>
            {d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
        );
      },
    },
    {
      key: 'status', label: 'สถานะ',
      render: (r: FinanceReceivable) => (
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[r.status] || 'bg-muted text-foreground'}`}>
          {statusLabels[r.status] || r.status}
        </span>
      ),
    },
    {
      key: 'actions', label: '',
      render: (r: FinanceReceivable) => {
        if (r.status === 'RECEIVED') return null;
        return (
          <div className="flex items-center gap-2">
            <button
              onClick={() => openReceiveModal(r)}
              className="text-primary hover:text-primary/80 text-sm font-medium"
            >
              บันทึกรับเงิน
            </button>
            {r.status !== 'DISPUTED' && r.status !== 'OVERDUE' && (
              <button
                onClick={() => updateStatusMutation.mutate({ id: r.id, status: 'DISPUTED' })}
                className="text-red-500 hover:text-red-600 text-sm font-medium"
              >
                แจ้งปัญหา
              </button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="เงินรับจากไฟแนนซ์"
        subtitle="ติดตามเงินที่ไฟแนนซ์โอนมาให้ร้าน"
        icon={<Banknote className="size-6" />}
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {summaryCards.map((card) => (
          <Card key={card.label}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{card.label}</span>
                <div className={`p-2 rounded-lg ${card.bg}`}>
                  <card.icon className={`size-4 ${card.color}`} />
                </div>
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
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className={`${inputClass} w-auto min-w-[150px]`}
        >
          <option value="">ทุกสถานะ</option>
          {Object.entries(statusLabels).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select
          value={companyFilter}
          onChange={(e) => setCompanyFilter(e.target.value)}
          className={`${inputClass} w-auto min-w-[150px]`}
        >
          <option value="">ทุกไฟแนนซ์</option>
          {companies.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="ค้นหา เลขที่ขาย, ชื่อลูกค้า, Ref..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={`${inputClass} w-auto min-w-[250px]`}
        />
      </div>

      <DataTable columns={columns} data={receivables?.data || []} isLoading={isLoading} />

      {/* Record Receive Modal */}
      <Modal isOpen={isReceiveModalOpen} onClose={() => setIsReceiveModalOpen(false)} title="บันทึกรับเงินจากไฟแนนซ์">
        {selectedRecord && (
          <form onSubmit={handleReceiveSubmit} className="space-y-4">
            <div className="p-3 bg-muted rounded-lg text-sm space-y-1">
              <div>ลูกค้า: <span className="font-medium">{selectedRecord.sale.customer.name}</span></div>
              <div>ไฟแนนซ์: <span className="font-medium">{selectedRecord.financeCompany}</span></div>
              <div>ยอดที่ต้องรับ (สุทธิ): <span className="font-medium text-primary">{fmt(selectedRecord.netExpectedAmount)} บาท</span></div>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1">จำนวนเงินที่ได้รับ *</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={receiveForm.receivedAmount}
                onChange={(e) => setReceiveForm({ ...receiveForm, receivedAmount: e.target.value })}
                required
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">วันที่ได้รับเงิน *</label>
              <input
                type="date"
                value={receiveForm.receivedDate}
                onChange={(e) => setReceiveForm({ ...receiveForm, receivedDate: e.target.value })}
                required
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">เลขอ้างอิงธนาคาร</label>
              <input
                type="text"
                value={receiveForm.bankRef}
                onChange={(e) => setReceiveForm({ ...receiveForm, bankRef: e.target.value })}
                placeholder="เช่น เลขอ้างอิงการโอน"
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">หมายเหตุ</label>
              <textarea
                value={receiveForm.note}
                onChange={(e) => setReceiveForm({ ...receiveForm, note: e.target.value })}
                rows={2}
                className={inputClass}
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setIsReceiveModalOpen(false)} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={recordReceiveMutation.isPending}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
              >
                {recordReceiveMutation.isPending ? 'กำลังบันทึก...' : 'บันทึกรับเงิน'}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
