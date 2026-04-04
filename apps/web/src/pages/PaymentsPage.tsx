import { useState, useMemo, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { compressImageForOcr } from '@/lib/compressImage';
import { useDebounce } from '@/hooks/useDebounce';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import PaymentHistorySheet from '@/components/payment/PaymentHistorySheet';
import ReceiptModal from '@/components/payment/ReceiptModal';
import { toast } from 'sonner';

import { exportToExcel } from '@/utils/excel.util';

interface OcrPaymentSlipResult {
  amount: number | null;
  senderName: string | null;
  senderBank: string | null;
  senderAccountNo: string | null;
  receiverName: string | null;
  receiverBank: string | null;
  receiverAccountNo: string | null;
  transactionRef: string | null;
  transactionDate: string | null;
  transactionTime: string | null;
  slipType: string | null;
  confidence: number;
}

interface PendingPayment {
  id: string;
  installmentNo: number;
  dueDate: string;
  amountDue: string;
  amountPaid: string;
  lateFee: string;
  status: string;
  contract: {
    id: string;
    contractNumber: string;
    customer: { id: string; name: string; phone: string };
    branch: { id: string; name: string };
  };
}

interface DailySummary {
  date: string;
  totalPayments: number;
  totalAmount: number;
  totalLateFees: number;
  byMethod: Record<string, number>;
  data: any[];
}

const paymentStatusLabels: Record<string, { label: string; className: string }> = {
  PENDING: { label: 'รอชำระ', className: 'bg-muted text-foreground' },
  PAID: { label: 'ชำระแล้ว', className: 'bg-success/10 text-success dark:bg-success/15' },
  OVERDUE: { label: 'เกินกำหนด', className: 'bg-destructive/10 text-destructive dark:bg-destructive/15' },
  PARTIALLY_PAID: { label: 'ชำระบางส่วน', className: 'bg-warning/10 text-warning dark:bg-warning/15' },
};

const methodLabels: Record<string, string> = {
  CASH: 'เงินสด',
  BANK_TRANSFER: 'โอนเงิน',
  QR_EWALLET: 'QR/E-Wallet',
};

const slipTypeLabels: Record<string, string> = {
  BANK_TRANSFER: 'โอนเงิน',
  QR_PAYMENT: 'QR Payment',
  PROMPTPAY: 'พร้อมเพย์',
  OTHER: 'อื่นๆ',
};

export default function PaymentsPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isOwner = user?.role === 'OWNER';
  const [tab, setTab] = useState<'pending' | 'summary'>('pending');
  const [statusFilter, setStatusFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearch = useDebounce(searchTerm, 400);
  const [summaryDate, setSummaryDate] = useState(new Date().toISOString().split('T')[0]);

  // History sheet & receipt modal state
  const [historyContractId, setHistoryContractId] = useState<string | null>(null);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [showPayModal, setShowPayModal] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<PendingPayment | null>(null);
  const [payForm, setPayForm] = useState({ amount: 0, paymentMethod: 'CASH', notes: '' });

  // Batch selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchPayMethod, setBatchPayMethod] = useState('CASH');

  // Advance payment state
  const [showAdvanceModal, setShowAdvanceModal] = useState(false);
  const [advanceContract, setAdvanceContract] = useState<PendingPayment | null>(null);
  const [advanceAmount, setAdvanceAmount] = useState('');
  const [advanceMethod, setAdvanceMethod] = useState('CASH');

  // OCR slip state
  const slipFileRef = useRef<HTMLInputElement>(null);
  const [ocrSlipLoading, setOcrSlipLoading] = useState(false);
  const [slipResult, setSlipResult] = useState<OcrPaymentSlipResult | null>(null);

  // Batch slip state
  const batchSlipFileRef = useRef<HTMLInputElement>(null);
  const [batchOcrLoading, setBatchOcrLoading] = useState(false);
  const [batchSlipResult, setBatchSlipResult] = useState<OcrPaymentSlipResult | null>(null);

  // Advance slip state
  const advanceSlipFileRef = useRef<HTMLInputElement>(null);
  const [advanceOcrLoading, setAdvanceOcrLoading] = useState(false);
  const [advanceSlipResult, setAdvanceSlipResult] = useState<OcrPaymentSlipResult | null>(null);

  // Branches list for filter (OWNER only)
  const { data: branches = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['branches'],
    queryFn: async () => {
      const { data } = await api.get('/branches');
      return data;
    },
    enabled: isOwner,
  });

  // Pending payments
  const { data: pendingPayments = [], isLoading: loadingPending } = useQuery<PendingPayment[]>({
    queryKey: ['pending-payments', statusFilter, debouncedSearch, branchFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (branchFilter) params.set('branchId', branchFilter);
      const { data } = await api.get(`/payments/pending?${params}`);
      return data.data;
    },
    enabled: tab === 'pending',
  });

  // Daily summary
  const { data: summary, isLoading: loadingSummary } = useQuery<DailySummary>({
    queryKey: ['daily-summary', summaryDate],
    queryFn: async () => {
      const { data } = await api.get(`/payments/daily-summary?date=${summaryDate}`);
      return data;
    },
    enabled: tab === 'summary',
  });

  const recordMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const { data } = await api.post('/payments/record', body);
      return data;
    },
    onSuccess: () => {
      toast.success('บันทึกการชำระสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['pending-payments'] });
      queryClient.invalidateQueries({ queryKey: ['daily-summary'] });
      setShowPayModal(false);
      setSelectedPayment(null);
      setSlipResult(null);
    },
    onError: (err: any) => toast.error(getErrorMessage(err)),
  });

  // Batch payment mutation
  const batchMutation = useMutation({
    mutationFn: async (payments: { contractId: string; installmentNo: number; amount: number; paymentMethod: string }[]) => {
      const results = [];
      for (const p of payments) {
        const { data } = await api.post('/payments/record', { ...p, notes: 'ชำระแบบรวม (batch)' });
        results.push(data);
      }
      return results;
    },
    onSuccess: (data) => {
      toast.success(`รับชำระสำเร็จ ${data.length} รายการ`);
      queryClient.invalidateQueries({ queryKey: ['pending-payments'] });
      queryClient.invalidateQueries({ queryKey: ['daily-summary'] });
      setSelectedIds(new Set());
      setShowBatchModal(false);
      setBatchSlipResult(null);
    },
    onError: (err: any) => toast.error(getErrorMessage(err)),
  });

  // Advance payment mutation (auto-allocate)
  const advanceMutation = useMutation({
    mutationFn: async (body: { contractId: string; amount: number; paymentMethod: string }) => {
      const { data } = await api.post('/payments/auto-allocate', body);
      return data;
    },
    onSuccess: (data) => {
      toast.success(`จ่ายล่วงหน้าสำเร็จ — จัดสรรให้ ${data.allocatedPayments?.length || 0} งวด`);
      if (data.overpayment > 0) {
        toast.warning(`เงินเกิน ${data.overpayment.toLocaleString()} บาท ไม่มีงวดเหลือให้จัดสรร`);
      }
      queryClient.invalidateQueries({ queryKey: ['pending-payments'] });
      setShowAdvanceModal(false);
      setAdvanceContract(null);
      setAdvanceAmount('');
      setAdvanceSlipResult(null);
    },
    onError: (err: any) => toast.error(getErrorMessage(err)),
  });

  // Pending summary totals
  const pendingSummary = useMemo(() => ({
    count: pendingPayments.length,
    totalDue: pendingPayments.reduce((sum, p) => sum + parseFloat(p.amountDue) + parseFloat(p.lateFee) - parseFloat(p.amountPaid), 0),
  }), [pendingPayments]);

  // Excel export handler
  const handleExport = async () => {
    await exportToExcel({
      columns: [
        { header: 'สัญญา', key: 'contractNumber', width: 15 },
        { header: 'ลูกค้า', key: 'customer', width: 15 },
        { header: 'เบอร์โทร', key: 'phone', width: 15 },
        { header: 'งวดที่', key: 'installmentNo', width: 15 },
        { header: 'ยอดค้าง', key: 'amountDue', width: 15 },
        { header: 'ค่าปรับ', key: 'lateFee', width: 15 },
        { header: 'รวมทั้งสิ้น', key: 'outstanding', width: 15 },
        { header: 'สถานะ', key: 'status', width: 15 },
        { header: 'สาขา', key: 'branch', width: 15 },
      ],
      data: pendingPayments.map((p) => {
        const outstanding = parseFloat(p.amountDue) + parseFloat(p.lateFee) - parseFloat(p.amountPaid);
        return {
          contractNumber: p.contract.contractNumber,
          customer: p.contract.customer.name,
          phone: p.contract.customer.phone,
          installmentNo: p.installmentNo,
          amountDue: parseFloat(p.amountDue).toLocaleString(),
          lateFee: parseFloat(p.lateFee).toLocaleString(),
          outstanding: outstanding.toLocaleString(),
          status: paymentStatusLabels[p.status]?.label || p.status,
          branch: p.contract.branch.name,
        };
      }),
      sheetName: 'รายการรอชำระ',
      filename: `pending-payments-${new Date().toISOString().split('T')[0]}.xlsx`,
    });
    toast.success('ส่งออก Excel สำเร็จ');
  };

  // Batch helpers
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    if (selectedIds.size === pendingPayments.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pendingPayments.map(p => p.id)));
    }
  }, [pendingPayments, selectedIds.size]);

  const batchSelectedPayments = useMemo(() =>
    pendingPayments.filter(p => selectedIds.has(p.id)),
  [pendingPayments, selectedIds]);

  const batchTotal = useMemo(() =>
    batchSelectedPayments.reduce((sum, p) => sum + parseFloat(p.amountDue) + parseFloat(p.lateFee) - parseFloat(p.amountPaid), 0),
  [batchSelectedPayments]);

  const handleBatchPay = () => {
    if (isSlipRequired(batchPayMethod) && !batchSlipResult) {
      toast.error('กรุณาแนบสลิปก่อนยืนยันการชำระ');
      return;
    }
    const batchRef = batchSlipResult?.transactionRef || `BATCH-${Date.now()}`;
    const items = batchSelectedPayments.map((p, i) => ({
      contractId: p.contract.id,
      installmentNo: p.installmentNo,
      amount: Math.round((parseFloat(p.amountDue) + parseFloat(p.lateFee) - parseFloat(p.amountPaid)) * 100) / 100,
      paymentMethod: batchPayMethod,
      transactionRef: `${batchRef}-${i + 1}`,
    }));
    batchMutation.mutate(items);
  };

  const openPayModal = useCallback((payment: PendingPayment) => {
    setSelectedPayment(payment);
    const remaining = parseFloat(payment.amountDue) + parseFloat(payment.lateFee) - parseFloat(payment.amountPaid);
    setPayForm({ amount: Math.round(remaining * 100) / 100, paymentMethod: 'CASH', notes: '' });
    setSlipResult(null);
    setShowPayModal(true);
  }, []);

  const handlePay = () => {
    if (!selectedPayment || payForm.amount <= 0) return;
    const remaining = parseFloat(selectedPayment.amountDue) + parseFloat(selectedPayment.lateFee) - parseFloat(selectedPayment.amountPaid);
    if (payForm.amount > Math.round(remaining * 100) / 100) {
      toast.error(`จำนวนเงินไม่ควรเกินยอดคงค้าง ${remaining.toLocaleString()} ฿`);
      return;
    }
    recordMutation.mutate({
      contractId: selectedPayment.contract.id,
      installmentNo: selectedPayment.installmentNo,
      amount: payForm.amount,
      paymentMethod: payForm.paymentMethod,
      notes: payForm.notes || undefined,
      transactionRef: slipResult?.transactionRef || `${payForm.paymentMethod}-${Date.now()}`,
    });
  };

  // Generic OCR slip scan helper
  const scanSlip = async (
    file: File,
    setLoading: (v: boolean) => void,
    setResult: (v: OcrPaymentSlipResult | null) => void,
    fileRef: React.RefObject<HTMLInputElement | null>,
    onAutoFill?: (data: OcrPaymentSlipResult) => void,
  ) => {
    if (file.size > 10 * 1024 * 1024) { toast.error('ไฟล์ต้องมีขนาดไม่เกิน 10MB'); return; }
    if (!file.type.startsWith('image/')) { toast.error('กรุณาเลือกไฟล์รูปภาพ'); return; }

    setLoading(true);
    try {
      const imageBase64 = await compressImageForOcr(file);
      const { data } = await api.post<OcrPaymentSlipResult>('/ocr/payment-slip', { imageBase64 }, { timeout: 90000 });
      setResult(data);
      if (onAutoFill) onAutoFill(data);

      const pct = (data.confidence * 100).toFixed(0);
      if (data.confidence < 0.5) {
        toast.error(`อ่านสลิปได้ แต่ความมั่นใจต่ำมาก (${pct}%) กรุณาตรวจสอบข้อมูล`);
      } else if (data.confidence < 0.7) {
        toast.warning(`อ่านสลิปสำเร็จ ความมั่นใจ ${pct}% กรุณาตรวจสอบ`);
      } else {
        toast.success(`อ่านสลิปสำเร็จ (ความมั่นใจ ${pct}%)`);
      }
    } catch (err: any) {
      if (err.code === 'ECONNABORTED' || !err.response) {
        toast.error('ไม่สามารถเชื่อมต่อ OCR ได้ กรุณาลองใหม่');
      } else {
        toast.error(getErrorMessage(err));
      }
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  // OCR Slip Scanner (single payment)
  const handleSlipScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await scanSlip(file, setOcrSlipLoading, setSlipResult, slipFileRef, (data) => {
      if (data.amount && data.amount > 0) {
        const slipType = data.slipType;
        let method = 'BANK_TRANSFER';
        if (slipType === 'QR_PAYMENT' || slipType === 'PROMPTPAY') method = 'QR_EWALLET';

        const notesParts: string[] = [];
        if (data.transactionRef) notesParts.push(`Ref: ${data.transactionRef}`);
        if (data.senderName) notesParts.push(`ผู้โอน: ${data.senderName}`);
        if (data.senderBank) notesParts.push(data.senderBank);
        if (data.transactionDate) notesParts.push(data.transactionDate);
        if (data.transactionTime) notesParts.push(data.transactionTime);

        setPayForm(prev => ({
          ...prev,
          amount: data.amount!,
          paymentMethod: method,
          notes: notesParts.join(' | '),
        }));
      }
    });
  };

  // OCR Slip Scanner (batch payment)
  const handleBatchSlipScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await scanSlip(file, setBatchOcrLoading, setBatchSlipResult, batchSlipFileRef, (data) => {
      if (data.slipType === 'QR_PAYMENT' || data.slipType === 'PROMPTPAY') {
        setBatchPayMethod('QR_EWALLET');
      } else if (data.slipType) {
        setBatchPayMethod('BANK_TRANSFER');
      }
    });
  };

  // OCR Slip Scanner (advance payment)
  const handleAdvanceSlipScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await scanSlip(file, setAdvanceOcrLoading, setAdvanceSlipResult, advanceSlipFileRef, (data) => {
      if (data.amount && data.amount > 0) setAdvanceAmount(String(data.amount));
      if (data.slipType === 'QR_PAYMENT' || data.slipType === 'PROMPTPAY') {
        setAdvanceMethod('QR_EWALLET');
      } else if (data.slipType) {
        setAdvanceMethod('BANK_TRANSFER');
      }
    });
  };

  // Check if slip is required (non-CASH methods)
  const isSlipRequired = (method: string) => method !== 'CASH';

  const pendingColumns = useMemo(() => [
    {
      key: 'select',
      label: '',
      render: (p: PendingPayment) => (
        <input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => toggleSelect(p.id)} className="rounded border-input" />
      ),
    },
    {
      key: 'contract',
      label: 'สัญญา',
      render: (p: PendingPayment) => (
        <div>
          <div className="font-mono text-sm text-primary">{p.contract.contractNumber}</div>
          <div className="text-xs text-muted-foreground">{p.contract.customer.name}</div>
        </div>
      ),
    },
    { key: 'installmentNo', label: 'งวดที่', render: (p: PendingPayment) => <span className="font-medium">{p.installmentNo}</span> },
    { key: 'dueDate', label: 'วันครบกำหนด', render: (p: PendingPayment) => {
      const isOverdue = new Date(p.dueDate) < new Date();
      return <span className={`text-sm ${isOverdue ? 'text-destructive font-medium' : ''}`}>{new Date(p.dueDate).toLocaleDateString('th-TH')}</span>;
    }},
    { key: 'amountDue', label: 'ยอดที่ต้องชำระ', render: (p: PendingPayment) => {
      const total = parseFloat(p.amountDue) + parseFloat(p.lateFee);
      return <span className="text-sm font-medium">{total.toLocaleString()} ฿</span>;
    }},
    { key: 'amountPaid', label: 'ชำระแล้ว', render: (p: PendingPayment) => {
      const paid = parseFloat(p.amountPaid);
      return paid > 0 ? <span className="text-sm text-success">{paid.toLocaleString()} ฿</span> : <span className="text-xs text-muted-foreground">-</span>;
    }},
    { key: 'lateFee', label: 'ค่าปรับ', render: (p: PendingPayment) => {
      const fee = parseFloat(p.lateFee);
      return fee > 0 ? <span className="text-sm text-destructive">{fee.toLocaleString()} ฿</span> : <span className="text-xs text-muted-foreground">-</span>;
    }},
    {
      key: 'status',
      label: 'สถานะ',
      render: (p: PendingPayment) => {
        const s = paymentStatusLabels[p.status] || { label: p.status, className: 'bg-muted' };
        return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.className}`}>{s.label}</span>;
      },
    },
    { key: 'branch', label: 'สาขา', render: (p: PendingPayment) => <span className="text-xs">{p.contract.branch.name}</span> },
    {
      key: 'actions',
      label: '',
      render: (p: PendingPayment) => (
        <div className="flex gap-1">
          <button onClick={() => openPayModal(p)} className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700">
            รับชำระ
          </button>
          <button onClick={() => { setAdvanceContract(p); setAdvanceAmount(''); setAdvanceMethod('CASH'); setShowAdvanceModal(true); }} className="px-2 py-1 text-xs border border-primary text-primary rounded hover:bg-primary/10">
            ล่วงหน้า
          </button>
          <button onClick={() => setHistoryContractId(p.contract.id)} className="px-2 py-1 text-xs border border-muted-foreground/30 text-muted-foreground rounded hover:bg-muted">
            ประวัติ
          </button>
        </div>
      ),
    },
  ], [openPayModal, selectedIds, pendingPayments.length, toggleAll, toggleSelect]);

  return (
    <div>
      <PageHeader title="ชำระเงิน" subtitle="บันทึกการรับชำระค่างวด" />

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-muted rounded-lg p-1 w-fit">
        <button onClick={() => setTab('pending')} className={`px-4 py-2 text-sm rounded-md ${tab === 'pending' ? 'bg-card shadow-card font-medium' : 'text-muted-foreground'}`}>
          รายการรอชำระ
        </button>
        <button onClick={() => setTab('summary')} className={`px-4 py-2 text-sm rounded-md ${tab === 'summary' ? 'bg-card shadow-card font-medium' : 'text-muted-foreground'}`}>
          สรุปรายวัน
        </button>
      </div>

      {/* Pending Tab */}
      {tab === 'pending' && (
        <div>
          {/* Summary Cards */}
          {pendingPayments.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <Card className="border-l-[3px] border-l-primary hover:shadow-card-hover transition-all">
                <CardContent className="p-4">
                  <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">รายการรอชำระ</div>
                  <div className="text-2xl font-bold">{pendingSummary.count}</div>
                </CardContent>
              </Card>
              <Card className="border-l-[3px] border-l-destructive hover:shadow-card-hover transition-all">
                <CardContent className="p-4">
                  <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ยอดรอชำระรวม</div>
                  <div className="text-2xl font-bold text-destructive">{pendingSummary.totalDue.toLocaleString()} ฿</div>
                </CardContent>
              </Card>
              <Card className="border-l-[3px] border-l-primary hover:shadow-card-hover transition-all">
                <CardContent className="p-4">
                  <button onClick={handleExport} className="w-full px-4 py-2 border border-input rounded-lg text-sm font-medium hover:bg-muted">
                    📊 ส่งออก Excel
                  </button>
                </CardContent>
              </Card>
            </div>
          )}

          <div className="flex gap-3 mb-4 flex-wrap">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="ค้นหาเลขสัญญา, ชื่อ, เบอร์โทร..."
              className="px-3 py-2 border border-input rounded-lg text-sm w-72"
            />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-2 border border-input rounded-lg text-sm">
              <option value="">ทุกสถานะ</option>
              <option value="PENDING">รอชำระ</option>
              <option value="OVERDUE">เกินกำหนด</option>
              <option value="PARTIALLY_PAID">ชำระบางส่วน</option>
            </select>
            {isOwner && (
              <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="px-3 py-2 border border-input rounded-lg text-sm">
                <option value="">ทุกสาขา</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            )}
          </div>

          {loadingPending ? (
            <div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div></div>
          ) : (
            <DataTable columns={pendingColumns} data={pendingPayments} emptyMessage="ไม่มีรายการรอชำระ" />
          )}

          {/* Batch action bar */}
          {selectedIds.size > 0 && (
            <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground px-6 py-3 rounded-xl shadow-lg flex items-center gap-4 z-50">
              <span className="text-sm font-medium">เลือก {selectedIds.size} รายการ ({Math.round(batchTotal).toLocaleString()} ฿)</span>
              <button onClick={() => setShowBatchModal(true)} className="px-4 py-1.5 bg-card text-primary rounded-lg text-sm font-medium hover:bg-white/90">
                รับชำระรวม
              </button>
              <button onClick={() => setSelectedIds(new Set())} className="text-xs text-white/70 hover:text-white">ยกเลิก</button>
            </div>
          )}
        </div>
      )}

      {/* Summary Tab */}
      {tab === 'summary' && (
        <div>
          <div className="mb-4">
            <input
              type="date"
              value={summaryDate}
              onChange={(e) => setSummaryDate(e.target.value)}
              className="px-3 py-2 border border-input rounded-lg text-sm"
            />
          </div>

          {loadingSummary ? (
            <div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div></div>
          ) : summary ? (
            <div>
              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 lg:gap-5 mb-6">
                <Card className="hover:shadow-card-hover transition-shadow">
                  <CardContent className="p-5">
                    <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">จำนวนรายการ</div>
                    <div className="text-2xl font-bold">{summary.totalPayments}</div>
                  </CardContent>
                </Card>
                <Card className="hover:shadow-card-hover transition-shadow">
                  <CardContent className="p-5">
                    <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ยอดรวม</div>
                    <div className="text-2xl font-bold text-success">{summary.totalAmount.toLocaleString()} ฿</div>
                  </CardContent>
                </Card>
                <Card className="hover:shadow-card-hover transition-shadow">
                  <CardContent className="p-5">
                    <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ค่าปรับรวม</div>
                    <div className="text-2xl font-bold text-destructive">{summary.totalLateFees.toLocaleString()} ฿</div>
                  </CardContent>
                </Card>
                <Card className="hover:shadow-card-hover transition-shadow">
                  <CardContent className="p-5">
                    <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">แยกตามวิธี</div>
                    {Object.entries(summary.byMethod).map(([method, amount]) => (
                      <div key={method} className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{methodLabels[method] || method}</span>
                        <span className="font-medium">{amount.toLocaleString()} ฿</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>

              {/* Payment List */}
              {summary.data.length > 0 && (
                <Card className="overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted">
                      <tr>
                        <th className="text-left p-3">สัญญา</th>
                        <th className="text-left p-3">ลูกค้า</th>
                        <th className="text-left p-3">งวดที่</th>
                        <th className="text-right p-3">ยอดชำระ</th>
                        <th className="text-left p-3">วิธี</th>
                        <th className="text-left p-3">เวลา</th>
                        <th className="text-left p-3">ผู้บันทึก</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.data.map((p: any) => (
                        <tr key={p.id} className="border-t">
                          <td className="p-3 font-mono text-xs">{p.contract?.contractNumber}</td>
                          <td className="p-3 text-xs">{p.contract?.customer?.name}</td>
                          <td className="p-3">{p.installmentNo}</td>
                          <td className="p-3 text-right font-medium">{Number(p.amountPaid).toLocaleString()} ฿</td>
                          <td className="p-3 text-xs">{methodLabels[p.paymentMethod] || p.paymentMethod}</td>
                          <td className="p-3 text-xs">{p.paidDate ? new Date(p.paidDate).toLocaleTimeString('th-TH') : '-'}</td>
                          <td className="p-3 text-xs">{p.recordedBy?.name || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              )}
            </div>
          ) : null}
        </div>
      )}

      {/* Record Payment Modal */}
      {showPayModal && selectedPayment && (
        <Modal isOpen title="บันทึกการรับชำระ" onClose={() => { setShowPayModal(false); setSelectedPayment(null); setSlipResult(null); setPayForm({ amount: 0, paymentMethod: 'CASH', notes: '' }); }}>
          <div className="flex flex-col gap-5 lg:gap-7.5">
            <div className="bg-muted rounded-lg p-4">
              <div className="text-sm"><span className="text-muted-foreground">สัญญา: </span><span className="font-mono font-medium">{selectedPayment.contract.contractNumber}</span></div>
              <div className="text-sm"><span className="text-muted-foreground">ลูกค้า: </span>{selectedPayment.contract.customer.name}</div>
              <div className="text-sm"><span className="text-muted-foreground">งวดที่: </span>{selectedPayment.installmentNo}</div>
              <div className="text-sm mt-2">
                <span className="text-muted-foreground">ยอดคงค้าง: </span>
                <span className="font-bold text-lg">{(parseFloat(selectedPayment.amountDue) + parseFloat(selectedPayment.lateFee) - parseFloat(selectedPayment.amountPaid)).toLocaleString()} ฿</span>
              </div>
              {parseFloat(selectedPayment.lateFee) > 0 && (
                <div className="text-xs text-destructive mt-1">รวมค่าปรับ {parseFloat(selectedPayment.lateFee).toLocaleString()} ฿</div>
              )}
            </div>

            {/* OCR Slip Scanner */}
            <div className="bg-success/5 dark:bg-success/10 border border-success/20 rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <h4 className="text-sm font-semibold text-success">สแกนสลิปโอนเงิน (OCR)</h4>
              </div>
              <p className="text-xs text-success mb-2">ถ่ายรูปสลิปเพื่อกรอกข้อมูลอัตโนมัติ</p>
              <input
                ref={slipFileRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleSlipScan}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => slipFileRef.current?.click()}
                disabled={ocrSlipLoading}
                className="inline-flex items-center gap-2 px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 disabled:opacity-50"
              >
                {ocrSlipLoading ? (
                  <>
                    <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white" />
                    กำลังอ่านสลิป...
                  </>
                ) : (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                    สแกนสลิป
                  </>
                )}
              </button>

              {/* Show OCR slip result */}
              {slipResult && (
                <div className="mt-2 p-2 rounded border border-success/20 space-y-1">
                  <div className="text-xs text-muted-foreground">ผลการสแกน:</div>
                  {slipResult.amount && <div className="text-xs"><span className="text-muted-foreground">จำนวนเงิน:</span> <span className="font-bold text-success">{slipResult.amount.toLocaleString()} ฿</span></div>}
                  {slipResult.senderName && <div className="text-xs"><span className="text-muted-foreground">ผู้โอน:</span> {slipResult.senderName} {slipResult.senderBank && `(${slipResult.senderBank})`}</div>}
                  {slipResult.receiverName && <div className="text-xs"><span className="text-muted-foreground">ผู้รับ:</span> {slipResult.receiverName} {slipResult.receiverBank && `(${slipResult.receiverBank})`}</div>}
                  {slipResult.transactionRef && <div className="text-xs"><span className="text-muted-foreground">Ref:</span> <span className="font-mono">{slipResult.transactionRef}</span></div>}
                  {slipResult.transactionDate && <div className="text-xs"><span className="text-muted-foreground">วันเวลา:</span> {slipResult.transactionDate} {slipResult.transactionTime || ''}</div>}
                  {slipResult.slipType && <div className="text-xs"><span className="text-muted-foreground">ประเภท:</span> {slipTypeLabels[slipResult.slipType] || slipResult.slipType}</div>}
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1">จำนวนเงินที่รับ</label>
              <input
                type="number"
                value={payForm.amount}
                onChange={(e) => setPayForm({ ...payForm, amount: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-input rounded-lg text-sm"
                min={0}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1">วิธีชำระ</label>
              <select value={payForm.paymentMethod} onChange={(e) => setPayForm({ ...payForm, paymentMethod: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm">
                <option value="CASH">เงินสด</option>
                <option value="BANK_TRANSFER">โอนเงิน</option>
                <option value="QR_EWALLET">QR/E-Wallet</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1">หมายเหตุ</label>
              <input
                type="text"
                value={payForm.notes}
                onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })}
                className="w-full px-3 py-2 border border-input rounded-lg text-sm"
              />
            </div>

            <div className="flex gap-3 pt-2">
              <button onClick={() => { setShowPayModal(false); setSelectedPayment(null); setSlipResult(null); setPayForm({ amount: 0, paymentMethod: 'CASH', notes: '' }); }} className="flex-1 px-4 py-2 text-sm border border-input rounded-lg">ยกเลิก</button>
              <button onClick={handlePay} disabled={recordMutation.isPending || payForm.amount <= 0} className="flex-1 px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
                {recordMutation.isPending ? 'กำลังบันทึก...' : 'ยืนยันรับชำระ'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Batch Payment Modal */}
      {showBatchModal && (
        <Modal isOpen title={`รับชำระรวม ${batchSelectedPayments.length} รายการ`} onClose={() => setShowBatchModal(false)}>
          <div className="flex flex-col gap-4">
            <div className="bg-muted rounded-lg p-4 space-y-2 max-h-48 overflow-y-auto">
              {batchSelectedPayments.map(p => {
                const remaining = parseFloat(p.amountDue) + parseFloat(p.lateFee) - parseFloat(p.amountPaid);
                return (
                  <div key={p.id} className="flex justify-between text-sm">
                    <span>{p.contract.contractNumber} งวด {p.installmentNo}</span>
                    <span className="font-medium">{remaining.toLocaleString()} ฿</span>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between text-base font-bold border-t pt-3">
              <span>ยอดรวม</span>
              <span className="text-primary">{Math.round(batchTotal).toLocaleString()} ฿</span>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">วิธีชำระ</label>
              <select value={batchPayMethod} onChange={(e) => setBatchPayMethod(e.target.value)} className="w-full px-3 py-2 border border-input rounded-lg text-sm">
                <option value="CASH">เงินสด</option>
                <option value="BANK_TRANSFER">โอนเงิน</option>
                <option value="QR_EWALLET">QR/E-Wallet</option>
              </select>
            </div>

            {/* Slip upload for batch - required for non-CASH */}
            {isSlipRequired(batchPayMethod) && (
              <div className="bg-success/5 dark:bg-success/10 border border-success/20 rounded-lg p-3">
                <div className="flex items-center justify-between mb-1">
                  <h4 className="text-sm font-semibold text-success">แนบสลิปโอนเงิน <span className="text-red-500">*</span></h4>
                </div>
                <p className="text-xs text-success mb-2">กรุณาแนบสลิปเพื่อยืนยันการชำระ</p>
                <input ref={batchSlipFileRef} type="file" accept="image/*" capture="environment" onChange={handleBatchSlipScan} className="hidden" />
                <button type="button" onClick={() => batchSlipFileRef.current?.click()} disabled={batchOcrLoading} className="inline-flex items-center gap-2 px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 disabled:opacity-50">
                  {batchOcrLoading ? (
                    <><div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white" /> กำลังอ่านสลิป...</>
                  ) : (
                    <><svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg> สแกนสลิป</>
                  )}
                </button>
                {batchSlipResult && (
                  <div className="mt-2 p-2 rounded border border-success/20 space-y-1">
                    <div className="text-xs text-muted-foreground">ผลการสแกน:</div>
                    {batchSlipResult.amount && <div className="text-xs"><span className="text-muted-foreground">จำนวนเงิน:</span> <span className="font-bold text-success">{batchSlipResult.amount.toLocaleString()} ฿</span></div>}
                    {batchSlipResult.senderName && <div className="text-xs"><span className="text-muted-foreground">ผู้โอน:</span> {batchSlipResult.senderName}</div>}
                    {batchSlipResult.transactionRef && <div className="text-xs"><span className="text-muted-foreground">Ref:</span> <span className="font-mono">{batchSlipResult.transactionRef}</span></div>}
                    {batchSlipResult.transactionDate && <div className="text-xs"><span className="text-muted-foreground">วันเวลา:</span> {batchSlipResult.transactionDate} {batchSlipResult.transactionTime || ''}</div>}
                  </div>
                )}
                {!batchSlipResult && <p className="text-xs text-red-500 mt-1">* จำเป็นต้องแนบสลิปสำหรับการโอนเงิน/QR</p>}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button onClick={() => setShowBatchModal(false)} className="flex-1 px-4 py-2 text-sm border border-input rounded-lg">ยกเลิก</button>
              <button onClick={handleBatchPay} disabled={batchMutation.isPending || (isSlipRequired(batchPayMethod) && !batchSlipResult)} className="flex-1 px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
                {batchMutation.isPending ? 'กำลังชำระ...' : `ยืนยันชำระ ${batchSelectedPayments.length} รายการ`}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Advance Payment Modal */}
      {showAdvanceModal && advanceContract && (
        <Modal isOpen title="จ่ายล่วงหน้าหลายงวด" onClose={() => { setShowAdvanceModal(false); setAdvanceContract(null); }}>
          <div className="flex flex-col gap-4">
            <div className="bg-muted rounded-lg p-4">
              <div className="text-sm"><span className="text-muted-foreground">สัญญา: </span><span className="font-mono font-medium">{advanceContract.contract.contractNumber}</span></div>
              <div className="text-sm"><span className="text-muted-foreground">ลูกค้า: </span>{advanceContract.contract.customer.name}</div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">จำนวนเงินรวมที่ต้องการจ่าย</label>
              <input type="number" value={advanceAmount} onChange={(e) => setAdvanceAmount(e.target.value)} className="w-full px-3 py-2 border border-input rounded-lg text-sm" placeholder="ใส่ยอดรวม ระบบจะจัดสรรให้หลายงวดอัตโนมัติ" />
              <p className="text-xs text-muted-foreground mt-1">ระบบจะจัดสรรเงินให้งวดที่ค้างตามลำดับอัตโนมัติ</p>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">วิธีชำระ</label>
              <select value={advanceMethod} onChange={(e) => setAdvanceMethod(e.target.value)} className="w-full px-3 py-2 border border-input rounded-lg text-sm">
                <option value="CASH">เงินสด</option>
                <option value="BANK_TRANSFER">โอนเงิน</option>
                <option value="QR_EWALLET">QR/E-Wallet</option>
              </select>
            </div>

            {/* Slip upload for advance - required for non-CASH */}
            {isSlipRequired(advanceMethod) && (
              <div className="bg-success/5 dark:bg-success/10 border border-success/20 rounded-lg p-3">
                <div className="flex items-center justify-between mb-1">
                  <h4 className="text-sm font-semibold text-success">แนบสลิปโอนเงิน <span className="text-red-500">*</span></h4>
                </div>
                <p className="text-xs text-success mb-2">กรุณาแนบสลิปเพื่อยืนยันการชำระ</p>
                <input ref={advanceSlipFileRef} type="file" accept="image/*" capture="environment" onChange={handleAdvanceSlipScan} className="hidden" />
                <button type="button" onClick={() => advanceSlipFileRef.current?.click()} disabled={advanceOcrLoading} className="inline-flex items-center gap-2 px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 disabled:opacity-50">
                  {advanceOcrLoading ? (
                    <><div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white" /> กำลังอ่านสลิป...</>
                  ) : (
                    <><svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg> สแกนสลิป</>
                  )}
                </button>
                {advanceSlipResult && (
                  <div className="mt-2 p-2 rounded border border-success/20 space-y-1">
                    <div className="text-xs text-muted-foreground">ผลการสแกน:</div>
                    {advanceSlipResult.amount && <div className="text-xs"><span className="text-muted-foreground">จำนวนเงิน:</span> <span className="font-bold text-success">{advanceSlipResult.amount.toLocaleString()} ฿</span></div>}
                    {advanceSlipResult.senderName && <div className="text-xs"><span className="text-muted-foreground">ผู้โอน:</span> {advanceSlipResult.senderName}</div>}
                    {advanceSlipResult.transactionRef && <div className="text-xs"><span className="text-muted-foreground">Ref:</span> <span className="font-mono">{advanceSlipResult.transactionRef}</span></div>}
                    {advanceSlipResult.transactionDate && <div className="text-xs"><span className="text-muted-foreground">วันเวลา:</span> {advanceSlipResult.transactionDate} {advanceSlipResult.transactionTime || ''}</div>}
                  </div>
                )}
                {!advanceSlipResult && <p className="text-xs text-red-500 mt-1">* จำเป็นต้องแนบสลิปสำหรับการโอนเงิน/QR</p>}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button onClick={() => { setShowAdvanceModal(false); setAdvanceContract(null); setAdvanceSlipResult(null); }} className="flex-1 px-4 py-2 text-sm border border-input rounded-lg">ยกเลิก</button>
              <button
                onClick={() => {
                  if (isSlipRequired(advanceMethod) && !advanceSlipResult) {
                    toast.error('กรุณาแนบสลิปก่อนยืนยันการชำระ');
                    return;
                  }
                  advanceMutation.mutate({
                    contractId: advanceContract.contract.id,
                    amount: parseFloat(advanceAmount) || 0,
                    paymentMethod: advanceMethod,
                    transactionRef: advanceSlipResult?.transactionRef || `ADV-${Date.now()}`,
                  } as any);
                }}
                disabled={advanceMutation.isPending || !advanceAmount || parseFloat(advanceAmount) <= 0 || (isSlipRequired(advanceMethod) && !advanceSlipResult)}
                className="flex-1 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
              >
                {advanceMutation.isPending ? 'กำลังจัดสรร...' : 'ยืนยันจ่ายล่วงหน้า'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Payment History Sheet */}
      <PaymentHistorySheet
        contractId={historyContractId}
        onClose={() => setHistoryContractId(null)}
        onViewReceipt={(id) => setReceiptId(id)}
      />

      {/* Receipt Modal */}
      <ReceiptModal
        receiptId={receiptId}
        onClose={() => setReceiptId(null)}
      />
    </div>
  );
}
