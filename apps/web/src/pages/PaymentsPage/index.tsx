import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import Decimal from 'decimal.js';
import { paymentToleranceGate } from './paymentToleranceGate';
import { invalidatePaymentQueries } from './invalidatePaymentQueries';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useSearchParams } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import { toLocalDateString } from '@/lib/date';
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
import PaymentPeriodBar from './components/PaymentPeriodBar';
import PaymentKpiCards from './components/PaymentKpiCards';
import { RecordPaymentModal, BatchPaymentModal } from './components/PaymentModals';
import { RecordPaymentWizard, type WizardSubmitPayload } from './components/RecordPaymentWizard';
import { ToleranceApprovalDialog } from '@/components/ToleranceApprovalDialog';
import type { PendingPayment, DailySummary, PendingSummary, OcrPaymentSlipResult, VoidedReceiptInfo } from './types';
import { paymentStatusLabels, isSlipRequired } from './types';

export default function PaymentsPage() {
  useDocumentTitle('ชำระเงิน');
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isOwner = user?.role === 'OWNER';
  const canSeeReceipts = user && ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT'].includes(user.role);
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = (searchParams.get('tab') || 'pending') as 'pending' | 'paid' | 'summary' | 'slip-review' | 'receipts';
  const setTab = (value: 'pending' | 'paid' | 'summary' | 'slip-review' | 'receipts') => setSearchParams({ tab: value });

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
  // LOCAL date, not toISOString() — the UTC day is still yesterday before 07:00 BKK (PR #1327 bug class).
  const [summaryDate, setSummaryDate] = useState(toLocalDateString());

  // Period filter for the pending queue (KPI cards + list) — scopes everything
  // by installment dueDate. Default is "เดือนนี้" (matches DateRangeChips'
  // thisMonth preset: the FULL calendar month, owner 2026-07-02) so that chip
  // reads active on load AND installments due later this month stay visible.
  // NOTE: a month default hides installments due in earlier months from the
  // queue — switch to "ทั้งหมด" to chase back-dated overdue.
  const [startDate, setStartDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [endDate, setEndDate] = useState(() => {
    const now = new Date();
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
  });
  const dueFrom = startDate || undefined;
  const dueTo = endDate || undefined;

  // Title for the "collected" KPI card follows the chosen period.
  const collectedLabel = useMemo(() => {
    const toIso = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const today = new Date();
    const thisFirst = toIso(new Date(today.getFullYear(), today.getMonth(), 1));
    // Full-month end — matches the DateRangeChips thisMonth preset (owner 2026-07-02).
    const thisEnd = toIso(new Date(today.getFullYear(), today.getMonth() + 1, 0));
    const lastFirst = toIso(new Date(today.getFullYear(), today.getMonth() - 1, 1));
    const lastEnd = toIso(new Date(today.getFullYear(), today.getMonth(), 0));
    if (!startDate && !endDate) return 'รับชำระทั้งหมด';
    if (startDate === thisFirst && endDate === thisEnd) return 'รับชำระเดือนนี้';
    if (startDate === lastFirst && endDate === lastEnd) return 'รับชำระเดือนที่แล้ว';
    return 'รับชำระช่วงนี้';
  }, [startDate, endDate]);

  // History sheet state
  const [historyContractId, setHistoryContractId] = useState<string | null>(null);
  const [showPayModal, setShowPayModal] = useState(false);
  const [showPayWizard, setShowPayWizard] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<PendingPayment | null>(null);
  // paidDate = LOCAL date (money-impacting: toISOString() records YESTERDAY before 07:00 BKK).
  const [payForm, setPayForm] = useState({ amount: 0, paymentMethod: 'CASH', notes: '', paidDate: toLocalDateString() });
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
    queryKey: ['pending-payments', statusFilter, debouncedSearch, branchFilter, dueFrom, dueTo],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (branchFilter) params.set('branchId', branchFilter);
      if (dueFrom) params.set('dueFrom', dueFrom);
      if (dueTo) params.set('dueTo', dueTo);
      const { data } = await api.get(`/payments/pending?${params}`);
      return data.data;
    },
    enabled: tab === 'pending',
  });

  // ชำระครบ tab — same endpoint/filters as the pending queue but pinned to
  // status=PAID (the endpoint's status param overrides the default
  // PENDING/OVERDUE/PARTIALLY_PAID set). Server keeps the STORED (net-of-
  // waiver) late fee for PAID rows — the fee actually charged, not a live
  // recompute. Unlike the shrinking pending queue, the paid set grows all
  // month, so ask for the service max (100) and keep `total` to surface
  // truncation instead of silently dropping rows.
  const {
    data: paidResult,
    isLoading: loadingPaid,
    isError: paidError,
    error: paidErrorDetail,
    refetch: refetchPaid,
  } = useQuery<{ rows: PendingPayment[]; total: number }>({
    queryKey: ['paid-payments', debouncedSearch, branchFilter, dueFrom, dueTo],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('status', 'PAID');
      params.set('limit', '100');
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (branchFilter) params.set('branchId', branchFilter);
      if (dueFrom) params.set('dueFrom', dueFrom);
      if (dueTo) params.set('dueTo', dueTo);
      const { data } = await api.get(`/payments/pending?${params}`);
      return { rows: data.data ?? [], total: data.total ?? (data.data?.length || 0) };
    },
    enabled: tab === 'paid',
  });
  const paidPayments = paidResult?.rows ?? [];
  const paidTotal = paidResult?.total ?? 0;
  const paidTruncated = paidTotal > paidPayments.length;

  // Whole-system KPI summary (6 cards) — scoped by the same dueDate window +
  // branch as the queue, but NOT page-limited.
  const { data: pendingKpi, isLoading: loadingKpi } = useQuery<PendingSummary>({
    queryKey: ['pending-summary', branchFilter, dueFrom, dueTo],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (branchFilter) params.set('branchId', branchFilter);
      if (dueFrom) params.set('dueFrom', dueFrom);
      if (dueTo) params.set('dueTo', dueTo);
      const { data } = await api.get(`/payments/pending-summary?${params}`);
      return data;
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
      invalidatePaymentQueries(queryClient);
      setShowPayModal(false);
      setSelectedPayment(null);
      setSlipResult(null);
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  // Phase 4 — draft/post split mutations. Shared body builder so "บันทึกร่าง" and
  // the dirty save-then-post path serialize the wizard payload identically. No
  // Date.now() ref fallback here (unlike record) — a draft's reference stays what
  // the cashier typed so re-hydrating the form doesn't surface machine noise.
  const draftBodyFromPayload = (payload: WizardSubmitPayload): Record<string, unknown> => ({
    contractId: payload.contractId,
    installmentNo: payload.installmentNo,
    amount: payload.amount,
    paymentMethod: payload.paymentMethod,
    depositAccountCode: payload.depositAccountCode,
    transactionRef: payload.referenceNumber || undefined,
    wizardMethod: payload.wizardMethod,
    referenceNumber: payload.referenceNumber,
    slipUrl: payload.slipUrl,
    memo: payload.memo,
    case: payload.case,
    consumeAdvance: payload.consumeAdvance,
    paidDate: payload.paidDate,
    lateFee: payload.lateFee,
    lateFeeWaiverAmount: payload.lateFeeWaiverAmount,
    lateFeeWaiverReasonCode: payload.lateFeeWaiverReasonCode,
    waiverApproverId: payload.waiverApproverId,
  });
  const draftMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => (await api.post('/payments/draft', body)).data,
    onSuccess: () => {
      toast.success('บันทึกฉบับร่างแล้ว (ยังไม่ลงบัญชี)');
      queryClient.invalidateQueries({ queryKey: ['pending-payments'] });
      queryClient.invalidateQueries({ queryKey: ['payment-draft'] });
      setShowPayWizard(false);
      setSelectedPayment(null);
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });
  const postDraftMutation = useMutation({
    // Dirty form (mockup DRAFT state, edited after hydration) → save over the
    // draft first so what posts is what's on screen; clean form → post the
    // stored draft as-is, preserving the original maker for the SoD guard.
    // Note: on the dirty path the saver becomes the draft's createdById, so the
    // posted Payment.recordedById (collector KPI attribution) moves to whoever
    // edited — intended: the person who changed the numbers owns the record.
    mutationFn: async ({ paymentId, dirtyPayload }: { paymentId: string; dirtyPayload?: WizardSubmitPayload }) => {
      if (dirtyPayload) await api.post('/payments/draft', draftBodyFromPayload(dirtyPayload));
      return (await api.post(`/payments/${paymentId}/post-draft`, {})).data;
    },
    onSuccess: () => {
      toast.success('ลงบัญชีฉบับร่างสำเร็จ');
      invalidatePaymentQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: ['payment-draft'] });
      setShowPayWizard(false);
      setSelectedPayment(null);
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err));
      // The save leg may have succeeded before the post leg failed — refetch the
      // draft so the wizard re-hydrates the values that are actually stored.
      queryClient.invalidateQueries({ queryKey: ['payment-draft'] });
    },
  });
  const cancelDraftMutation = useMutation({
    mutationFn: async (paymentId: string) => (await api.delete(`/payments/draft/${paymentId}`)).data,
    onSuccess: () => {
      toast.success('ยกเลิกฉบับร่างแล้ว');
      queryClient.invalidateQueries({ queryKey: ['pending-payments'] });
      queryClient.invalidateQueries({ queryKey: ['payment-draft'] });
      setShowPayWizard(false);
      setSelectedPayment(null);
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  // Mockup §11.1 — after กลับรายการ (receipt void) the installment is un-paid
  // server-side; re-open the record wizard on that installment with only the
  // contract + งวด context (amounts start from the wizard's fresh defaults).
  const reopenAfterVoid = useCallback(
    async (info: VoidedReceiptInfo) => {
      if (!info.paymentId || !info.contractNumber) return; // e.g. down-payment receipts have no installment
      try {
        const params = new URLSearchParams();
        params.set('search', info.contractNumber);
        params.set('limit', '100');
        const { data } = await api.get(`/payments/pending?${params}`);
        const row = (data.data as PendingPayment[] | undefined)?.find((p) => p.id === info.paymentId);
        if (!row) return; // installment not in the pending set (race / already re-paid) — user can reopen manually
        setSelectedPayment(row);
        setShowPayWizard(true);
      } catch {
        // Void already succeeded — reopening is a convenience, never surface an error for it.
      }
    },
    [],
  );

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
      // Same helper as recordMutation/postDraftMutation — batch flips rows
      // PENDING→PAID too, so 'paid-payments' + per-contract history caches
      // must refresh (3-min staleTime otherwise serves the old list).
      invalidatePaymentQueries(queryClient);
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

  // Tab badge shows the whole-system pending count (from the aggregate KPI),
  // falling back to the loaded page count until the summary resolves.
  const tabBadgeCount = pendingKpi?.pendingCount ?? pendingSummary.count;

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
      filename: `pending-payments-${toLocalDateString()}.xlsx`,
    });
    toast.success('ส่งออก Excel สำเร็จ');
  };

  // ชำระครบ tab export — same shape as pending plus วันที่ชำระ; ยอดชำระจริง
  // replaces ยอดค้าง (a settled row has nothing outstanding).
  const handleExportPaid = async () => {
    await exportToExcel({
      columns: [
        { header: 'สัญญา', key: 'contractNumber', width: 15 },
        { header: 'ลูกค้า', key: 'customer', width: 15 },
        { header: 'เบอร์โทร', key: 'phone', width: 15 },
        { header: 'งวดที่', key: 'installmentNo', width: 15 },
        { header: 'ยอดงวด', key: 'amountDue', width: 15 },
        { header: 'ค่าปรับ', key: 'lateFee', width: 15 },
        { header: 'ชำระแล้ว', key: 'amountPaid', width: 15 },
        { header: 'วันครบกำหนด', key: 'dueDate', width: 15 },
        { header: 'วันที่ชำระ', key: 'paidDate', width: 15 },
        { header: 'สาขา', key: 'branch', width: 15 },
        { header: 'หมายเหตุ', key: 'notes', width: 25 },
      ],
      data: paidPayments.map((p) => ({
        contractNumber: p.contract.contractNumber,
        customer: p.contract.customer.name,
        phone: p.contract.customer.phone,
        installmentNo: p.installmentNo,
        amountDue: parseFloat(p.amountDue).toLocaleString(),
        lateFee: parseFloat(p.lateFee).toLocaleString(),
        amountPaid: parseFloat(p.amountPaid).toLocaleString(),
        dueDate: p.dueDate ? new Date(p.dueDate).toLocaleDateString('th-TH') : '-',
        paidDate: p.paidDate ? new Date(p.paidDate).toLocaleDateString('th-TH') : '-',
        branch: p.contract.branch.name,
        // '[ปิดก่อนกำหนด]' / 'ใช้เครดิต X บาท' — explains rows where ชำระแล้ว ≠ ยอดงวด+ค่าปรับ.
        notes: p.notes || '',
      })),
      sheetName: 'รายการชำระครบ',
      filename: `paid-payments-${toLocalDateString()}.xlsx`,
    });
    if (paidTruncated) {
      toast.warning(
        `ส่งออกได้ ${paidPayments.length.toLocaleString('th-TH')} จาก ${paidTotal.toLocaleString('th-TH')} รายการ — ปรับช่วงวันที่ให้แคบลงเพื่อส่งออกครบ`,
      );
    } else {
      toast.success('ส่งออก Excel สำเร็จ');
    }
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
    setPayForm({ amount: Math.round(remaining * 100) / 100, paymentMethod: 'CASH', notes: '', paidDate: toLocalDateString() });
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
          {tabBadgeCount > 0 && (
            <span className={`ml-2 text-xs px-1.5 py-0.5 rounded-full ${tab === 'pending' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
              {tabBadgeCount.toLocaleString('th-TH')}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab('paid')}
          className={`px-5 py-3 text-sm font-medium border-b-2 -mb-px transition-all ${tab === 'paid' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        >
          ชำระครบ
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
          {/* Period selector (scopes KPI cards + queue by installment dueDate) */}
          <PaymentPeriodBar
            startDate={startDate}
            endDate={endDate}
            onChange={({ startDate: sd, endDate: ed }) => {
              setStartDate(sd);
              setEndDate(ed);
            }}
          />

          {/* 6 accounting-aware KPI cards (whole-system aggregate) */}
          <PaymentKpiCards summary={pendingKpi} loading={loadingKpi} collectedLabel={collectedLabel} />

          <PaymentFilters
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            branchFilter={branchFilter}
            onBranchFilterChange={setBranchFilter}
            isOwner={isOwner}
            branches={branches}
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

      {/* Paid Tab — ชำระครบ: same layout/filters as the pending queue, rows
          pinned to status=PAID and read-only (history per row, no batch). */}
      {tab === 'paid' && (
        <div>
          <PaymentPeriodBar
            startDate={startDate}
            endDate={endDate}
            onChange={({ startDate: sd, endDate: ed }) => {
              setStartDate(sd);
              setEndDate(ed);
            }}
          />
          <p className="mb-4 -mt-2 text-xs text-muted-foreground leading-snug">
            ช่วงวันที่กรองตาม<span className="font-medium text-foreground">วันครบกำหนดของงวด</span> (เหมือนแท็บรอชำระ)
            — งวดเก่าที่เพิ่งมาชำระเดือนนี้ ให้ขยายช่วงย้อนหลังจึงจะเห็น
          </p>

          <PaymentFilters
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
            statusFilter=""
            onStatusFilterChange={() => {}}
            showStatusFilter={false}
            branchFilter={branchFilter}
            onBranchFilterChange={setBranchFilter}
            isOwner={isOwner}
            branches={branches}
            onExport={handleExportPaid}
            hasPendingPayments={paidPayments.length > 0}
          />

          {paidTruncated && (
            <div className="mb-4 rounded-lg border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm text-warning leading-snug">
              แสดง {paidPayments.length.toLocaleString('th-TH')} จาก {paidTotal.toLocaleString('th-TH')} รายการ
              (เรียงตามวันครบกำหนด) — ปรับช่วงวันที่ให้แคบลงเพื่อดูรายการทั้งหมด
            </div>
          )}

          <QueryBoundary
            isLoading={loadingPaid && paidPayments.length === 0}
            isError={paidError}
            error={paidErrorDetail}
            onRetry={refetchPaid}
            errorTitle="ไม่สามารถโหลดรายการชำระครบได้"
          >
            <PaymentTable
              mode="paid"
              pendingPayments={paidPayments}
              loadingPending={loadingPaid}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              onToggleAll={toggleAll}
              onOpenPayModal={openPayModal}
              onViewHistory={(contractId) => setHistoryContractId(contractId)}
              batchTotal={0}
              onShowBatchModal={() => {}}
              onClearSelection={() => {}}
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
            // Net owed = principal + late fee − waiver (the waived portion books to
            // Dr 52-1105, not collected in cash) − amountPaid.
            const grossRemaining = new Decimal(selectedPayment.amountDue)
              .add(selectedPayment.lateFee)
              .sub(payload.lateFeeWaiverAmount ?? 0)
              .sub(selectedPayment.amountPaid);
            // When the cashier keeps the credit checkbox on, the wizard prefills the
            // NET amount (gross − advance); the tolerance check must compare against
            // that net figure, else it flags the whole advance as an over/under-pay.
            const advance = new Decimal(selectedPayment.contract.advanceBalance ?? 0);
            const consumed = payload.consumeAdvance
              ? Decimal.min(advance, Decimal.max(new Decimal(0), grossRemaining))
              : new Decimal(0);
            const remaining = Decimal.max(new Decimal(0), grossRemaining.sub(consumed))
              .toDecimalPlaces(2)
              .toNumber();
            // แบ่งชำระ (PARTIAL) และ ล่วงหน้า (OVERPAY_ADVANCE) ตั้งใจให้ส่วนต่าง > 1฿ —
            // จึง bypass tolerance gate (backend บันทึกเป็น PARTIALLY_PAID / เงินรับล่วงหน้า).
            const gate = paymentToleranceGate(payload.case, payload.amount, remaining);
            if (gate.action === 'block') {
              toast.error(`ส่วนต่างเกิน 1 ฿ (${gate.absDiff.toFixed(2)} ฿) ไม่สามารถอนุมัติได้ กรุณาแก้ไขจำนวนเงิน`);
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
              consumeAdvance: payload.consumeAdvance,
              paidDate: payload.paidDate,
              lateFeeWaiverAmount: payload.lateFeeWaiverAmount,
              lateFeeWaiverReasonCode: payload.lateFeeWaiverReasonCode,
              waiverApproverId: payload.waiverApproverId,
              // Round 2 W7 fix: forward the wizard's lateFee so the DTO field
              // added in C1 actually carries the user's input across the wire.
              // Server still recomputes its own value as the source of truth,
              // but populating the field keeps the request body aligned with
              // form state + makes the user intent traceable in request logs.
              lateFee: payload.lateFee,
            };
            if (gate.action === 'confirm') {
              setPendingPayload(mutationPayload);
              setShowToleranceDialog(true);
              return;
            }
            recordMutation.mutate(mutationPayload);
            setShowPayWizard(false);
            setSelectedPayment(null);
          }}
          onSaveDraft={(payload) => draftMutation.mutate(draftBodyFromPayload(payload))}
          onPostDraft={(paymentId, dirtyPayload) => postDraftMutation.mutate({ paymentId, dirtyPayload })}
          onCancelDraft={(paymentId) => cancelDraftMutation.mutate(paymentId)}
          isSubmitting={
            recordMutation.isPending ||
            draftMutation.isPending ||
            postDraftMutation.isPending ||
            cancelDraftMutation.isPending
          }
          defaultDepositAccountCode={user?.defaultCashAccountCode ?? '11-1101'}
        />
      )}

      {/* Record Payment Modal (legacy) */}
      <RecordPaymentModal
        show={showPayModal}
        payment={selectedPayment}
        payForm={payForm}
        onPayFormChange={setPayForm}
        onClose={() => { setShowPayModal(false); setSelectedPayment(null); setSlipResult(null); setPayForm({ amount: 0, paymentMethod: 'CASH', notes: '', paidDate: toLocalDateString() }); }}
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
      {tab === 'receipts' && canSeeReceipts && <ReceiptsTab onVoided={reopenAfterVoid} />}

      {/* Payment History Sheet */}
      <PaymentHistorySheet
        contractId={historyContractId}
        onClose={() => setHistoryContractId(null)}
        onVoided={reopenAfterVoid}
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
