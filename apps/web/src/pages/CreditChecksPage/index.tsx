import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { exportToExcel, type ExcelColumn } from '@/utils/excel.util';
import api, { getErrorMessage } from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';
import { formatDateShort } from '@/utils/formatters';
import PageHeader from '@/components/ui/PageHeader';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

import {
  type Branch,
  type CreditChecksResponse,
  type CreditCheckItem,
  type AiAnalysisData,
  statusLabels,
} from './types';
import CreditCheckFilters from './CreditCheckFilters';
import CreditCheckTable from './CreditCheckTable';
import CreditCheckOverrideModal from './CreditCheckOverrideModal';

export default function CreditChecksPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isOwner = user?.role === 'OWNER';
  const isOwnerOrManager = ['OWNER', 'BRANCH_MANAGER'].includes(user?.role ?? '');

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounce(search);

  const canOverride = user && ['OWNER', 'BRANCH_MANAGER'].includes(user.role);
  const [overrideId, setOverrideId] = useState<string | null>(null);
  const [overrideCustomerId, setOverrideCustomerId] = useState<string | null>(null);
  const [overrideStatus, setOverrideStatus] = useState('');
  const [overrideNotes, setOverrideNotes] = useState('');

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, statusFilter, startDate, endDate, branchFilter]);

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
        { header: 'ผู้อนุมัติ', key: 'checkedByName', width: 18 },
        { header: 'วันที่อนุมัติ', key: 'checkedAt', width: 16 },
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
            checkedAt: cc.checkedAt ? formatDateShort(cc.checkedAt) : '-',
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

  return (
    <div>
      <PageHeader
        title="ตรวจเครดิต"
        subtitle="ภาพรวมการตรวจเครดิตทั้งระบบ — คลิกแถวเพื่อเปิดหน้าลูกค้า"
        action={
          <button
            onClick={exportExcel}
            className="px-4 py-2 text-sm border border-input rounded-lg hover:bg-muted"
          >
            ส่งออก Excel
          </button>
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
        onRowClick={(cc) => navigate(`/customers/${cc.customer.id}?tab=credit`)}
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
