import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import Decimal from 'decimal.js';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useSearchParams } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import SlipReviewTab from '@/components/payment/SlipReviewTab';
import ReceiptsTab from './components/ReceiptsTab';
import { compressImageForOcr } from '@/lib/compressImage';
import { useDebounce } from '@/hooks/useDebounce';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import PaymentHistorySheet from '@/components/payment/PaymentHistorySheet';
import { toast } from 'sonner';
import { exportToExcel } from '@/utils/excel.util';
import { Upload, Camera } from 'lucide-react';
import PaymentFilters from './components/PaymentFilters';
import PaymentTable from './components/PaymentTable';
import PaymentSummary from './components/PaymentSummary';
import { RecordPaymentModal, BatchPaymentModal } from './components/PaymentModals';
import { RecordPaymentWizard } from './components/RecordPaymentWizard';
import { ToleranceApprovalDialog } from '@/components/ToleranceApprovalDialog';
import type { PendingPayment, DailySummary, OcrPaymentSlipResult } from './types';
import { paymentStatusLabels, isSlipRequired } from './types';

export default function PaymentsPage() {
  useDocumentTitle('ชำระเงิน');
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isOwner = user?.role === 'OWNER';
  const canSeeReceipts = user && ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT'].includes(user.role);
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = (searchParams.get('tab') || 'pending') as 'pending' | 'summary' | 'slip-review' | 'receipts';
  const setTab = (value: 'pending' | 'summary' | 'slip-review' | 'receipts') => setSearchParams({ tab: value });

  // Redirect SALES users away from receipts tab (no permission)
  useEffect(() => {
    if (tab === 'receipts' && !canSeeReceipts) {
      setSearchParams({ tab: 'pending' });
    }
  }, [tab, canSeeReceipts, setSearchParams]);

  const [statusFilter, setStatusFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearch = useDebounce(searchTerm, 400);
  const [summaryDate, setSummaryDate] = useState(new Date().toISOString().split('T')[0]);

  // History sheet state
  const [historyContractId, setHistoryContractId] = useState<string | null>(null);
  const [showPayModal, setShowPayModal] = useState(false);
  const [showPayWizard, setShowPayWizard] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<PendingPayment | null>(null);
  const [payForm, setPayForm] = useState({ amount: 0, paymentMethod: 'CASH', notes: '', paidDate: new Date().toISOString().split('T')[0] });
  // T15: deposit account code for the payment journal Dr leg; defaults to user preference or system default
  const [depositAccountCode, setDepositAccountCode] = useState<string>(
    user?.defaultCashAccountCode ?? '11-1101',
  );

  // Batch selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchPayMethod, setBatchPayMethod] = useState('CASH');

  // OCR slip state
  const slipFileRef = useRef<HTMLInputElement>(null);
  const [ocrSlipLoading, setOcrSlipLoading] = useState(false);
  const [slipResult, setSlipResult] = useState<OcrPaymentSlipResult | null>(null);

  // Batch slip state
  const batchSlipFileRef = useRef<HTMLInputElement>(null);
  const [batchOcrLoading, setBatchOcrLoading] = useState(false);
  const [batchSlipResult, setBatchSlipResult] = useState<OcrPaymentSlipResult | null>(null);

  // T16: Tolerance approval dialog state
  const [showToleranceDialog, setShowToleranceDialog] = useState(false);
  const [pendingPayload, setPendingPayload] = useState<Record<string, unknown> | null>(null);

  // Quick scan slip (top-level)
  const quickSlipFileRef = useRef<HTMLInputElement>(null);
  const [quickOcrLoading, setQuickOcrLoading] = useState(false);

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
  const {
    data: pendingPayments = [],
    isLoading: loadingPending,
    isError: pendingError,
    error: pendingErrorDetail,
    refetch: refetchPending,
  } = useQuery<PendingPayment[]>({
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
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
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
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  // Pending summary totals — Decimal arithmetic, single number convert at end
  // (audit finding P0). Otherwise per-row parseFloat drift accumulates across
  // hundreds of rows.
  const pendingSummary = useMemo(() => ({
    count: pendingPayments.length,
    totalDue: pendingPayments
      .reduce(
        (sum, p) =>
          sum
            .add(p.amountDue)
            .add(p.lateFee)
            .sub(p.amountPaid),
        new Decimal(0),
      )
      .toDecimalPlaces(2)
      .toNumber(),
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
    batchSelectedPayments
      .reduce(
        (sum, p) =>
          sum
            .add(p.amountDue)
            .add(p.lateFee)
            .sub(p.amountPaid),
        new Decimal(0),
      )
      .toDecimalPlaces(2)
      .toNumber(),
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
    setPayForm({ amount: Math.round(remaining * 100) / 100, paymentMethod: 'CASH', notes: '', paidDate: new Date().toISOString().split('T')[0] });
    setDepositAccountCode(user?.defaultCashAccountCode ?? '11-1101');
    setSlipResult(null);
    // Open the new wizard UI
    setShowPayWizard(true);
  }, [user?.defaultCashAccountCode]);

  const handlePay = () => {
    if (!selectedPayment || payForm.amount <= 0) return;
    const remaining = new Decimal(selectedPayment.amountDue)
      .add(selectedPayment.lateFee)
      .sub(selectedPayment.amountPaid)
      .toDecimalPlaces(2)
      .toNumber();

    if (payForm.amount > Math.round(remaining * 100) / 100) {
      toast.error(`จำนวนเงินไม่ควรเกินยอดคงค้าง ${remaining.toLocaleString()} ฿`);
      return;
    }

    const payload: Record<string, unknown> = {
      contractId: selectedPayment.contract.id,
      installmentNo: selectedPayment.installmentNo,
      amount: payForm.amount,
      paymentMethod: payForm.paymentMethod,
      notes: payForm.notes || undefined,
      transactionRef: slipResult?.transactionRef || `${payForm.paymentMethod}-${Date.now()}`,
      depositAccountCode,
    };

    // T16: Tolerance gate — diff 0.01–1.00 ฿ requires approval; > 1.00 ฿ is blocked
    const diff = new Decimal(payForm.amount).sub(remaining).toDecimalPlaces(2).toNumber();
    const absDiff = Math.abs(diff);
    if (absDiff > 1.0) {
      toast.error(`ส่วนต่างเกิน 1 ฿ (${absDiff.toFixed(2)} ฿) ไม่สามารถอนุมัติได้ กรุณาแก้ไขจำนวนเงิน`);
      return;
    }
    if (absDiff >= 0.01) {
      // Pause: ask approver to confirm before submitting
      setPendingPayload(payload);
      setShowToleranceDialog(true);
      return;
    }

    recordMutation.mutate(payload);
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
    } catch (err: unknown) {
      const axiosErr = err as { code?: string; response?: unknown };
      if (axiosErr.code === 'ECONNABORTED' || !axiosErr.response) {
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

  // Quick slip scan — opens the slip-review tab with the scanned result
  const handleQuickSlipScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await scanSlip(file, setQuickOcrLoading, () => {}, quickSlipFileRef, () => {
      // Navigate to slip-review tab after successful scan
      setTab('slip-review');
      toast.success('สลิปถูกส่งไปตรวจสอบแล้ว');
    });
  };

  return (
    <div>
      <PageHeader
        title="ชำระเงิน"
        subtitle="บันทึกการรับชำระค่างวด"
        action={
          <div className="flex items-center gap-2">
            <input
              ref={quickSlipFileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleQuickSlipScan}
            />
            <button
              onClick={() => quickSlipFileRef.current?.click()}
              disabled={quickOcrLoading}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors shadow-sm disabled:opacity-50"
            >
              {quickOcrLoading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-foreground" />
                  กำลังสแกนสลิป...
                </>
              ) : (
                <>
                  <Camera className="size-4" />
                  สแกนสลิป
                </>
              )}
            </button>
            <button
              onClick={() => setTab('slip-review')}
              className="inline-flex items-center gap-2 px-4 py-2.5 border border-input rounded-lg text-sm font-medium hover:bg-muted transition-colors"
            >
              <Upload className="size-4" />
              ตรวจสอบสลิป
            </button>
          </div>
        }
      />

      {/* Tabs — Metronic segment tabs */}
      <div className="flex gap-0 mb-5 border-b border-border/60">
        <button
          onClick={() => setTab('pending')}
          className={`px-5 py-3 text-sm font-medium border-b-2 -mb-px transition-all ${tab === 'pending' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          รายการรอชำระ
          {pendingSummary.count > 0 && (
            <span className={`ml-2 text-xs px-1.5 py-0.5 rounded-full ${tab === 'pending' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
              {pendingSummary.count}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab('summary')}
          className={`px-5 py-3 text-sm font-medium border-b-2 -mb-px transition-all ${tab === 'summary' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          สรุปรายวัน
        </button>
        <button
          onClick={() => setTab('slip-review')}
          className={`px-5 py-3 text-sm font-medium border-b-2 -mb-px transition-all ${tab === 'slip-review' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          ตรวจสอบสลิป
        </button>
        {canSeeReceipts && (
          <button
            onClick={() => setTab('receipts')}
            className={`px-5 py-3 text-sm font-medium border-b-2 -mb-px transition-all ${tab === 'receipts' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            ใบเสร็จ
          </button>
        )}
      </div>

      {/* Pending Tab */}
      {tab === 'pending' && (
        <div>
          <PaymentFilters
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            branchFilter={branchFilter}
            onBranchFilterChange={setBranchFilter}
            isOwner={isOwner}
            branches={branches}
            pendingCount={pendingSummary.count}
            pendingTotalDue={pendingSummary.totalDue}
            onExport={handleExport}
            hasPendingPayments={pendingPayments.length > 0}
          />

          <QueryBoundary
            isLoading={loadingPending && pendingPayments.length === 0}
            isError={pendingError}
            error={pendingErrorDetail}
            onRetry={refetchPending}
            errorTitle="ไม่สามารถโหลดรายการค้างชำระได้"
          >
            <PaymentTable
              pendingPayments={pendingPayments}
              loadingPending={loadingPending}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              onToggleAll={toggleAll}
              onOpenPayModal={openPayModal}
              onViewHistory={(contractId) => setHistoryContractId(contractId)}
              batchTotal={batchTotal}
              onShowBatchModal={() => setShowBatchModal(true)}
              onClearSelection={() => setSelectedIds(new Set())}
            />
          </QueryBoundary>
        </div>
      )}

      {/* Summary Tab */}
      {tab === 'summary' && (
        <PaymentSummary
          summaryDate={summaryDate}
          onDateChange={setSummaryDate}
          summary={summary}
          loadingSummary={loadingSummary}
        />
      )}

      {/* Record Payment Wizard (new 4-step UI with live JE preview) */}
      {showPayWizard && selectedPayment && (
        <RecordPaymentWizard
          open={showPayWizard}
          payment={selectedPayment}
          onClose={() => { setShowPayWizard(false); setSelectedPayment(null); }}
          onSubmit={(payload) => {
            const remaining = new Decimal(selectedPayment.amountDue)
              .add(selectedPayment.lateFee)
              .sub(selectedPayment.amountPaid)
              .toDecimalPlaces(2)
              .toNumber();
            const diff = new Decimal(payload.amount).sub(remaining).toDecimalPlaces(2).toNumber();
            const absDiff = Math.abs(diff);
            if (absDiff > 1.0) {
              toast.error(`ส่วนต่างเกิน 1 ฿ (${absDiff.toFixed(2)} ฿) ไม่สามารถอนุมัติได้ กรุณาแก้ไขจำนวนเงิน`);
              return;
            }
            const mutationPayload: Record<string, unknown> = {
              contractId: payload.contractId,
              installmentNo: payload.installmentNo,
              amount: payload.amount,
              paymentMethod: payload.paymentMethod,
              depositAccountCode: payload.depositAccountCode,
              // Step 3 fields: use referenceNumber if provided, else fallback timestamp ref
              transactionRef: payload.referenceNumber || `${payload.paymentMethod}-${Date.now()}`,
              wizardMethod: payload.wizardMethod,
              referenceNumber: payload.referenceNumber,
              slipUrl: payload.slipUrl,
              memo: payload.memo,
              case: payload.case,
            };
            if (absDiff >= 0.01) {
              setPendingPayload(mutationPayload);
              setShowToleranceDialog(true);
              return;
            }
            recordMutation.mutate(mutationPayload);
            setShowPayWizard(false);
            setSelectedPayment(null);
          }}
          isSubmitting={recordMutation.isPending}
          defaultDepositAccountCode={user?.defaultCashAccountCode ?? '11-1101'}
        />
      )}

      {/* Record Payment Modal (legacy) */}
      <RecordPaymentModal
        show={showPayModal}
        payment={selectedPayment}
        payForm={payForm}
        onPayFormChange={setPayForm}
        onClose={() => { setShowPayModal(false); setSelectedPayment(null); setSlipResult(null); setPayForm({ amount: 0, paymentMethod: 'CASH', notes: '', paidDate: new Date().toISOString().split('T')[0] }); }}
        onSubmit={handlePay}
        isPending={recordMutation.isPending}
        slipFileRef={slipFileRef}
        onSlipScan={handleSlipScan}
        ocrSlipLoading={ocrSlipLoading}
        slipResult={slipResult}
        depositAccountCode={depositAccountCode}
        onDepositAccountCodeChange={setDepositAccountCode}
      />

      {/* Batch Payment Modal */}
      <BatchPaymentModal
        show={showBatchModal}
        onClose={() => setShowBatchModal(false)}
        batchSelectedPayments={batchSelectedPayments}
        batchTotal={batchTotal}
        batchPayMethod={batchPayMethod}
        onBatchPayMethodChange={setBatchPayMethod}
        onSubmit={handleBatchPay}
        isPending={batchMutation.isPending}
        batchSlipFileRef={batchSlipFileRef}
        onBatchSlipScan={handleBatchSlipScan}
        batchOcrLoading={batchOcrLoading}
        batchSlipResult={batchSlipResult}
      />

      {/* Slip Review Tab */}
      {tab === 'slip-review' && <SlipReviewTab />}

      {/* Receipts Tab */}
      {tab === 'receipts' && canSeeReceipts && <ReceiptsTab />}

      {/* Payment History Sheet */}
      <PaymentHistorySheet
        contractId={historyContractId}
        onClose={() => setHistoryContractId(null)}
      />

      {/* T16: Tolerance Approval Dialog */}
      {showToleranceDialog && pendingPayload && selectedPayment && (() => {
        const remaining = new Decimal(selectedPayment.amountDue)
          .add(selectedPayment.lateFee)
          .sub(selectedPayment.amountPaid)
          .toDecimalPlaces(2)
          .toNumber();
        const diff = new Decimal(pendingPayload.amount as number).sub(remaining).toDecimalPlaces(2).toNumber();
        return (
          <ToleranceApprovalDialog
            open={showToleranceDialog}
            onOpenChange={setShowToleranceDialog}
            diff={diff}
            amountReceived={pendingPayload.amount as number}
            outstanding={remaining}
            onApprove={(approverId) => {
              setShowToleranceDialog(false);
              recordMutation.mutate({ ...pendingPayload, toleranceApproverId: approverId });
              setPendingPayload(null);
            }}
            onCancel={() => {
              setShowToleranceDialog(false);
              setPendingPayload(null);
            }}
          />
        );
      })()}
    </div>
  );
}
