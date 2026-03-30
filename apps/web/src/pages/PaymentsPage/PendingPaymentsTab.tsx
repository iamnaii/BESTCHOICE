/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo, useCallback, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useDebounce } from '@/hooks/useDebounce';
import { Card, CardContent } from '@/components/ui/card';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { toast } from 'sonner';
import { exportToExcel } from '@/utils/excel.util';
import SlipScanner from './SlipScanner';
import RecordPaymentModal from './RecordPaymentModal';
import { usePaymentOcr } from './hooks/usePaymentOcr';
import { PAYMENT_STATUS_LABELS as paymentStatusLabels } from '@/constants/statusLabels';

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


interface PendingPaymentsTabProps {
  onViewHistory: (contractId: string) => void;
}

export default function PendingPaymentsTab({ onViewHistory }: PendingPaymentsTabProps) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isOwner = user?.role === 'OWNER';
  const [statusFilter, setStatusFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearch = useDebounce(searchTerm, 400);

  const [showPayModal, setShowPayModal] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<PendingPayment | null>(null);

  // Batch selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchPayMethod, setBatchPayMethod] = useState('CASH');

  // Advance payment state
  const [showAdvanceModal, setShowAdvanceModal] = useState(false);
  const [advanceContract, setAdvanceContract] = useState<PendingPayment | null>(null);
  const [advanceAmount, setAdvanceAmount] = useState('');
  const [advanceMethod, setAdvanceMethod] = useState('CASH');

  // OCR hooks for batch and advance
  const batchOcr = usePaymentOcr((data) => {
    if (data.slipType === 'QR_PAYMENT' || data.slipType === 'PROMPTPAY') {
      setBatchPayMethod('QR_EWALLET');
    } else if (data.slipType) {
      setBatchPayMethod('BANK_TRANSFER');
    }
  });

  const advanceOcr = usePaymentOcr((data) => {
    if (data.amount && data.amount > 0) setAdvanceAmount(String(data.amount));
    if (data.slipType === 'QR_PAYMENT' || data.slipType === 'PROMPTPAY') {
      setAdvanceMethod('QR_EWALLET');
    } else if (data.slipType) {
      setAdvanceMethod('BANK_TRANSFER');
    }
  });

  const { data: branches = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['branches'],
    queryFn: async () => { const { data } = await api.get('/branches'); return data; },
    enabled: isOwner,
  });

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
  });

  const invalidatePayments = () => {
    queryClient.invalidateQueries({ queryKey: ['pending-payments'] });
    queryClient.invalidateQueries({ queryKey: ['daily-summary'] });
  };

  const recordMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const { data } = await api.post('/payments/record', body);
      return data;
    },
    onSuccess: () => {
      toast.success('บันทึกการชำระสำเร็จ');
      invalidatePayments();
      setShowPayModal(false);
      setSelectedPayment(null);
    },
    onError: (err: any) => toast.error(getErrorMessage(err)),
  });

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
      invalidatePayments();
      setSelectedIds(new Set());
      setShowBatchModal(false);
      batchOcr.reset();
    },
    onError: (err: any) => toast.error(getErrorMessage(err)),
  });

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
      invalidatePayments();
      setShowAdvanceModal(false);
      setAdvanceContract(null);
      setAdvanceAmount('');
      advanceOcr.reset();
    },
    onError: (err: any) => toast.error(getErrorMessage(err)),
  });

  const pendingSummary = useMemo(() => ({
    count: pendingPayments.length,
    totalDue: pendingPayments.reduce((sum, p) => sum + parseFloat(p.amountDue) + parseFloat(p.lateFee) - parseFloat(p.amountPaid), 0),
  }), [pendingPayments]);

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

  const batchSelectedPayments = useMemo(() => pendingPayments.filter(p => selectedIds.has(p.id)), [pendingPayments, selectedIds]);
  const batchTotal = useMemo(() => batchSelectedPayments.reduce((sum, p) => sum + parseFloat(p.amountDue) + parseFloat(p.lateFee) - parseFloat(p.amountPaid), 0), [batchSelectedPayments]);

  const isSlipRequired = (method: string) => method !== 'CASH';

  const handleBatchPay = () => {
    if (isSlipRequired(batchPayMethod) && !batchOcr.result) {
      toast.error('กรุณาแนบสลิปก่อนยืนยันการชำระ');
      return;
    }
    const batchRef = batchOcr.result?.transactionRef || `BATCH-${Date.now()}`;
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
    setShowPayModal(true);
  }, []);

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
      return <span className={`text-sm ${isOverdue ? 'text-red-600 font-medium' : ''}`}>{new Date(p.dueDate).toLocaleDateString('th-TH')}</span>;
    }},
    { key: 'amountDue', label: 'ยอดที่ต้องชำระ', render: (p: PendingPayment) => {
      const total = parseFloat(p.amountDue) + parseFloat(p.lateFee);
      return <span className="text-sm font-medium">{total.toLocaleString()} ฿</span>;
    }},
    { key: 'amountPaid', label: 'ชำระแล้ว', render: (p: PendingPayment) => {
      const paid = parseFloat(p.amountPaid);
      return paid > 0 ? <span className="text-sm text-green-600">{paid.toLocaleString()} ฿</span> : <span className="text-xs text-muted-foreground">-</span>;
    }},
    { key: 'lateFee', label: 'ค่าปรับ', render: (p: PendingPayment) => {
      const fee = parseFloat(p.lateFee);
      return fee > 0 ? <span className="text-sm text-red-600">{fee.toLocaleString()} ฿</span> : <span className="text-xs text-muted-foreground">-</span>;
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
          <button onClick={() => openPayModal(p)} className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700">รับชำระ</button>
          <button onClick={() => { setAdvanceContract(p); setAdvanceAmount(''); setAdvanceMethod('CASH'); setShowAdvanceModal(true); }} className="px-2 py-1 text-xs border border-primary text-primary rounded hover:bg-primary/10">ล่วงหน้า</button>
          <button onClick={() => onViewHistory(p.contract.id)} className="px-2 py-1 text-xs border border-muted-foreground/30 text-muted-foreground rounded hover:bg-muted">ประวัติ</button>
        </div>
      ),
    },
  ], [openPayModal, selectedIds, pendingPayments.length, toggleAll, toggleSelect, onViewHistory]);

  return (
    <div>
      {pendingPayments.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground mb-1">รายการรอชำระ</div><div className="text-2xl font-bold">{pendingSummary.count}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground mb-1">ยอดรอชำระรวม</div><div className="text-2xl font-bold text-red-600">{pendingSummary.totalDue.toLocaleString()} ฿</div></CardContent></Card>
          <Card><CardContent className="p-4"><button onClick={handleExport} className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">📊 Export Excel</button></CardContent></Card>
        </div>
      )}

      <div className="flex gap-3 mb-4 flex-wrap">
        <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="ค้นหาเลขสัญญา, ชื่อ, เบอร์โทร..." className="px-3 py-2 border border-input rounded-lg text-sm w-72" />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-2 border border-input rounded-lg text-sm">
          <option value="">ทุกสถานะ</option>
          <option value="PENDING">รอชำระ</option>
          <option value="OVERDUE">เกินกำหนด</option>
          <option value="PARTIALLY_PAID">ชำระบางส่วน</option>
        </select>
        {isOwner && (
          <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="px-3 py-2 border border-input rounded-lg text-sm">
            <option value="">ทุกสาขา</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
      </div>

      {loadingPending ? (
        <div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div></div>
      ) : (
        <DataTable columns={pendingColumns} data={pendingPayments} emptyMessage="ไม่มีรายการรอชำระ" />
      )}

      {selectedIds.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground px-6 py-3 rounded-xl shadow-lg flex items-center gap-4 z-50">
          <span className="text-sm font-medium">เลือก {selectedIds.size} รายการ ({Math.round(batchTotal).toLocaleString()} ฿)</span>
          <button onClick={() => setShowBatchModal(true)} className="px-4 py-1.5 bg-white text-primary rounded-lg text-sm font-medium hover:bg-white/90">รับชำระรวม</button>
          <button onClick={() => setSelectedIds(new Set())} className="text-xs text-white/70 hover:text-white">ยกเลิก</button>
        </div>
      )}

      {/* Record Payment Modal */}
      {showPayModal && selectedPayment && (
        <RecordPaymentModal
          payment={selectedPayment}
          onClose={() => { setShowPayModal(false); setSelectedPayment(null); }}
          onSubmit={(body) => recordMutation.mutate(body)}
          isPending={recordMutation.isPending}
        />
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
            {isSlipRequired(batchPayMethod) && (
              <SlipScanner fileRef={batchOcr.fileRef} loading={batchOcr.loading} result={batchOcr.result} onScan={batchOcr.handleScan} required />
            )}
            <div className="flex gap-3 pt-2">
              <button onClick={() => setShowBatchModal(false)} className="flex-1 px-4 py-2 text-sm border border-input rounded-lg">ยกเลิก</button>
              <button onClick={handleBatchPay} disabled={batchMutation.isPending || (isSlipRequired(batchPayMethod) && !batchOcr.result)} className="flex-1 px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
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
            {isSlipRequired(advanceMethod) && (
              <SlipScanner fileRef={advanceOcr.fileRef} loading={advanceOcr.loading} result={advanceOcr.result} onScan={advanceOcr.handleScan} required />
            )}
            <div className="flex gap-3 pt-2">
              <button onClick={() => { setShowAdvanceModal(false); setAdvanceContract(null); advanceOcr.reset(); }} className="flex-1 px-4 py-2 text-sm border border-input rounded-lg">ยกเลิก</button>
              <button
                onClick={() => {
                  if (isSlipRequired(advanceMethod) && !advanceOcr.result) {
                    toast.error('กรุณาแนบสลิปก่อนยืนยันการชำระ');
                    return;
                  }
                  advanceMutation.mutate({
                    contractId: advanceContract.contract.id,
                    amount: parseFloat(advanceAmount) || 0,
                    paymentMethod: advanceMethod,
                    transactionRef: advanceOcr.result?.transactionRef || `ADV-${Date.now()}`,
                  } as any);
                }}
                disabled={advanceMutation.isPending || !advanceAmount || parseFloat(advanceAmount) <= 0 || (isSlipRequired(advanceMethod) && !advanceOcr.result)}
                className="flex-1 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
              >
                {advanceMutation.isPending ? 'กำลังจัดสรร...' : 'ยืนยันจ่ายล่วงหน้า'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
