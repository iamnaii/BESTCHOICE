import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { exportToExcel, type ExcelColumn } from '@/utils/excel.util';
import api, { getErrorMessage } from '@/lib/api';
import { compressImageForOcr } from '@/lib/compressImage';
import { useDebounce } from '@/hooks/useDebounce';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

interface OcrBookBankResult {
  accountName: string | null;
  accountNo: string | null;
  bankName: string | null;
  branchName: string | null;
  accountType: string | null;
  balance: number | null;
  lastTransactionDate: string | null;
  confidence: number;
}

interface Customer {
  id: string;
  name: string;
  phone: string;
  nationalId: string;
  salary: string | null;
  occupation: string | null;
}

interface AiAnalysisData {
  monthlyIncome?: number;
  averageBalance?: number;
  affordabilityRatio?: number;
  incomeConsistency?: string;
  riskFactors?: string[];
  positiveFactors?: string[];
  [key: string]: unknown;
}

interface CreditCheckItem {
  id: string;
  status: string;
  bankName: string | null;
  statementFiles: string[];
  statementMonths: number;
  aiScore: number | null;
  aiSummary: string | null;
  aiRecommendation: string | null;
  aiAnalysis: AiAnalysisData | null;
  reviewNotes: string | null;
  checkedBy: { id: string; name: string } | null;
  customer: { id: string; name: string; phone: string; salary: string | null; occupation: string | null };
  contract: { id: string; contractNumber: string } | null;
  createdAt: string;
}

interface CreditCheckSummary {
  totalCount: number;
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
  avgScore: number;
}

interface CreditChecksResponse {
  data: CreditCheckItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  summary: CreditCheckSummary;
}

interface Branch {
  id: string;
  name: string;
}

const statusLabels: Record<string, { label: string; className: string }> = {
  PENDING: { label: 'รอวิเคราะห์', className: 'bg-muted text-foreground' },
  APPROVED: { label: 'ผ่าน', className: 'bg-green-100 text-green-700' },
  REJECTED: { label: 'ไม่ผ่าน', className: 'bg-red-100 text-red-700' },
  MANUAL_REVIEW: { label: 'ต้องตรวจเพิ่ม', className: 'bg-amber-100 text-amber-700' },
};

function getRiskBadge(aiScore: number | null) {
  if (aiScore === null) {
    return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">รอวิเคราะห์</span>;
  }
  if (aiScore >= 70) {
    return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">ความเสี่ยงต่ำ</span>;
  }
  if (aiScore >= 50) {
    return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">ความเสี่ยงปานกลาง</span>;
  }
  if (aiScore >= 40) {
    return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700">ต้องตรวจเพิ่ม</span>;
  }
  return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">ความเสี่ยงสูง</span>;
}

export default function CreditChecksPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isOwner = user?.role === 'OWNER';
  const isOwnerOrManager = ['OWNER', 'BRANCH_MANAGER'].includes(user?.role ?? '');

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounce(search);

  // Expand row
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  // Create modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const debouncedCustomerSearch = useDebounce(customerSearch);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [bankName, setBankName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const bookBankFileRef = useRef<HTMLInputElement>(null);
  const [bookBankLoading, setBookBankLoading] = useState(false);
  const [bookBankResult, setBookBankResult] = useState<OcrBookBankResult | null>(null);

  // Override
  const canOverride = user && ['OWNER', 'BRANCH_MANAGER'].includes(user.role);
  const [overrideId, setOverrideId] = useState<string | null>(null);
  const [overrideCustomerId, setOverrideCustomerId] = useState<string | null>(null);
  const [overrideStatus, setOverrideStatus] = useState('');
  const [overrideNotes, setOverrideNotes] = useState('');

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, statusFilter, startDate, endDate, branchFilter]);

  // Date range shortcuts
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

  // Build query params helper
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

  // Main data query
  const { data: creditChecksData, isLoading } = useQuery<CreditChecksResponse>({
    queryKey: ['credit-checks', debouncedSearch, statusFilter, startDate, endDate, branchFilter, page],
    queryFn: async () => {
      const { data } = await api.get(`/credit-checks?${buildParams()}`);
      return data;
    },
  });

  const creditChecks = creditChecksData?.data || [];
  const summary = creditChecksData?.summary;

  // Branches query (OWNER only)
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
      setShowCreateModal(false);
      setSelectedCustomer(null);
      setBankName('');
      setCustomerSearch('');
      setBookBankResult(null);
      if (fileRef.current) fileRef.current.value = '';
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const analyzeMutation = useMutation({
    mutationFn: async ({ customerId, creditCheckId }: { customerId: string; creditCheckId: string }) => {
      const { data } = await api.post(`/customers/${customerId}/credit-check/${creditCheckId}/analyze`);
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
      const { data } = await api.post(`/customers/${overrideCustomerId}/credit-check/${overrideId}/override`, {
        status: overrideStatus,
        reviewNotes: overrideNotes || undefined,
      });
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

      // Auto-fill bank name from OCR
      if (data.bankName) {
        setBankName(data.bankName);
      }

      const pct = (data.confidence * 100).toFixed(0);
      if (data.confidence < 0.7) {
        toast.warning(`อ่านสมุดบัญชีสำเร็จ ความมั่นใจ ${pct}%`);
      } else {
        toast.success(`อ่านสมุดบัญชีสำเร็จ (ความมั่นใจ ${pct}%)`);
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (err.code === 'ECONNABORTED' || !err.response) {
        toast.error('ไม่สามารถเชื่อมต่อ OCR ได้ กรุณาลองใหม่');
      } else {
        toast.error(getErrorMessage(err));
      }
    } finally {
      setBookBankLoading(false);
    }
  };

  // Excel export
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
      const { data: allData } = await api.get<CreditChecksResponse>(`/credit-checks?${exportParams}`);

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
            affordabilityRatio: ai?.affordabilityRatio != null ? Number((ai.affordabilityRatio * 100).toFixed(1)) : '-',
            incomeConsistency: ai?.incomeConsistency || '-',
            checkedByName: cc.checkedBy?.name || '-',
            reviewNotes: cc.reviewNotes || '-',
            contractNumber: cc.contract?.contractNumber || '-',
            createdAt: new Date(cc.createdAt).toLocaleDateString('th-TH'),
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

  const columns = [
    {
      key: 'customer',
      label: 'ลูกค้า',
      render: (cc: CreditCheckItem) => (
        <div>
          <button onClick={() => navigate(`/customers/${cc.customer.id}`)} className="text-sm font-medium text-primary hover:underline">{cc.customer.name}</button>
          <div className="text-xs text-muted-foreground">{cc.customer.phone}</div>
        </div>
      ),
    },
    {
      key: 'status',
      label: 'สถานะ',
      render: (cc: CreditCheckItem) => {
        const s = statusLabels[cc.status] || { label: cc.status, className: 'bg-muted' };
        return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.className}`}>{s.label}</span>;
      },
    },
    {
      key: 'aiScore',
      label: 'คะแนน',
      render: (cc: CreditCheckItem) => cc.aiScore !== null ? (
        <div className="flex items-center gap-2">
          <span className={`text-sm font-bold ${cc.aiScore >= 70 ? 'text-green-600' : cc.aiScore >= 50 ? 'text-amber-600' : 'text-red-600'}`}>{cc.aiScore}</span>
          <div className="w-16 bg-muted rounded-full h-1.5">
            <div className={`h-1.5 rounded-full ${cc.aiScore >= 70 ? 'bg-green-500' : cc.aiScore >= 50 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${cc.aiScore}%` }} />
          </div>
        </div>
      ) : <span className="text-xs text-muted-foreground">-</span>,
    },
    {
      key: 'risk',
      label: 'ความเสี่ยง',
      render: (cc: CreditCheckItem) => getRiskBadge(cc.aiScore),
    },
    {
      key: 'bankName',
      label: 'ธนาคาร',
      render: (cc: CreditCheckItem) => <span className="text-sm">{cc.bankName || '-'}</span>,
    },
    {
      key: 'contract',
      label: 'สัญญา',
      render: (cc: CreditCheckItem) => cc.contract ? (
        <button onClick={() => navigate(`/contracts/${cc.contract!.id}`)} className="text-xs text-primary hover:underline font-mono">{cc.contract.contractNumber}</button>
      ) : <span className="text-xs text-muted-foreground">ยังไม่มีสัญญา</span>,
    },
    {
      key: 'createdAt',
      label: 'วันที่',
      render: (cc: CreditCheckItem) => <span className="text-xs text-muted-foreground">{new Date(cc.createdAt).toLocaleDateString('th-TH')}</span>,
    },
    {
      key: 'actions',
      label: '',
      render: (cc: CreditCheckItem) => (
        <div className="flex gap-2">
          {cc.status === 'PENDING' && (
            <button
              onClick={() => analyzeMutation.mutate({ customerId: cc.customer.id, creditCheckId: cc.id })}
              disabled={analyzeMutation.isPending}
              className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
            >
              AI วิเคราะห์
            </button>
          )}
          {canOverride && cc.aiScore !== null && (
            <button
              onClick={() => { setOverrideId(cc.id); setOverrideCustomerId(cc.customer.id); }}
              className="px-3 py-1 text-xs bg-primary-100 text-primary-700 rounded-lg hover:bg-primary-200"
            >
              Override
            </button>
          )}
        </div>
      ),
    },
  ];

  const avgScoreColor = (score: number) => {
    if (score >= 60) return 'text-green-700';
    if (score >= 40) return 'text-amber-700';
    return 'text-red-700';
  };
  const avgScoreBg = (score: number) => {
    if (score >= 60) return 'bg-green-50 border-green-200';
    if (score >= 40) return 'bg-amber-50 border-amber-200';
    return 'bg-red-50 border-red-200';
  };
  const avgScoreLabel = (score: number) => {
    if (score >= 60) return 'text-green-600';
    if (score >= 40) return 'text-amber-600';
    return 'text-red-600';
  };

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

      {/* Filters */}
      <div className="flex gap-3 mb-4 flex-wrap items-end">
        <input
          type="text"
          placeholder="ค้นหาชื่อลูกค้า..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-2 border border-input rounded-lg text-sm w-64"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-input rounded-lg text-sm"
        >
          <option value="">ทุกสถานะ</option>
          <option value="PENDING">รอวิเคราะห์</option>
          <option value="APPROVED">ผ่าน</option>
          <option value="REJECTED">ไม่ผ่าน</option>
          <option value="MANUAL_REVIEW">ต้องตรวจเพิ่ม</option>
        </select>

        {/* Date range */}
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="px-3 py-2 border border-input rounded-lg text-sm"
          />
          <span className="text-sm text-muted-foreground">ถึง</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="px-3 py-2 border border-input rounded-lg text-sm"
          />
        </div>
        <div className="flex gap-1">
          <button onClick={() => setDateRange('today')} className="px-2 py-1.5 text-xs border border-input rounded-lg hover:bg-muted">วันนี้</button>
          <button onClick={() => setDateRange('week')} className="px-2 py-1.5 text-xs border border-input rounded-lg hover:bg-muted">สัปดาห์นี้</button>
          <button onClick={() => setDateRange('month')} className="px-2 py-1.5 text-xs border border-input rounded-lg hover:bg-muted">เดือนนี้</button>
          {(startDate || endDate) && (
            <button onClick={() => { setStartDate(''); setEndDate(''); }} className="px-2 py-1.5 text-xs text-red-600 border border-red-200 rounded-lg hover:bg-red-50">ล้าง</button>
          )}
        </div>

        {/* Branch filter (OWNER only) */}
        {isOwner && branches.length > 0 && (
          <select
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            className="px-3 py-2 border border-input rounded-lg text-sm"
          >
            <option value="">ทุกสาขา</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-5 lg:gap-7.5 mb-6">
        <div className="bg-card rounded-lg border p-4">
          <div className="text-xs text-muted-foreground">ทั้งหมด</div>
          <div className="text-xl font-bold">{summary?.totalCount ?? 0}</div>
        </div>
        <div className="bg-green-50 rounded-lg border border-green-200 p-4">
          <div className="text-xs text-green-600">ผ่าน</div>
          <div className="text-xl font-bold text-green-700">{summary?.approvedCount ?? 0}</div>
        </div>
        <div className="bg-amber-50 rounded-lg border border-amber-200 p-4">
          <div className="text-xs text-amber-600">รอวิเคราะห์ / ตรวจเพิ่ม</div>
          <div className="text-xl font-bold text-amber-700">{summary?.pendingCount ?? 0}</div>
        </div>
        <div className="bg-red-50 rounded-lg border border-red-200 p-4">
          <div className="text-xs text-red-600">ไม่ผ่าน</div>
          <div className="text-xl font-bold text-red-700">{summary?.rejectedCount ?? 0}</div>
        </div>
        <div className={`rounded-lg border p-4 ${summary?.avgScore ? avgScoreBg(summary.avgScore) : 'bg-card'}`}>
          <div className={`text-xs ${summary?.avgScore ? avgScoreLabel(summary.avgScore) : 'text-muted-foreground'}`}>คะแนน AI เฉลี่ย</div>
          <div className={`text-xl font-bold ${summary?.avgScore ? avgScoreColor(summary.avgScore) : ''}`}>
            {summary?.avgScore ?? '-'}
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
        </div>
      ) : (
        <>
          <DataTable
            columns={columns}
            data={creditChecks}
            emptyMessage="ยังไม่มีรายการตรวจเครดิต"
            onRowClick={(cc: CreditCheckItem) => setExpandedRow(expandedRow === cc.id ? null : cc.id)}
            pagination={creditChecksData ? {
              page: creditChecksData.page,
              totalPages: creditChecksData.totalPages,
              total: creditChecksData.total,
              onPageChange: setPage,
            } : undefined}
          />

          {/* Expanded AI detail */}
          {expandedRow && creditChecks.find((cc) => cc.id === expandedRow) && (() => {
            const cc = creditChecks.find((c) => c.id === expandedRow)!;
            const ai = cc.aiAnalysis as AiAnalysisData | null;
            return (
              <div className="mt-2 mb-4 bg-muted/50 border rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold">รายละเอียดการวิเคราะห์ AI — {cc.customer.name}</h4>
                  <button onClick={() => setExpandedRow(null)} className="text-xs text-muted-foreground hover:text-foreground">ปิด</button>
                </div>

                {ai ? (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {ai.monthlyIncome != null && (
                      <div className="bg-card rounded border p-3">
                        <div className="text-xs text-muted-foreground">รายได้เฉลี่ย/เดือน</div>
                        <div className="text-sm font-bold">{Number(ai.monthlyIncome).toLocaleString()} ฿</div>
                      </div>
                    )}
                    {ai.averageBalance != null && (
                      <div className="bg-card rounded border p-3">
                        <div className="text-xs text-muted-foreground">ยอดเงินเฉลี่ย</div>
                        <div className="text-sm font-bold">{Number(ai.averageBalance).toLocaleString()} ฿</div>
                      </div>
                    )}
                    {ai.affordabilityRatio != null && (
                      <div className="bg-card rounded border p-3">
                        <div className="text-xs text-muted-foreground">อัตราภาระหนี้</div>
                        <div className="text-sm font-bold">{(ai.affordabilityRatio * 100).toFixed(1)}%</div>
                      </div>
                    )}
                    {ai.incomeConsistency && (
                      <div className="bg-card rounded border p-3">
                        <div className="text-xs text-muted-foreground">ความสม่ำเสมอรายได้</div>
                        <div className={`text-sm font-bold ${ai.incomeConsistency === 'stable' ? 'text-green-600' : 'text-amber-600'}`}>
                          {ai.incomeConsistency === 'stable' ? 'สม่ำเสมอ' : 'ไม่สม่ำเสมอ'}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">ยังไม่มีข้อมูลจากการวิเคราะห์ AI</div>
                )}

                {/* Risk & Positive factors */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {ai?.riskFactors && ai.riskFactors.length > 0 && (
                    <div className="bg-red-50 border border-red-200 rounded p-3">
                      <div className="text-xs font-medium text-red-700 mb-1">ปัจจัยเสี่ยง</div>
                      <ul className="space-y-1">
                        {ai.riskFactors.map((f, i) => (
                          <li key={i} className="text-xs text-red-600 flex items-start gap-1">
                            <span className="mt-0.5">•</span> {f}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {ai?.positiveFactors && ai.positiveFactors.length > 0 && (
                    <div className="bg-green-50 border border-green-200 rounded p-3">
                      <div className="text-xs font-medium text-green-700 mb-1">ปัจจัยบวก</div>
                      <ul className="space-y-1">
                        {ai.positiveFactors.map((f, i) => (
                          <li key={i} className="text-xs text-green-600 flex items-start gap-1">
                            <span className="mt-0.5">•</span> {f}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                {/* AI Summary & Recommendation */}
                {(cc.aiSummary || cc.aiRecommendation) && (
                  <div className="space-y-2">
                    {cc.aiSummary && (
                      <div className="bg-card rounded border p-3">
                        <div className="text-xs text-muted-foreground mb-1">สรุปผลวิเคราะห์</div>
                        <div className="text-sm">{cc.aiSummary}</div>
                      </div>
                    )}
                    {cc.aiRecommendation && (
                      <div className="bg-card rounded border p-3">
                        <div className="text-xs text-muted-foreground mb-1">คำแนะนำ</div>
                        <div className="text-sm">{cc.aiRecommendation}</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}
        </>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <Modal isOpen title="ตรวจเครดิตใหม่" onClose={() => { setShowCreateModal(false); setSelectedCustomer(null); setBankName(''); setCustomerSearch(''); }}>
          <div className="space-y-4">
            {/* Customer selection */}
            {!selectedCustomer ? (
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">เลือกลูกค้า</label>
                <input
                  type="text"
                  placeholder="ค้นหาชื่อ, เบอร์โทร, เลขบัตร..."
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  className="w-full px-3 py-2 border border-input rounded-lg text-sm mb-3"
                />
                <div className="max-h-60 overflow-y-auto space-y-2">
                  {customers.map((c) => (
                    <div
                      key={c.id}
                      onClick={() => setSelectedCustomer(c)}
                      className="p-3 rounded-lg border cursor-pointer hover:border-primary-400 hover:bg-primary-50 transition-colors"
                    >
                      <div className="text-sm font-medium">{c.name}</div>
                      <div className="text-xs text-muted-foreground">{c.phone} {c.salary ? `| เงินเดือน ${parseFloat(c.salary).toLocaleString()} ฿` : ''}</div>
                    </div>
                  ))}
                  {customers.length === 0 && customerSearch && (
                    <div className="text-center py-4 text-sm text-muted-foreground">ไม่พบลูกค้า</div>
                  )}
                </div>
              </div>
            ) : (
              <div>
                <div className="bg-primary-50 rounded-lg p-3 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-primary-800">{selectedCustomer.name}</div>
                    <div className="text-xs text-primary">{selectedCustomer.phone} {selectedCustomer.salary ? `| เงินเดือน ${parseFloat(selectedCustomer.salary).toLocaleString()} ฿` : ''}</div>
                  </div>
                  <button onClick={() => setSelectedCustomer(null)} className="text-xs text-primary hover:text-primary/80">เปลี่ยน</button>
                </div>

                <div className="mt-4 space-y-3">
                  {/* Book Bank OCR */}
                  <div className="bg-primary-50 border border-primary-200 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1">
                      <h4 className="text-sm font-semibold text-primary-800">สแกนหน้าสมุดบัญชี (OCR)</h4>
                    </div>
                    <p className="text-xs text-primary mb-2">ถ่ายรูปหน้าสมุดบัญชีเพื่อกรอกชื่อธนาคารอัตโนมัติ</p>
                    <input
                      ref={bookBankFileRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handleBookBankScan}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => bookBankFileRef.current?.click()}
                      disabled={bookBankLoading}
                      className="inline-flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:bg-primary/90 disabled:opacity-50"
                    >
                      {bookBankLoading ? (
                        <>
                          <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white" />
                          กำลังอ่านสมุดบัญชี...
                        </>
                      ) : (
                        <>
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                          สแกนสมุดบัญชี
                        </>
                      )}
                    </button>

                    {/* Book bank OCR result */}
                    {bookBankResult && (
                      <div className="mt-2 p-2 bg-card rounded border border-primary-200 space-y-1">
                        <div className="text-xs text-muted-foreground">ผลการสแกน:</div>
                        {bookBankResult.accountName && <div className="text-xs"><span className="text-muted-foreground">ชื่อบัญชี:</span> <span className="font-medium">{bookBankResult.accountName}</span></div>}
                        {bookBankResult.accountNo && <div className="text-xs"><span className="text-muted-foreground">เลขที่บัญชี:</span> <span className="font-mono">{bookBankResult.accountNo}</span></div>}
                        {bookBankResult.bankName && <div className="text-xs"><span className="text-muted-foreground">ธนาคาร:</span> {bookBankResult.bankName} {bookBankResult.branchName && `(${bookBankResult.branchName})`}</div>}
                        {bookBankResult.accountType && <div className="text-xs"><span className="text-muted-foreground">ประเภท:</span> {bookBankResult.accountType}</div>}
                        {bookBankResult.balance !== null && <div className="text-xs"><span className="text-muted-foreground">ยอดเงิน:</span> <span className="font-bold text-green-700">{bookBankResult.balance.toLocaleString()} ฿</span></div>}
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">ธนาคาร</label>
                    <input
                      type="text"
                      value={bankName}
                      onChange={(e) => setBankName(e.target.value)}
                      placeholder="เช่น กสิกร, กรุงไทย..."
                      className="w-full px-3 py-2 border border-input rounded-lg text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Statement ย้อนหลัง 3 เดือน (ภาพ/PDF)</label>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/*,.pdf"
                      multiple
                      onChange={(e) => e.target.files && uploadMutation.mutate(e.target.files)}
                      disabled={uploadMutation.isPending}
                      className="w-full text-sm text-muted-foreground file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-primary-50 file:text-primary-700"
                    />
                  </div>
                  {uploadMutation.isPending && (
                    <div className="flex items-center gap-2 text-sm text-primary">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-600" />
                      กำลังอัปโหลดและสร้างรายการ...
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Override Modal */}
      {overrideId && (
        <Modal isOpen title="Override สถานะเครดิตเช็ค" onClose={() => { setOverrideId(null); setOverrideCustomerId(null); }}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">สถานะใหม่</label>
              <select
                value={overrideStatus}
                onChange={(e) => setOverrideStatus(e.target.value)}
                className="w-full px-3 py-2 border border-input rounded-lg text-sm"
              >
                <option value="">เลือกสถานะ...</option>
                <option value="APPROVED">อนุมัติ</option>
                <option value="REJECTED">ปฏิเสธ</option>
                <option value="MANUAL_REVIEW">ตรวจเพิ่มเติม</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">หมายเหตุ</label>
              <textarea
                value={overrideNotes}
                onChange={(e) => setOverrideNotes(e.target.value)}
                rows={2}
                placeholder="ระบุเหตุผล..."
                className="w-full px-3 py-2 border border-input rounded-lg text-sm"
              />
            </div>
            <div className="flex gap-3">
              <button onClick={() => { setOverrideId(null); setOverrideCustomerId(null); }} className="flex-1 px-4 py-2 text-sm border border-input rounded-lg">ยกเลิก</button>
              <button
                onClick={() => overrideMutation.mutate()}
                disabled={!overrideStatus || overrideMutation.isPending}
                className="flex-1 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
              >
                {overrideMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
