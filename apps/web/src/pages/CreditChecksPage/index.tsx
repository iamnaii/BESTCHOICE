import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { exportToExcel, type ExcelColumn } from '@/utils/excel.util';
import api, { getErrorMessage } from '@/lib/api';
import { compressImageForOcr } from '@/lib/compressImage';
import { useDebounce } from '@/hooks/useDebounce';
import { formatDateShort } from '@/utils/formatters';
import PageHeader from '@/components/ui/PageHeader';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

import {
  type Customer,
  type CustomerHistory,
  type OcrBookBankResult,
  type OcrSalarySlipResult,
  type OcrBankStatementResult,
  type RiskScoreResult,
  type Branch,
  type CreditChecksResponse,
  type CreditCheckItem,
  type AiAnalysisData,
  statusLabels,
} from './types';
import CreditCheckFilters from './CreditCheckFilters';
import CreditCheckTable from './CreditCheckTable';
import CreditCheckCreateModal from './CreditCheckCreateModal';
import CreditCheckOverrideModal from './CreditCheckOverrideModal';

export default function CreditChecksPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isOwner = user?.role === 'OWNER';
  const isOwnerOrManager = ['OWNER', 'BRANCH_MANAGER'].includes(user?.role ?? '');

  // ── Filters ──────────────────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounce(search);

  // Expand row
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  // ── Create overlay state ─────────────────────────────────────────────────
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const debouncedCustomerSearch = useDebounce(customerSearch);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [bankName, setBankName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const bookBankFileRef = useRef<HTMLInputElement>(null);
  const [bookBankLoading, setBookBankLoading] = useState(false);
  const [bookBankResult, setBookBankResult] = useState<OcrBookBankResult | null>(null);

  // Salary slip OCR
  const salarySlipFileRef = useRef<HTMLInputElement>(null);
  const [salarySlipFiles, setSalarySlipFiles] = useState<File[]>([]);
  const [salarySlipLoading, setSalarySlipLoading] = useState(false);
  const [salarySlipResult, setSalarySlipResult] = useState<OcrSalarySlipResult | null>(null);
  const [salarySlipEditable, setSalarySlipEditable] = useState({
    netSalary: '',
    employerName: '',
    payDay: '',
    bankName: '',
  });

  // Bank statement OCR
  const [statementBankName, setStatementBankName] = useState('');
  const statementFileRef = useRef<HTMLInputElement>(null);
  const [statementFiles, setStatementFiles] = useState<File[]>([]);
  const [statementLoading, setStatementLoading] = useState(false);
  const [statementResult, setStatementResult] = useState<OcrBankStatementResult | null>(null);

  // Customer history / risk
  const [customerHistory, setCustomerHistory] = useState<CustomerHistory | null>(null);
  const [riskScore, setRiskScore] = useState<RiskScoreResult | null>(null);
  const [riskLoading, setRiskLoading] = useState(false);
  const [reviewNotesDraft, setReviewNotesDraft] = useState('');

  // Override
  const canOverride = user && ['OWNER', 'BRANCH_MANAGER'].includes(user.role);
  const [overrideId, setOverrideId] = useState<string | null>(null);
  const [overrideCustomerId, setOverrideCustomerId] = useState<string | null>(null);
  const [overrideStatus, setOverrideStatus] = useState('');
  const [overrideNotes, setOverrideNotes] = useState('');

  // ── Reset page on filter change ──────────────────────────────────────────
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, statusFilter, startDate, endDate, branchFilter]);

  // ── Date range shortcuts ─────────────────────────────────────────────────
  const setDateRange = (type: 'today' | 'week' | 'month') => {
    const now = new Date();
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    setEndDate(fmt(now));
    if (type === 'today') {
      setStartDate(fmt(now));
    } else if (type === 'week') {
      const day = now.getDay();
      const diff = day === 0 ? 6 : day - 1;
      const monday = new Date(now);
      monday.setDate(now.getDate() - diff);
      setStartDate(fmt(monday));
    } else {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      setStartDate(fmt(first));
    }
  };

  // ── Queries ──────────────────────────────────────────────────────────────
  const buildParams = (overrideLimit?: number) => {
    const params = new URLSearchParams();
    if (debouncedSearch) params.set('search', debouncedSearch);
    if (statusFilter) params.set('status', statusFilter);
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    if (branchFilter) params.set('branchId', branchFilter);
    params.set('page', String(page));
    params.set('limit', String(overrideLimit ?? 20));
    return params;
  };

  const {
    data: creditChecksData,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<CreditChecksResponse>({
    queryKey: ['credit-checks', debouncedSearch, statusFilter, startDate, endDate, branchFilter, page],
    queryFn: async () => {
      const { data } = await api.get(`/credit-checks?${buildParams()}`);
      return data;
    },
  });

  const creditChecks = creditChecksData?.data || [];
  const summary = creditChecksData?.summary;

  const { data: branches = [] } = useQuery<Branch[]>({
    queryKey: ['branches-list'],
    queryFn: async () => {
      const { data } = await api.get('/branches');
      return Array.isArray(data) ? data : data.data || [];
    },
    enabled: !!isOwner,
  });

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ['customers-search-cc', debouncedCustomerSearch],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (debouncedCustomerSearch) params.set('search', debouncedCustomerSearch);
      const { data } = await api.get(`/customers?${params}`);
      return data.data || [];
    },
    enabled: showCreateModal,
  });

  // Load customer history when customer selected
  useEffect(() => {
    if (!selectedCustomer) {
      setCustomerHistory(null);
      setRiskScore(null);
      setSalarySlipResult(null);
      setSalarySlipFiles([]);
      setStatementResult(null);
      setStatementFiles([]);
      setStatementBankName('');
      setReviewNotesDraft('');
      setSalarySlipEditable({ netSalary: '', employerName: '', payDay: '', bankName: '' });
      return;
    }
    api
      .get(`/credit-checks/customer-history/${selectedCustomer.id}`)
      .then(({ data }) => setCustomerHistory(data))
      .catch(() => setCustomerHistory(null));
  }, [selectedCustomer?.id, selectedCustomer]);

  // ── OCR Handlers ─────────────────────────────────────────────────────────
  const handleSalarySlipOcr = async () => {
    if (salarySlipFiles.length === 0) {
      toast.error('กรุณาเลือกรูปสลิปเงินเดือน');
      return;
    }
    setSalarySlipLoading(true);
    try {
      const imageBase64 = await compressImageForOcr(salarySlipFiles[0]);
      const { data } = await api.post<OcrSalarySlipResult>(
        '/ocr/salary-slip',
        { imageBase64 },
        { timeout: 90000 },
      );
      setSalarySlipResult(data);
      setSalarySlipEditable({
        netSalary: data.netSalary?.toString() || '',
        employerName: data.employerName || '',
        payDay: data.payDay?.toString() || '',
        bankName: data.bankName || '',
      });
      toast.success(`วิเคราะห์สลิปเงินเดือนสำเร็จ (ความมั่นใจ ${(data.confidence * 100).toFixed(0)}%)`);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSalarySlipLoading(false);
    }
  };

  const handleStatementOcr = async () => {
    if (statementFiles.length === 0) {
      toast.error('กรุณาเลือกรูป Statement');
      return;
    }
    setStatementLoading(true);
    try {
      const imageBase64 = await compressImageForOcr(statementFiles[0]);
      const { data } = await api.post<OcrBankStatementResult>(
        '/ocr/bank-statement',
        { imageBase64 },
        { timeout: 90000 },
      );
      setStatementResult(data);
      toast.success(`วิเคราะห์ Statement สำเร็จ (ความมั่นใจ ${(data.confidence * 100).toFixed(0)}%)`);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setStatementLoading(false);
    }
  };

  const handleCalculateRisk = async (creditCheckId: string) => {
    setRiskLoading(true);
    try {
      const { data } = await api.post<RiskScoreResult>(
        `/credit-checks/${creditCheckId}/calculate-risk`,
      );
      setRiskScore(data);
      toast.success('คำนวณ Risk Score สำเร็จ');
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setRiskLoading(false);
    }
  };

  const handleBookBankScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (bookBankFileRef.current) bookBankFileRef.current.value = '';
    if (file.size > 10 * 1024 * 1024) {
      toast.error('ไฟล์ต้องมีขนาดไม่เกิน 10MB');
      return;
    }
    if (!file.type.startsWith('image/')) {
      toast.error('กรุณาเลือกไฟล์รูปภาพ');
      return;
    }
    setBookBankLoading(true);
    try {
      const imageBase64 = await compressImageForOcr(file);
      const { data } = await api.post<OcrBookBankResult>(
        '/ocr/book-bank',
        { imageBase64 },
        { timeout: 90000 },
      );
      setBookBankResult(data);
      if (data.bankName) setBankName(data.bankName);
      const pct = (data.confidence * 100).toFixed(0);
      if (data.confidence < 0.7) {
        toast.warning(`อ่านสมุดบัญชีสำเร็จ ความมั่นใจ ${pct}%`);
      } else {
        toast.success(`อ่านสมุดบัญชีสำเร็จ (ความมั่นใจ ${pct}%)`);
      }
    } catch (err: unknown) {
      const axiosErr = err as { code?: string; response?: unknown };
      if (axiosErr.code === 'ECONNABORTED' || !axiosErr.response) {
        toast.error('ไม่สามารถเชื่อมต่อ OCR ได้ กรุณาลองใหม่');
      } else {
        toast.error(getErrorMessage(err));
      }
    } finally {
      setBookBankLoading(false);
    }
  };

  // ── Mutations ────────────────────────────────────────────────────────────
  const resetCreateForm = () => {
    setShowCreateModal(false);
    setSelectedCustomer(null);
    setBankName('');
    setCustomerSearch('');
    setBookBankResult(null);
    setSalarySlipResult(null);
    setSalarySlipFiles([]);
    setStatementResult(null);
    setStatementFiles([]);
    setStatementBankName('');
    setReviewNotesDraft('');
    setRiskScore(null);
    setSalarySlipEditable({ netSalary: '', employerName: '', payDay: '', bankName: '' });
    if (fileRef.current) fileRef.current.value = '';
  };

  const uploadMutation = useMutation({
    mutationFn: async (files: FileList) => {
      if (!selectedCustomer) throw new Error('เลือกลูกค้าก่อน');
      const fileUrls: string[] = [];
      for (const file of Array.from(files)) {
        const reader = new FileReader();
        const url = await new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error('ไม่สามารถอ่านไฟล์ได้'));
          reader.readAsDataURL(file);
        });
        fileUrls.push(url);
      }
      const { data } = await api.post(`/customers/${selectedCustomer.id}/credit-check`, {
        bankName: bankName || undefined,
        statementFiles: fileUrls,
        statementMonths: 3,
      });
      return data;
    },
    onSuccess: () => {
      toast.success('สร้างรายการตรวจเครดิตสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['credit-checks'] });
      resetCreateForm();
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const analyzeMutation = useMutation({
    mutationFn: async ({ customerId, creditCheckId }: { customerId: string; creditCheckId: string }) => {
      const { data } = await api.post(
        `/customers/${customerId}/credit-check/${creditCheckId}/analyze`,
      );
      return data;
    },
    onSuccess: () => {
      toast.success('วิเคราะห์เครดิตเสร็จสิ้น');
      queryClient.invalidateQueries({ queryKey: ['credit-checks'] });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const overrideMutation = useMutation({
    mutationFn: async () => {
      if (!overrideId || !overrideCustomerId) return;
      const { data } = await api.post(
        `/customers/${overrideCustomerId}/credit-check/${overrideId}/override`,
        { status: overrideStatus, reviewNotes: overrideNotes || undefined },
      );
      return data;
    },
    onSuccess: () => {
      toast.success('อัปเดตสถานะเครดิตเช็คแล้ว');
      queryClient.invalidateQueries({ queryKey: ['credit-checks'] });
      setOverrideId(null);
      setOverrideCustomerId(null);
      setOverrideStatus('');
      setOverrideNotes('');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  // ── Create modal save/approve/reject handlers ────────────────────────────
  const handleSave = () => {
    if (!selectedCustomer) return;
    const files = fileRef.current?.files;
    if (files && files.length > 0) {
      uploadMutation.mutate(files);
    } else {
      api
        .post(`/customers/${selectedCustomer.id}/credit-check`, {
          bankName: statementBankName || bankName || undefined,
          statementFiles: [],
          statementMonths: 3,
          reviewNotes: reviewNotesDraft || undefined,
        })
        .then(() => {
          toast.success('บันทึกร่างตรวจเครดิตสำเร็จ');
          queryClient.invalidateQueries({ queryKey: ['credit-checks'] });
          resetCreateForm();
        })
        .catch((err: unknown) => toast.error(getErrorMessage(err)));
    }
  };

  const handleApprove = () => {
    if (!selectedCustomer) return;
    api
      .post(`/customers/${selectedCustomer.id}/credit-check`, {
        bankName: statementBankName || bankName || undefined,
        statementFiles: [],
        statementMonths: 3,
        reviewNotes: reviewNotesDraft || undefined,
        status: 'APPROVED',
      })
      .then(() => {
        toast.success('อนุมัติเครดิตสำเร็จ');
        queryClient.invalidateQueries({ queryKey: ['credit-checks'] });
        resetCreateForm();
      })
      .catch((err: unknown) => toast.error(getErrorMessage(err)));
  };

  const handleReject = () => {
    if (!selectedCustomer) return;
    api
      .post(`/customers/${selectedCustomer.id}/credit-check`, {
        bankName: statementBankName || bankName || undefined,
        statementFiles: [],
        statementMonths: 3,
        reviewNotes: reviewNotesDraft || undefined,
        status: 'REJECTED',
      })
      .then(() => {
        toast.success('ปฏิเสธเครดิตแล้ว');
        queryClient.invalidateQueries({ queryKey: ['credit-checks'] });
        resetCreateForm();
      })
      .catch((err: unknown) => toast.error(getErrorMessage(err)));
  };

  // ── Excel export ─────────────────────────────────────────────────────────
  const exportExcel = async () => {
    try {
      toast.loading('กำลังสร้างไฟล์ Excel...', { id: 'excel-export' });
      const exportParams = new URLSearchParams();
      if (debouncedSearch) exportParams.set('search', debouncedSearch);
      if (statusFilter) exportParams.set('status', statusFilter);
      if (startDate) exportParams.set('startDate', startDate);
      if (endDate) exportParams.set('endDate', endDate);
      if (branchFilter) exportParams.set('branchId', branchFilter);
      exportParams.set('page', '1');
      exportParams.set('limit', '10000');
      const { data: allData } = await api.get<CreditChecksResponse>(
        `/credit-checks?${exportParams}`,
      );

      const cols: ExcelColumn[] = [
        { header: 'ชื่อลูกค้า', key: 'customerName', width: 25 },
        { header: 'เบอร์โทร', key: 'phone', width: 14 },
        { header: 'ธนาคาร', key: 'bankName', width: 16 },
        { header: 'จำนวนเดือน Statement', key: 'statementMonths', width: 12 },
        { header: 'คะแนน AI', key: 'aiScore', width: 10 },
        { header: 'ความเสี่ยง', key: 'risk', width: 16 },
        { header: 'สถานะ', key: 'status', width: 14 },
      ];

      if (isOwnerOrManager) {
        cols.push(
          { header: 'รายได้เฉลี่ย', key: 'monthlyIncome', width: 16 },
          { header: 'ยอดเงินเฉลี่ย', key: 'averageBalance', width: 16 },
        );
      }

      cols.push(
        { header: 'อัตราภาระหนี้ (%)', key: 'affordabilityRatio', width: 14 },
        { header: 'ความสม่ำเสมอรายได้', key: 'incomeConsistency', width: 16 },
        { header: 'ผู้ตรวจ', key: 'checkedByName', width: 18 },
        { header: 'หมายเหตุ', key: 'reviewNotes', width: 25 },
        { header: 'เลขสัญญา', key: 'contractNumber', width: 18 },
        { header: 'วันที่สร้าง', key: 'createdAt', width: 16 },
      );

      const getRiskLabel = (score: number | null) => {
        if (score === null) return 'รอวิเคราะห์';
        if (score >= 70) return 'ความเสี่ยงต่ำ';
        if (score >= 50) return 'ความเสี่ยงปานกลาง';
        if (score >= 40) return 'ต้องตรวจเพิ่ม';
        return 'ความเสี่ยงสูง';
      };

      const now = new Date();
      await exportToExcel({
        columns: cols,
        data: allData.data.map((cc: CreditCheckItem) => {
          const ai = cc.aiAnalysis as AiAnalysisData | null;
          const row: Record<string, unknown> = {
            customerName: cc.customer.name,
            phone: cc.customer.phone,
            bankName: cc.bankName || '-',
            statementMonths: cc.statementMonths,
            aiScore: cc.aiScore ?? '-',
            risk: getRiskLabel(cc.aiScore),
            status: statusLabels[cc.status]?.label || cc.status,
            affordabilityRatio:
              ai?.affordabilityRatio != null
                ? Number((ai.affordabilityRatio * 100).toFixed(1))
                : '-',
            incomeConsistency: ai?.incomeConsistency || '-',
            checkedByName: cc.checkedBy?.name || '-',
            reviewNotes: cc.reviewNotes || '-',
            contractNumber: cc.contract?.contractNumber || '-',
            createdAt: formatDateShort(cc.createdAt),
          };
          if (isOwnerOrManager) {
            row.monthlyIncome = ai?.monthlyIncome != null ? Number(ai.monthlyIncome) : '-';
            row.averageBalance = ai?.averageBalance != null ? Number(ai.averageBalance) : '-';
          }
          return row;
        }),
        sheetName: 'ตรวจสอบเครดิต',
        filename: `ตรวจสอบเครดิต_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}.xlsx`,
      });
      toast.success(`ดาวน์โหลดสำเร็จ (${allData.data.length} รายการ)`, { id: 'excel-export' });
    } catch {
      toast.error('ไม่สามารถสร้างไฟล์ Excel ได้', { id: 'excel-export' });
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div>
      <PageHeader
        title="ตรวจเครดิต"
        subtitle="ตรวจสอบเครดิตลูกค้าก่อนทำสัญญา"
        action={
          <div className="flex gap-2">
            <button
              onClick={exportExcel}
              className="px-4 py-2 text-sm border border-input rounded-lg hover:bg-muted"
            >
              ส่งออก Excel
            </button>
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
            >
              + ตรวจเครดิตใหม่
            </button>
          </div>
        }
      />

      <CreditCheckFilters
        search={search}
        onSearchChange={setSearch}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        startDate={startDate}
        onStartDateChange={setStartDate}
        endDate={endDate}
        onEndDateChange={setEndDate}
        onDateRangeShortcut={setDateRange}
        onClearDateRange={() => { setStartDate(''); setEndDate(''); }}
        branchFilter={branchFilter}
        onBranchFilterChange={setBranchFilter}
        isOwner={isOwner}
        branches={branches}
        summary={summary}
      />

      <CreditCheckTable
        creditChecks={creditChecks}
        creditChecksData={creditChecksData}
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={refetch}
        expandedRow={expandedRow}
        onRowClick={(cc) => setExpandedRow(expandedRow === cc.id ? null : cc.id)}
        onExpandedClose={() => setExpandedRow(null)}
        onPageChange={setPage}
        canOverride={!!canOverride}
        isAnalyzePending={analyzeMutation.isPending}
        onAnalyze={(customerId, creditCheckId) =>
          analyzeMutation.mutate({ customerId, creditCheckId })
        }
        onOverrideOpen={(creditCheckId, customerId) => {
          setOverrideId(creditCheckId);
          setOverrideCustomerId(customerId);
        }}
      />

      {/* Create Full-Screen Overlay */}
      {showCreateModal && (
        <CreditCheckCreateModal
          onClose={() => {
            setShowCreateModal(false);
            setSelectedCustomer(null);
            setBankName('');
            setCustomerSearch('');
          }}
          customerSearch={customerSearch}
          onCustomerSearchChange={setCustomerSearch}
          customers={customers}
          selectedCustomer={selectedCustomer}
          onSelectCustomer={setSelectedCustomer}
          onClearCustomer={() => setSelectedCustomer(null)}
          customerHistory={customerHistory}
          bookBankLoading={bookBankLoading}
          bookBankFileRef={bookBankFileRef}
          onBookBankScan={handleBookBankScan}
          salarySlipFileRef={salarySlipFileRef}
          salarySlipFiles={salarySlipFiles}
          onSalarySlipFilesChange={setSalarySlipFiles}
          salarySlipLoading={salarySlipLoading}
          onSalarySlipOcr={handleSalarySlipOcr}
          salarySlipResult={salarySlipResult}
          salarySlipEditable={salarySlipEditable}
          onSalarySlipEditableChange={setSalarySlipEditable}
          statementBankName={statementBankName}
          onStatementBankNameChange={setStatementBankName}
          statementFileRef={statementFileRef}
          statementFiles={statementFiles}
          onStatementFilesChange={setStatementFiles}
          statementLoading={statementLoading}
          onStatementOcr={handleStatementOcr}
          statementResult={statementResult}
          riskScore={riskScore}
          riskLoading={riskLoading}
          onCalculateRisk={handleCalculateRisk}
          reviewNotesDraft={reviewNotesDraft}
          onReviewNotesDraftChange={setReviewNotesDraft}
          bankName={bankName}
          fileRef={fileRef}
          isUploadPending={uploadMutation.isPending}
          onSave={handleSave}
          onApprove={handleApprove}
          onReject={handleReject}
        />
      )}

      {/* Override Modal */}
      {overrideId && (
        <CreditCheckOverrideModal
          overrideStatus={overrideStatus}
          onOverrideStatusChange={setOverrideStatus}
          overrideNotes={overrideNotes}
          onOverrideNotesChange={setOverrideNotes}
          isPending={overrideMutation.isPending}
          onConfirm={() => overrideMutation.mutate()}
          onClose={() => {
            setOverrideId(null);
            setOverrideCustomerId(null);
          }}
        />
      )}
    </div>
  );
}
