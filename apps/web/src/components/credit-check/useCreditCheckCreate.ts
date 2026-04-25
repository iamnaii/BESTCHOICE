import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { compressImageForOcr, fileToOcrBase64 } from '@/lib/compressImage';
import { useDebounce } from '@/hooks/useDebounce';
import {
  type Customer,
  type CustomerHistory,
  type OcrBookBankResult,
  type OcrSalarySlipResult,
  type OcrBankStatementResult,
  type RiskScoreResult,
} from './types';

interface UseCreditCheckCreateParams {
  open: boolean;
  preselectedCustomer?: Customer | null;
  onSuccess?: () => void;
}

export function useCreditCheckCreate({ open, preselectedCustomer, onSuccess }: UseCreditCheckCreateParams) {
  const queryClient = useQueryClient();

  const [customerSearch, setCustomerSearch] = useState('');
  const debouncedCustomerSearch = useDebounce(customerSearch);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(preselectedCustomer ?? null);

  useEffect(() => {
    if (preselectedCustomer !== undefined) setSelectedCustomer(preselectedCustomer);
  }, [preselectedCustomer?.id]);
  const [bankName, setBankName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const bookBankFileRef = useRef<HTMLInputElement>(null);
  const [bookBankLoading, setBookBankLoading] = useState(false);
  const [bookBankResult, setBookBankResult] = useState<OcrBookBankResult | null>(null);

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

  const [statementBankName, setStatementBankName] = useState('');
  const statementFileRef = useRef<HTMLInputElement>(null);
  const [statementFiles, setStatementFiles] = useState<File[]>([]);
  const [statementLoading, setStatementLoading] = useState(false);
  const [statementResult, setStatementResult] = useState<OcrBankStatementResult | null>(null);

  const [riskScore, setRiskScore] = useState<RiskScoreResult | null>(null);
  const [riskLoading, setRiskLoading] = useState(false);
  const [reviewNotesDraft, setReviewNotesDraft] = useState('');

  const reset = () => {
    setSelectedCustomer(preselectedCustomer ?? null);
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

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ['customers-search-cc', debouncedCustomerSearch],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (debouncedCustomerSearch) params.set('search', debouncedCustomerSearch);
      const { data } = await api.get(`/customers?${params}`);
      return data.data || [];
    },
    enabled: open && !preselectedCustomer,
  });

  useEffect(() => {
    if (!selectedCustomer) {
      setRiskScore(null);
      setSalarySlipResult(null);
      setSalarySlipFiles([]);
      setStatementResult(null);
      setStatementFiles([]);
      setStatementBankName('');
      setReviewNotesDraft('');
      setSalarySlipEditable({ netSalary: '', employerName: '', payDay: '', bankName: '' });
    }
  }, [selectedCustomer?.id, selectedCustomer]);

  const { data: customerHistory = null } = useQuery<CustomerHistory | null>({
    queryKey: ['credit-check-customer-history', selectedCustomer?.id],
    queryFn: async () => {
      try {
        const { data } = await api.get(`/credit-checks/customer-history/${selectedCustomer!.id}`);
        return data;
      } catch {
        return null;
      }
    },
    enabled: !!selectedCustomer && open,
  });

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
      const { data } = await api.post<OcrBookBankResult>('/ocr/book-bank', { imageBase64 }, { timeout: 90000 });
      setBookBankResult(data);
      if (data.bankName) setBankName(data.bankName);
      const pct = (data.confidence * 100).toFixed(0);
      if (data.confidence < 0.7) toast.warning(`อ่านสมุดบัญชีสำเร็จ ความมั่นใจ ${pct}%`);
      else toast.success(`อ่านสมุดบัญชีสำเร็จ (ความมั่นใจ ${pct}%)`);
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

  const handleSalarySlipOcr = async () => {
    if (salarySlipFiles.length === 0) {
      toast.error('กรุณาเลือกรูปสลิปเงินเดือน');
      return;
    }
    setSalarySlipLoading(true);
    try {
      const imageBase64 = await compressImageForOcr(salarySlipFiles[0]);
      const { data } = await api.post<OcrSalarySlipResult>('/ocr/salary-slip', { imageBase64 }, { timeout: 90000 });
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
      toast.error('กรุณาเลือกไฟล์ Statement');
      return;
    }
    const supported = statementFiles.filter(
      (f) => f.type.startsWith('image/') || f.type === 'application/pdf',
    );
    if (supported.length === 0) {
      toast.error('กรุณาเลือกรูปภาพหรือ PDF');
      return;
    }
    setStatementLoading(true);
    try {
      const filesBase64 = await Promise.all(supported.map(fileToOcrBase64));
      const { data } = await api.post<OcrBankStatementResult>(
        '/ocr/bank-statement',
        { filesBase64 },
        { timeout: 120000 },
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
      const { data } = await api.post<RiskScoreResult>(`/credit-checks/${creditCheckId}/calculate-risk`);
      setRiskScore(data);
      toast.success('คำนวณ Risk Score สำเร็จ');
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setRiskLoading(false);
    }
  };

  const uploadMutation = useMutation({
    mutationFn: async (files: FileList) => {
      if (!selectedCustomer) throw new Error('เลือกลูกค้าก่อน');
      // Reject oversize files BEFORE encoding — base64 adds 33% overhead, so a
      // 6MB raw file becomes ~8MB wire payload. Backend DTO caps at 8MB base64
      // per file; align the client check so we fail fast with a clear message
      // instead of a generic 413.
      const MAX_FILE_RAW_BYTES = 6 * 1024 * 1024; // ~8MB base64
      const MAX_FILES = 5;
      if (files.length > MAX_FILES) {
        throw new Error(`อัปโหลดได้สูงสุด ${MAX_FILES} ไฟล์`);
      }
      for (const file of Array.from(files)) {
        if (file.size > MAX_FILE_RAW_BYTES) {
          throw new Error(`ไฟล์ "${file.name}" มีขนาดใหญ่เกิน 6MB — กรุณาลดขนาดก่อน`);
        }
      }
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
        bankName: statementBankName || bankName || undefined,
        statementFiles: fileUrls,
        statementMonths: 3,
        reviewNotes: reviewNotesDraft || undefined,
      });
      return data;
    },
    onSuccess: (_data, _vars, _ctx) => {
      toast.success('สร้างรายการตรวจเครดิตสำเร็จ');
      // ContractCreatePage + DocumentUpload's statement card both read the
      // customer's latest credit check via separate query keys — invalidate
      // them so a freshly uploaded statement appears without page refresh.
      queryClient.invalidateQueries({ queryKey: ['credit-checks'] });
      queryClient.invalidateQueries({ queryKey: ['customer-credit-checks'] });
      if (selectedCustomer) {
        queryClient.invalidateQueries({
          queryKey: ['customer-latest-credit', selectedCustomer.id],
        });
        queryClient.invalidateQueries({
          queryKey: ['customer-credit-check-latest-statement', selectedCustomer.id],
        });
      }
      reset();
      onSuccess?.();
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const saveCreditCheckMutation = useMutation({
    mutationFn: async ({ customerId }: { customerId: string }) => {
      const { data } = await api.post(`/customers/${customerId}/credit-check`, {
        bankName: statementBankName || bankName || undefined,
        statementFiles: [],
        statementMonths: 3,
        reviewNotes: reviewNotesDraft || undefined,
      });
      return data;
    },
    onSuccess: (_data, vars) => {
      // New record starts as PENDING; auto-score runs in background. Final
      // APPROVED/REJECTED must go through the override dialog (enforces
      // ≥20-char reason + audit log + role check) — not a one-click action.
      toast.success('บันทึกตรวจเครดิตสำเร็จ — รอผลวิเคราะห์');
      queryClient.invalidateQueries({ queryKey: ['credit-checks'] });
      queryClient.invalidateQueries({ queryKey: ['customer-credit-checks'] });
      queryClient.invalidateQueries({
        queryKey: ['customer-latest-credit', vars.customerId],
      });
      queryClient.invalidateQueries({
        queryKey: ['customer-credit-check-latest-statement', vars.customerId],
      });
      reset();
      onSuccess?.();
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const handleSave = () => {
    if (!selectedCustomer) return;
    const files = fileRef.current?.files;
    if (files && files.length > 0) uploadMutation.mutate(files);
    else saveCreditCheckMutation.mutate({ customerId: selectedCustomer.id });
  };

  return {
    reset,

    modalProps: {
      onClose: reset,
      customerSearch,
      onCustomerSearchChange: setCustomerSearch,
      customers,
      selectedCustomer,
      onSelectCustomer: setSelectedCustomer,
      onClearCustomer: () => {
        if (!preselectedCustomer) setSelectedCustomer(null);
      },
      customerHistory,
      bookBankLoading,
      bookBankFileRef,
      onBookBankScan: handleBookBankScan,
      salarySlipFileRef,
      salarySlipFiles,
      onSalarySlipFilesChange: setSalarySlipFiles,
      salarySlipLoading,
      onSalarySlipOcr: handleSalarySlipOcr,
      salarySlipResult,
      salarySlipEditable,
      onSalarySlipEditableChange: setSalarySlipEditable,
      statementBankName,
      onStatementBankNameChange: setStatementBankName,
      statementFileRef,
      statementFiles,
      onStatementFilesChange: setStatementFiles,
      statementLoading,
      onStatementOcr: handleStatementOcr,
      statementResult,
      riskScore,
      riskLoading,
      onCalculateRisk: handleCalculateRisk,
      reviewNotesDraft,
      onReviewNotesDraftChange: setReviewNotesDraft,
      bankName,
      fileRef,
      isSaving: uploadMutation.isPending || saveCreditCheckMutation.isPending,
      onSave: handleSave,
    },

    bookBankResult,
  };
}
