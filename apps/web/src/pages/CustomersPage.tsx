import ResponsiveFilterPanel from '@/components/ui/ResponsiveFilterPanel';
import { createExportGuard, ExportError, fetchExportSnapshot, type ExportSnapshot } from '@/lib/fetch-export-pages';
import { formatThaiDateTime } from '@/lib/date';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router';
import { exportToExcel, type ExcelColumn } from '@/utils/excel.util';
import { formatDateShort } from '@/utils/formatters';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';
import { useUiFlags } from '@/hooks/useUiFlags';
import { useAuth } from '@/contexts/AuthContext';
import { maskNationalId, formatNationalId } from '@/utils/mask.util';
import { canCreateCustomer as canCreateCustomerRole } from '@/lib/constants';
import type { CustomerFormData } from '@/lib/schemas';
import {
  applyCreditFilter,
  CREDIT_CHECK_OPTIONS,
  CUSTOMER_CREDIT_OPTIONS,
} from '@/lib/customer-credit-filter';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import QueryBoundary from '@/components/QueryBoundary';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import CustomerCreateDialog, { splitDisplayName } from '@/components/customer/CustomerCreateDialog';
import { Download, ChevronUp, ChevronDown, Copy, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { getStatusBadgeProps, creditCheckStatusMap } from '@/lib/status-badges';
import CustomerTierBadge from '@/components/customer/CustomerTierBadge';
import type { CustomerTier } from '@/types/customer-tier';


interface Customer {
  id: string;
  nationalId: string;
  name: string;
  nickname: string | null;
  phone: string;
  lineIdFinance: string | null;
  lineIdShop: string | null;
  occupation: string | null;
  salary: number | null;
  createdAt: string;
  _count: { contracts: number };
  activeContracts: number;
  overdueContracts: number;
  latestCreditStatus: string | null;
  latestCreditScore: number | null;
  tier?: CustomerTier;
}

interface CustomerSummary {
  totalCustomers: number;
  withActiveContract: number;
  withOverdue: number;
  newThisMonth: number;
}

interface CustomersResponse {
  data: Customer[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  summary: CustomerSummary;
}

// 8 Tailwind token combos — deterministic hash from name → stable color per customer
const AVATAR_COLORS = [
  'bg-primary/15 text-primary',
  'bg-success/15 text-success',
  'bg-info/15 text-info',
  'bg-warning/15 text-warning',
  'bg-destructive/15 text-destructive',
  'bg-purple-500/15 text-purple-600 dark:text-purple-400',
  'bg-pink-500/15 text-pink-600 dark:text-pink-400',
  'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400',
];

const avatarColorFor = (name: string): string => {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
};

const formatRelativeDate = (iso: string): string => {
  const diffDays = Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'วันนี้';
  if (diffDays === 1) return 'เมื่อวาน';
  if (diffDays < 7) return `${diffDays} วันก่อน`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} สัปดาห์ก่อน`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} เดือนก่อน`;
  return formatDateShort(iso);
};


export default function CustomersPage() {
  useDocumentTitle('ลูกค้า');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { exportEnabled } = useUiFlags();
  const { copy } = useCopyToClipboard();
  const isOwner = user?.role === 'OWNER';
  const isOwnerOrManager = ['OWNER', 'BRANCH_MANAGER'].includes(user?.role ?? '');
  const canViewSalary = ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT'].includes(user?.role ?? '');
  // ต้องตรงกับ `@Roles` ของ `POST /customers` + `POST /customers/pre-check/:id/complete` — รายการอยู่ที่ lib/constants ใช้ร่วมกับแผงขวาห้องแชท
  const canCreateCustomer = canCreateCustomerRole(user?.role);

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounce(search);
  const [contractStatusFilter, setContractStatusFilter] = useState('');
  const [hasOverdueFilter, setHasOverdueFilter] = useState(false);
  const [creditStatusFilter, setCreditStatusFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [tierFilter, setTierFilter] = useState('');
  const [sortBy, setSortBy] = useState('');
  const [sortOrder, setSortOrder] = useState('asc');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [linkAfterCreate, setLinkAfterCreate] = useState<{ roomId: string } | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [prefill, setPrefill] = useState<Partial<CustomerFormData> | null>(null);

  useEffect(() => { setPage(1); }, [debouncedSearch, contractStatusFilter, hasOverdueFilter, creditStatusFilter, branchFilter, tierFilter, sortBy, sortOrder]);

  // Prefill + auto-open modal when arriving from a chat room "create customer" CTA
  // Expected query params: ?new=1&name=<displayName>&fromRoomId=<roomId>
  useEffect(() => {
    if (searchParams.get('new') !== '1') return;
    const prefillName = searchParams.get('name') ?? '';
    const fromRoomId = searchParams.get('fromRoomId');
    if (prefillName) setPrefill(splitDisplayName(prefillName));
    if (fromRoomId) {
      setLinkAfterCreate({ roomId: fromRoomId });
    }
    setIsModalOpen(true);
    // Clear params so refresh doesn't re-open the modal
    const next = new URLSearchParams(searchParams);
    next.delete('new');
    next.delete('name');
    next.delete('fromRoomId');
    setSearchParams(next, { replace: true });
  }, []);

  const buildParams = (targetPage = page, targetLimit = 50) => {
    const params: Record<string, string> = {};
    if (debouncedSearch) params.search = debouncedSearch;
    if (contractStatusFilter) params.contractStatus = contractStatusFilter;
    if (hasOverdueFilter) params.hasOverdue = 'true';
    applyCreditFilter(params, creditStatusFilter);
    if (branchFilter) params.branchId = branchFilter;
    if (tierFilter) params.tier = tierFilter;
    if (sortBy) params.sortBy = sortBy;
    if (sortBy) params.sortOrder = sortOrder;
    params.page = String(targetPage);
    params.limit = String(targetLimit);
    return params;
  };

  const { data: result, isLoading, isError, error, refetch } = useQuery<CustomersResponse>({
    queryKey: ['customers', debouncedSearch, page, contractStatusFilter, hasOverdueFilter, creditStatusFilter, branchFilter, tierFilter, sortBy, sortOrder],
    queryFn: async () => {
      const params = buildParams();
      const { data } = await api.get('/customers', { params });
      return data;
    },
  });

  // Fetch branches (OWNER only)
  const { data: branches = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['branches'],
    queryFn: async () => (await api.get('/branches')).data,
    enabled: !!isOwner,
  });

  useEffect(() => {
    if (result && page > Math.max(1, result.totalPages)) setPage(Math.max(1, result.totalPages));
  }, [result, page]);
  const customers = result?.data ?? [];

  /** สร้างเสร็จ (จาก CustomerCreateDialog) — ถ้ามาจากห้องแชทผ่าน ?new=1 ให้ผูกห้องแล้วกลับ inbox เหมือนเดิม */
  const handleCreated = async (created: { id: string }) => {
    queryClient.invalidateQueries({ queryKey: ['customers'] });
    if (linkAfterCreate?.roomId) {
      try {
        await api.patch(`/staff-chat/rooms/${linkAfterCreate.roomId}/customer`, { customerId: created.id });
        queryClient.invalidateQueries({ queryKey: ['chat-room', linkAfterCreate.roomId] });
        toast.success('ผูกลูกค้ากับแชทแล้ว');
        setLinkAfterCreate(null);
        navigate('/inbox');
        return;
      } catch (err) {
        toast.error(`ผูกลูกค้ากับแชทไม่สำเร็จ: ${getErrorMessage(err)}`);
        // Fall through to default navigation
      }
    }
    navigate(`/customers/${created.id}`);
  };

  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null);

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => api.delete(`/customers/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success('ลบลูกค้าสำเร็จ');
      setDeleteTarget(null);
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err));
    },
  });

  const navigateToCustomer = useCallback((id: string) => navigate(`/customers/${id}`), [navigate]);

  const copyValue = useCallback(
    (e: React.MouseEvent, value: string, label: string) => {
      e.stopPropagation();
      copy(value);
      toast.success(`คัดลอก${label}แล้ว`);
    },
    [copy],
  );

  const [isExporting, setIsExporting] = useState(false);
  const exportExcel = async () => {
    const assertCurrent = createExportGuard();
    try {
      toast.loading('กำลังสร้างไฟล์ Excel...', { id: 'excel-export' });
      setIsExporting(true);
      const snapshot = await fetchExportSnapshot<Customer>(async () =>
        (await api.get<ExportSnapshot<Customer>>('/customers/export', { params: buildParams(1, 50), timeout: 65_000 })).data, assertCurrent);
      const allRows = snapshot.data;

      const baseCols: ExcelColumn[] = [
        { header: 'ชื่อ', key: 'name', width: 22 },
        { header: 'ชื่อเล่น', key: 'nickname', width: 14 },
        { header: 'เบอร์โทร', key: 'phone', width: 14 },
        { header: 'อาชีพ', key: 'occupation', width: 18 },
        { header: 'สัญญาทั้งหมด', key: 'totalContracts', width: 12 },
        { header: 'สัญญา Active', key: 'activeContracts', width: 12 },
        { header: 'สัญญาค้างชำระ', key: 'overdueContracts', width: 12 },
        { header: 'สถานะเครดิต', key: 'creditStatus', width: 14 },
        { header: 'คะแนนเครดิต', key: 'creditScore', width: 12 },
        { header: 'วันที่เพิ่ม', key: 'createdAt', width: 14 },
        { header: 'ข้อมูล ณ (เวลาไทย)', key: 'fetchedAt', width: 24 },
      ];

      if (isOwnerOrManager) {
        baseCols.push({ header: 'เลขบัตร ปชช.', key: 'nationalId', width: 18 });
      }
      if (canViewSalary) {
        baseCols.push({ header: 'เงินเดือน', key: 'salary', width: 14 });
      }

      const now = new Date();
      await exportToExcel({
        assertCurrent,
        columns: baseCols,
        data: allRows.map((c: Customer) => {
          const row: Record<string, unknown> = {
            name: c.name,
            fetchedAt: formatThaiDateTime(snapshot.asOf, 'Asia/Bangkok'),
            nickname: c.nickname || '-',
            phone: c.phone,
            occupation: c.occupation || '-',
            totalContracts: c._count.contracts,
            activeContracts: c.activeContracts,
            overdueContracts: c.overdueContracts,
            creditStatus: c.latestCreditStatus || '-',
            creditScore: c.latestCreditScore != null ? `${c.latestCreditScore}/100` : '-',
            createdAt: formatDateShort(c.createdAt),
          };
          if (isOwnerOrManager) {
            row.nationalId = c.nationalId;
          }
          if (canViewSalary) {
            row.salary = c.salary ? Number(c.salary) : '-';
          }
          return row;
        }),
        sheetName: 'รายชื่อลูกค้า',
        filename: `รายชื่อลูกค้า_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}.xlsx`,
      });
      toast.success(`ดาวน์โหลดสำเร็จ (${allRows.length} รายการ)`, { id: 'excel-export' });
    } catch (error) {
      toast.error(error instanceof ExportError ? error.message : getErrorMessage(error), { id: 'excel-export' });
    } finally { setIsExporting(false); }
  };

  const columns = useMemo(() => [
    {
      key: 'name',
      label: 'ลูกค้า',
      render: (c: Customer) => (
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={`size-9 rounded-full flex items-center justify-center shrink-0 font-semibold text-sm select-none ${avatarColorFor(c.name)}`}
          >
            {c.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-foreground truncate">
              {c.name}
              {c.nickname && (
                <span className="text-muted-foreground font-normal"> ({c.nickname})</span>
              )}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: 'phone',
      label: 'เบอร์โทร',
      render: (c: Customer) => (
        <div className="group inline-flex items-center gap-1.5">
          <span className="text-sm text-foreground tabular-nums">{c.phone}</span>
          <button
            type="button"
            onClick={(e) => copyValue(e, c.phone, 'เบอร์โทร')}
            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
            aria-label="คัดลอกเบอร์โทร"
          >
            <Copy className="size-3.5" />
          </button>
        </div>
      ),
    },
    {
      key: 'nationalId',
      label: 'เลขบัตร',
      hideable: true,
      render: (c: Customer) => (
        <div className="group inline-flex items-center gap-1.5">
          <span className="font-mono text-xs text-muted-foreground">{isOwner ? formatNationalId(c.nationalId) : maskNationalId(c.nationalId)}</span>
          {isOwnerOrManager && (
            <button
              type="button"
              onClick={(e) => copyValue(e, c.nationalId, 'เลขบัตร')}
              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
              aria-label="คัดลอกเลขบัตร"
            >
              <Copy className="size-3.5" />
            </button>
          )}
        </div>
      ),
    },
    {
      key: 'occupation',
      label: 'อาชีพ',
      hideable: true,
      render: (c: Customer) => <span className="text-sm text-muted-foreground">{c.occupation || '—'}</span>,
    },
    ...(canViewSalary ? [{
      key: 'salary',
      label: 'เงินเดือน',
      hideable: true,
      render: (c: Customer) => (
        <span className="text-sm tabular-nums">{c.salary ? Number(c.salary).toLocaleString('th-TH') + ' ฿' : '—'}</span>
      ),
    }] : []),
    {
      key: 'contracts',
      label: 'สัญญา',
      render: (c: Customer) => (
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-foreground tabular-nums">{c._count.contracts} รายการ</span>
          <div className="flex items-center gap-2">
            {c.activeContracts > 0 && (
              <span className="text-xs text-success font-medium">{c.activeContracts} ใช้งาน</span>
            )}
            {c.overdueContracts > 0 && (
              <span className="text-xs text-destructive font-semibold">{c.overdueContracts} ค้างชำระ</span>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'credit',
      label: 'เครดิต',
      hideable: true,
      render: (c: Customer) => {
        if (!c.latestCreditStatus) return <span className="text-xs text-muted-foreground">—</span>;
        const cfg = getStatusBadgeProps(c.latestCreditStatus, creditCheckStatusMap);
        return (
          <div className="flex flex-col gap-0.5">
            <Badge variant={cfg.variant} appearance={cfg.appearance} size="sm">{cfg.label}</Badge>
            {c.latestCreditScore != null && (
              <span className="text-2xs text-muted-foreground">{c.latestCreditScore}/100</span>
            )}
          </div>
        );
      },
    },
    {
      key: 'tier',
      label: 'ระดับ',
      hideable: true,
      render: (c: Customer) =>
        c.tier ? <CustomerTierBadge tier={c.tier} /> : null,
    },
    {
      key: 'createdAt',
      label: 'วันที่เพิ่ม',
      hideable: true,
      render: (c: Customer) => (
        <span className="text-xs text-muted-foreground whitespace-nowrap">{formatRelativeDate(c.createdAt)}</span>
      ),
    },
    ...(isOwner ? [{
      key: 'actions',
      label: '',
      render: (c: Customer) => (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setDeleteTarget(c); }}
          className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded transition-colors"
          aria-label={`ลบลูกค้า ${c.name}`}
          title="ลบลูกค้า"
        >
          <Trash2 className="size-4" strokeWidth={1.5} />
        </button>
      ),
    }] : []),
  ], [canViewSalary, isOwner, isOwnerOrManager, copyValue]);


  return (
    <div>
      <PageHeader
        title="ลูกค้า"
        subtitle={`ทั้งหมด ${result?.total ?? 0} ราย`}
        action={
          <div className="flex gap-2">
            {/* D1.3.3.1 — hide export button when OWNER disables export_enabled. */}
            {exportEnabled && (
              <button
                onClick={exportExcel} disabled={isExporting || isLoading || isError}
                className="inline-flex items-center gap-1.5 px-4 py-2 border border-input text-foreground rounded-lg text-sm font-medium hover:bg-accent transition-colors"
              >
                <Download className="w-4 h-4" />
                ส่งออก Excel
              </button>
            )}
            {/* ซ่อนจากบทบาทที่ `POST /customers` ไม่รับ (ผจก.การเงิน / ฝ่ายบัญชี) —
                พวกเขาเปิดทะเบียนลูกค้าได้ (มาจากปุ่มในหน้าแชท) แต่สร้างลูกค้าไม่ได้
                ⇒ ถ้าโชว์ปุ่มไว้ กดแล้วจะโดน MainLayout เด้งกลับ Dashboard
                ปักไว้ที่ config/__tests__/cta-reachability.test.ts */}
            {canCreateCustomer && (
              <button onClick={() => setIsModalOpen(true)} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90">
                + เพิ่มลูกค้าใหม่
              </button>
            )}
          </div>
        }
      />

      {/* Summary Cards — Metronic KPI style */}
      {result?.summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 lg:gap-5 mb-6">
          <Card className="hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 overflow-hidden">
            <CardContent className="p-5 relative">
              <div className="absolute inset-y-0 left-0 w-1 bg-primary rounded-l-xl" />
              <div className="pl-2">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ลูกค้าทั้งหมด</div>
                <div className="text-2xl font-bold text-foreground">{result.summary.totalCustomers.toLocaleString()}</div>
              </div>
            </CardContent>
          </Card>
          <Card className="hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 overflow-hidden">
            <CardContent className="p-5 relative">
              <div className="absolute inset-y-0 left-0 w-1 bg-success rounded-l-xl" />
              <div className="pl-2">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">มีสัญญาผ่อน</div>
                <div className="text-2xl font-bold text-success">{result.summary.withActiveContract.toLocaleString()}</div>
              </div>
            </CardContent>
          </Card>
          <Card className="hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 overflow-hidden">
            <CardContent className="p-5 relative">
              <div className="absolute inset-y-0 left-0 w-1 bg-destructive rounded-l-xl" />
              <div className="pl-2">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ค้างชำระ</div>
                <div className={`text-2xl font-bold ${result.summary.withOverdue > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>{result.summary.withOverdue.toLocaleString()}</div>
              </div>
            </CardContent>
          </Card>
          <Card className="hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 overflow-hidden">
            <CardContent className="p-5 relative">
              <div className="absolute inset-y-0 left-0 w-1 bg-info rounded-l-xl" />
              <div className="pl-2">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">เพิ่มเดือนนี้</div>
                <div className="text-2xl font-bold text-info">{result.summary.newThisMonth.toLocaleString()}</div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters + Sorting — merged in one card */}
      <ResponsiveFilterPanel search={
          <div className="lg:col-span-2 relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input
              type="text"
              placeholder="ค้นหาชื่อ, เบอร์โทร, เลขบัตร ปชช..."
              aria-label="ค้นหาลูกค้า" value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-input rounded-lg text-sm outline-hidden focus:ring-2 focus:ring-ring/30 focus:border-ring transition-colors bg-background"
            />
          </div>
      }>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">

          <Select
            value={contractStatusFilter || 'ALL'}
            onValueChange={(v) => setContractStatusFilter(v === 'ALL' ? '' : v)}
          >
            <SelectTrigger className="h-10">
              <SelectValue placeholder="ทุกสถานะสัญญา" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">ทุกสถานะสัญญา</SelectItem>
              <SelectItem value="ACTIVE">มีสัญญา Active</SelectItem>
              <SelectItem value="COMPLETED">ปิดสัญญาแล้ว</SelectItem>
              <SelectItem value="DRAFT">ร่าง</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={creditStatusFilter || 'ALL'}
            onValueChange={(v) => setCreditStatusFilter(v === 'ALL' ? '' : v)}
          >
            <SelectTrigger aria-label="สถานะเครดิต" className="h-10">
              <SelectValue placeholder="ทุกสถานะเครดิต" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">ทุกสถานะเครดิต</SelectItem>
              <SelectGroup>
                <SelectLabel>สถานะเครดิตของลูกค้า</SelectLabel>
                {CUSTOMER_CREDIT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectGroup>
              <SelectGroup>
                <SelectLabel>สถานะใบตรวจล่าสุด</SelectLabel>
                {CREDIT_CHECK_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select
            value={tierFilter || 'ALL'}
            onValueChange={(v) => setTierFilter(v === 'ALL' ? '' : v)}
          >
            <SelectTrigger aria-label="ระดับลูกค้า" className="h-10">
              <SelectValue placeholder="ทุกระดับลูกค้า" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">ทุกระดับลูกค้า</SelectItem>
              <SelectItem value="GOLD">VIP (Gold)</SelectItem>
              <SelectItem value="GOOD">ลูกค้าดี</SelectItem>
              <SelectItem value="NEW">ลูกค้าใหม่</SelectItem>
              <SelectItem value="RISKY">ต้องระวัง</SelectItem>
              <SelectItem value="BLACKLIST">ห้ามทำสัญญา</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => setHasOverdueFilter(!hasOverdueFilter)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full border transition-all ${
              hasOverdueFilter
                ? 'bg-destructive/10 text-destructive border-destructive/40 shadow-sm'
                : 'border-input text-muted-foreground hover:bg-accent hover:text-foreground'
            }`}
          >
            <span className={`size-1.5 rounded-full ${hasOverdueFilter ? 'bg-destructive' : 'bg-muted-foreground'}`} />
            ค้างชำระ
          </button>
          {isOwner && (
            <Select
              value={branchFilter || 'ALL'}
              onValueChange={(v) => setBranchFilter(v === 'ALL' ? '' : v)}
            >
              <SelectTrigger className="h-9 w-auto min-w-[140px]">
                <SelectValue placeholder="ทุกสาขา" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">ทุกสาขา</SelectItem>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Sorting inline */}
          <div className="flex items-center gap-2 ml-auto text-xs">
            <span className="text-muted-foreground hidden sm:inline">เรียงโดย:</span>
            <Select value={sortBy || 'DEFAULT'} onValueChange={(v) => setSortBy(v === 'DEFAULT' ? '' : v)}>
              <SelectTrigger aria-label="เรียงลูกค้าโดย" className="h-9 w-auto min-w-[140px] text-xs">
                <SelectValue placeholder="ค่าเริ่มต้น" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="DEFAULT">ค่าเริ่มต้น</SelectItem>
                <SelectItem value="name">ชื่อ</SelectItem>
                <SelectItem value="createdAt">วันที่เพิ่ม</SelectItem>
                <SelectItem value="contractCount">จำนวนสัญญา</SelectItem>
                <SelectItem value="creditScore">เครดิตสกอร์</SelectItem>
              </SelectContent>
            </Select>
            {sortBy && (
              <button
                onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-input rounded-lg text-xs font-medium hover:bg-accent transition-colors"
              >
                {sortOrder === 'asc' ? (
                  <><ChevronUp className="w-3.5 h-3.5" /> น้อยไปมาก</>
                ) : (
                  <><ChevronDown className="w-3.5 h-3.5" /> มากไปน้อย</>
                )}
              </button>
            )}
          </div>
        </div>
      </ResponsiveFilterPanel>

      <Card>
        <CardHeader>
          <CardTitle>รายชื่อลูกค้า</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <QueryBoundary
            isLoading={isLoading && !result}
            isError={isError}
            error={error}
            onRetry={refetch}
            errorTitle="ไม่สามารถโหลดรายชื่อลูกค้าได้"
          >
            <DataTable
              columns={columns}
              data={customers}
              isLoading={isLoading}
              columnToggle
              emptyMessage="ไม่พบลูกค้า"
              onRowClick={(c) => navigate(`/customers/${c.id}`)}
              pagination={result ? {
                page: result.page,
                totalPages: result.totalPages,
                total: result.total,
                onPageChange: setPage,
              } : undefined}
            />
          </QueryBoundary>
        </CardContent>
      </Card>

      <CustomerCreateDialog
        open={isModalOpen}
        onOpenChange={(o) => {
          setIsModalOpen(o);
          // ปิดแล้วล้างค่าที่มากับ ?new=1 — กด "เพิ่มลูกค้า" รอบถัดไปต้องได้ฟอร์มเปล่า ไม่ผูกห้องเก่า
          if (!o) { setPrefill(null); setLinkAfterCreate(null); }
        }}
        initialValues={prefill ?? undefined}
        onCreated={handleCreated}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="ลบลูกค้า"
        description={deleteTarget ? `ต้องการลบลูกค้า "${deleteTarget.name}" ใช่หรือไม่? การลบจะไม่สามารถกู้คืนได้จากหน้าจอ หากลูกค้ามีสัญญาที่ยังเปิดอยู่จะไม่สามารถลบได้` : ''}
        confirmLabel="ลบ"
        variant="destructive"
        loading={deleteMutation.isPending}
        onConfirm={() => { if (deleteTarget) deleteMutation.mutate(deleteTarget.id); }}
      />
    </div>
  );
}
