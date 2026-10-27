import { NativeSelect } from '@/components/ui/native-select';
import { formControlClass } from '@/components/ui/form-styles';
import { useId as useFieldId } from 'react';
import { getReportDateRange } from '@/lib/date';
import { useAccountingPermissions } from '@/hooks/useAccountingPermissions';
import { useState, useMemo, useRef } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usePaginationParams } from '@/hooks/usePaginationParams';
import { useUiFlags } from '@/hooks/useUiFlags';
import { PaginationBar } from '@/components/ui/PaginationBar';
import { toast } from 'sonner';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import { useDebounce } from '@/hooks/useDebounce';
import { useCoaGroups } from '@/hooks/useCoa';
import DataTable from '@/components/ui/DataTable';
import QueryBoundary from '@/components/QueryBoundary';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ReverseConfirmDialog } from '@/components/accounting';
import { Receipt, Plus, Pencil, MoreVertical, Bookmark, CalendarClock, Wallet, BarChart3, Search, SlidersHorizontal, Eye, ArrowRight, ChevronDown, FileText, CreditCard, Send, CheckCircle2 } from 'lucide-react';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { formatDateShortThai, formatNumberDecimal } from '@/utils/formatters';
import { accountDisplayName } from '@/utils/accountName';
import { ExpenseFormV4 } from '@/components/expense-form-v4/ExpenseFormV4';
import { ReopenedPeriodBanner } from '@/components/accounting/ReopenedPeriodBanner';
import { useApprovalActions, getApprovalReason, toastActionError } from '@/hooks/useApprovalActions';
import { isPayrollEditable, payrollEditPath } from '@/components/expense-form-v4/payroll-system/payroll-status';
import { OPEN_DOC_LABEL } from '@/components/expense-form-v4/payroll-system/payroll-copy';

// ─── Types ───
interface ExpenseDocument {
  id: string;
  number: string;
  documentType: 'EXPENSE' | 'CREDIT_NOTE' | 'PAYROLL' | 'VENDOR_SETTLEMENT' | 'PETTY_CASH_REIMBURSEMENT';
  branchId: string;
  documentDate: string;
  vendorName: string | null;
  vendorTaxId: string | null;
  taxInvoiceNo: string | null;
  description: string | null;
  subtotal: string;
  vatAmount: string;
  withholdingTax: string;
  totalAmount: string;
  netPayment: string | null;
  status: 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'ACCRUAL' | 'POSTED' | 'VOIDED';
  paidAt: string | null;
  paymentMethod: string | null;
  depositAccountCode: string | null;
  expenseDetail: { lines: { category: string }[] } | null;
  branch: { id: string; name: string };
  createdBy: { id: string; name: string };
  createdAt: string;
  reference: string | null;
  note: string | null;
  receiptImageUrl: string | null;
}

// Alias for backward compat with existing code in the file
type Expense = ExpenseDocument;

interface Summary {
  totalCount: number;
  byStatus: Record<string, number>;
  accrualUnpaidCount: number;
  /** Decimal serialized as fixed-2 string (e.g. "1234.56") */
  accrualUnpaidTotal: string;
}

// Map documentType to display "type" (with Same-day vs Accrual fallback for EXPENSE)
function getDocumentType(e: Expense): { label: string; cls: string } {
  switch (e.documentType) {
    case 'CREDIT_NOTE':
      return { label: 'ใบลดหนี้', cls: 'bg-destructive/10 text-destructive border-destructive/20' };
    case 'PAYROLL':
      return { label: 'เงินเดือน', cls: 'bg-info/10 text-info border-info/20' };
    case 'VENDOR_SETTLEMENT':
      return { label: 'จ่ายเจ้าหนี้', cls: 'bg-muted text-muted-foreground border-border' };
    case 'PETTY_CASH_REIMBURSEMENT':
      return { label: "เงินสดย่อย", cls: 'bg-accent/30 text-foreground border-border' };
    case 'EXPENSE':
    default:
      return e.status === 'ACCRUAL'
        ? { label: 'ตั้งหนี้', cls: 'bg-warning/10 text-warning-strong border-warning/20' }
        : { label: "จ่ายวันเดียวกัน", cls: 'bg-success/10 text-success border-success/20' };
  }
}

// Derived status badge — 6 statuses mapped to user-facing labels.
// D1.2.1 adds PENDING_APPROVAL + APPROVED (warning/info hues).
function getStatusBadge(e: Expense): { label: string; cls: string } {
  if (e.status === 'DRAFT')
    return { label: 'ฉบับร่าง', cls: 'bg-muted text-muted-foreground border-border' };
  if (e.status === 'PENDING_APPROVAL')
    return { label: 'รออนุมัติ', cls: 'bg-warning/10 text-warning-strong border-warning/40' };
  if (e.status === 'APPROVED')
    return { label: 'อนุมัติแล้ว', cls: 'bg-info/10 text-info border-info/40' };
  if (e.status === 'VOIDED')
    return { label: "ยกเลิกแล้ว", cls: 'bg-muted text-muted-foreground border-border' };
  if (e.status === 'ACCRUAL')
    return { label: "ตั้งค้างจ่าย", cls: 'bg-success/10 text-success border-success/20' };
  return { label: 'ผ่านรายการ', cls: 'bg-success/10 text-success border-success/20' };
}

// ─── Constants ───

const statusLabels: Record<string, string> = {
  DRAFT: 'ร่าง',
  PENDING_APPROVAL: 'รออนุมัติ',
  APPROVED: 'อนุมัติแล้ว',
  ACCRUAL: 'ตั้งหนี้',
  POSTED: 'บันทึกแล้ว',
  VOIDED: 'ยกเลิก',
};

const inputClass = formControlClass;

function fmt(n: string | number | null | undefined): string {
  if (n == null) return '-';
  return formatNumberDecimal(n, 2);
}

// ─── Main Page ───
export default function ExpensesPage() {
  const fieldId = useFieldId();
  const queryClient = useQueryClient();
  // D1.2.4 follow-up — feature flag for the Expense Templates ("รายการโปรด")
  // surface. When OWNER disables, the favorites tab + entry button are
  // hidden. Default true so first paint matches legacy behaviour.
  const { templatesEnabled } = useUiFlags();
  const permissions = useAccountingPermissions();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFilter = searchParams.get('tab') || 'all';
  const statusFilter = searchParams.get('status') || '';
  const categoryFilter = searchParams.get('category') || '';
  const branchFilter = searchParams.get('branch') || '';
  const startDate = searchParams.get('startDate') || '';
  const endDate = searchParams.get('endDate') || '';
  // D1.2.3.2 — defaultSize derived from OWNER-configured `pagination_size`.
  const { paginationSize } = useUiFlags();
  const { page, size, setPage, setSize } = usePaginationParams({ defaultSize: paginationSize });
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const debouncedSearch = useDebounce(search, 300);
  const [showForm, setShowForm] = useState(false);
  const menuTriggers = useRef(new Map<string, HTMLButtonElement>());
  const activeMenuRecord = useRef<string | null>(null);
  const restoreMenuFocus = (event: Event) => {
    event.preventDefault();
    // Dialog state can remount table cells; resolve the current trigger by row ID.
    if (activeMenuRecord.current) menuTriggers.current.get(activeMenuRecord.current)?.focus();
  };
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const navigate = useNavigate();
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; message: string; action: () => void }>({ open: false, message: '', action: () => {} });
  // C3.2 — Reverse Dialog state separate from generic ConfirmDialog so the
  // void path can capture reasonCode + reasonDetail + reverseDate.
  const [reverseDialog, setReverseDialog] = useState<{ open: boolean; id: string; number: string }>(
    { open: false, id: '', number: '' },
  );

  const setFilter = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams);
    if (value) params.set(key, value); else params.delete(key);
    // reset to page 1 whenever any filter changes (PDF AC-5.6)
    params.set('page', '1');
    setSearchParams(params, { replace: true });
  };

  const setTab = (tab: string) => {
    const params = new URLSearchParams(searchParams);
    if (tab === 'all') params.delete('tab'); else params.set('tab', tab);
    params.delete('page'); // reset pagination when switching tabs
    params.delete('status'); // tab supersedes manual status filter
    setSearchParams(params, { replace: true });
  };

  const setDateRange = (range: { startDate: string; endDate: string }) => {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(range)) {
      if (value) params.set(key, value); else params.delete(key);
    }
    params.delete('page');
    setSearchParams(params, { replace: true });
  };

  const quickPresets = [
    { label: 'เดือนนี้', fn: () => setDateRange(getReportDateRange('this_month')) },
    { label: '3 เดือน', fn: () => setDateRange(getReportDateRange('last_three_months')) },
    { label: 'ปีนี้', fn: () => setDateRange(getReportDateRange('this_year')) },
  ];

  const invalidateAll = () => { queryClient.invalidateQueries({ queryKey: ['expenses'] }); queryClient.invalidateQueries({ queryKey: ['expenses-summary'] }); };

  const { data: branches = [] } = useQuery<{ id: string; name: string }[]>({ queryKey: ['branches'], queryFn: async () => (await api.get('/branches')).data });

  const { data: coaData } = useCoaGroups({ type: 'ค่าใช้จ่าย' });
  const coaGroups = coaData?.groups ?? [];
  const codeToName = useMemo(() => {
    const m = new Map<string, string>();
    coaGroups.forEach((g) => g.accounts.forEach((a) => m.set(a.code, a.name)));
    return m;
  }, [coaGroups]);

  const { data: summary } = useQuery<Summary>({
    queryKey: ['expenses-summary', branchFilter, startDate, endDate],
    queryFn: async () => { const p = new URLSearchParams(); if (branchFilter) p.set('branchId', branchFilter); if (startDate) p.set('startDate', startDate); if (endDate) p.set('endDate', endDate); return (await api.get(`/expense-documents/summary?${p}`)).data; },
  });

  const {
    data: expensesData,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<{ data: Expense[]; total: number }>({
    queryKey: ['expenses', tabFilter, statusFilter, categoryFilter, branchFilter, startDate, endDate, debouncedSearch, page, size],
    queryFn: async () => {
      const p = new URLSearchParams({ limit: String(size), page: String(page) });
      if (tabFilter && tabFilter !== 'all') p.set('tab', tabFilter);
      if (statusFilter) p.set('status', statusFilter);
      if (categoryFilter) p.set('category', categoryFilter);
      if (branchFilter) p.set('branchId', branchFilter);
      if (startDate) p.set('startDate', startDate);
      if (endDate) p.set('endDate', endDate);
      if (debouncedSearch) p.set('search', debouncedSearch);
      return (await api.get(`/expense-documents?${p}`)).data;
    },
  });

  const actionMutation = useMutation({
    mutationFn: async ({ id, action, body }: { id: string; action: string; body?: Record<string, unknown> }) => {
      // Old API actions (submit/approve/reject/accrue/pay) collapse to "post" in the new API.
      // Only "void" survives as a distinct action.
      const newAction = action === 'void' ? 'void' : 'post';
      return api.post(`/expense-documents/${id}/${newAction}`, body || {});
    },
    onSuccess: () => { invalidateAll(); toast.success('อัปเดตสถานะสำเร็จ'); },
    onError: toastActionError,
  });

  const openCreate = () => { setShowForm(true); };
  const openEdit = (e: Expense) => {
    // The form only supports PATCH for payroll. Other document types create new records.
    // Payroll D4 คำตัดสิน 6 — ใบที่รออนุมัติ/อนุมัติแล้วแก้ได้ (บันทึกแล้ว server ตั้งกลับเป็นร่าง)
    if (!isPayrollEditable(e)) return;
    navigate(payrollEditPath(e.id));
  };
  const handleFormSaved = () => { setShowForm(false); invalidateAll(); };

  // D1.2.1 — Approval Workflow. Flags + mutations stay at page level so all
  // row actions share the same react-query cache invalidations + sonner toasts.
  const uiFlags = useUiFlags();
  const { submitForApproval, approve } = useApprovalActions();
  const isApprover = permissions.can('EXPENSE_APPROVE');

  const total = expensesData?.total ?? 0;

  // Tab counts derived from summary endpoint
  const totalCount = summary?.totalCount ?? 0;
  const draftCount = summary?.byStatus?.DRAFT ?? 0;
  const unpaidCount = summary?.accrualUnpaidCount ?? 0;
  const unpaidTotal = summary?.accrualUnpaidTotal ?? '0.00';
  const paidCount = summary?.byStatus?.POSTED ?? 0;
  const recordedCount = totalCount - draftCount;

  // D1.2.4 follow-up — strip 'favorites' tab when templates feature is OFF.
  const tabs = [
    { id: 'all', label: 'ทั้งหมด', count: totalCount, icon: Receipt },
    { id: 'draft', label: 'ฉบับร่าง', count: draftCount, icon: FileText },
    { id: 'unpaid', label: 'รอจ่าย', count: unpaidCount, sub: parseFloat(unpaidTotal) > 0 ? `รวม ${fmt(unpaidTotal)} B` : undefined, icon: Wallet },
    { id: 'recorded', label: 'บันทึกแล้ว', count: recordedCount, icon: CreditCard },
    { id: 'paid', label: 'จ่ายแล้ว', count: paidCount, icon: Receipt },
    ...(templatesEnabled
      ? [{ id: 'favorites' as const, label: 'รายการโปรด', count: 0, sub: 'ใช้บันทึกซ้ำ', icon: Bookmark }]
      : []),
    { id: 'daily-summary', label: 'สรุปรายวัน', icon: BarChart3, isAction: true },
  ] as const;

  const columns = [
    {
      key: 'number',
      label: 'เลขเอกสาร',
      render: (e: Expense) => <span className="font-mono text-sm font-medium text-warning-strong">{e.number}</span>,
    },
    {
      key: 'vendorName',
      label: 'ผู้ขาย',
      render: (e: Expense) => <span className="text-sm">{e.vendorName || '–'}</span>,
    },
    {
      key: 'category',
      label: 'บัญชี',
      render: (e: Expense) => {
        const code = e.expenseDetail?.lines?.[0]?.category;
        return code ? (
          <div className="min-w-0">
            <div className="font-mono text-sm font-medium text-warning-strong">{code}</div>
            <div className="text-xs text-muted-foreground truncate">{codeToName.get(code) || code}</div>
          </div>
        ) : (
          <span className="text-muted-foreground">–</span>
        );
      },
    },
    {
      key: 'totalAmount',
      label: 'ยอดรวม',
      render: (e: Expense) => {
        const amt = parseFloat(e.totalAmount || '0');
        const isCredit = e.documentType === 'CREDIT_NOTE';
        const isUnpaid = e.status === 'ACCRUAL' && !e.paidAt;
        return (
          <div className="text-right">
            <div className={`font-mono font-medium text-sm ${isCredit ? 'text-destructive' : ''}`}>
              {fmt(isCredit ? -Math.abs(amt) : amt)}
            </div>
            {isUnpaid && (
              <div className="text-xs text-muted-foreground">
                คงค้าง <span className="font-mono">{fmt(amt)}</span>
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: 'documentDate',
      label: 'วันที่ใบกำกับ',
      render: (e: Expense) => <span className="text-sm">{formatDateShortThai(e.documentDate)}</span>,
    },
    {
      key: 'docType',
      label: 'ประเภท',
      render: (e: Expense) => {
        const t = getDocumentType(e);
        return (
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs border font-medium leading-snug ${t.cls}`}>
            {t.label}
          </span>
        );
      },
    },
    {
      key: 'status',
      label: 'สถานะ',
      render: (e: Expense) => {
        const s = getStatusBadge(e);
        return (
          <div>
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs border font-semibold uppercase tracking-wide leading-snug ${s.cls}`}>
              {s.label}
            </span>
          </div>
        );
      },
    },
    {
      key: 'actions',
      label: 'จัดการ',
      align: 'right' as const,
      render: (e: Expense) => (
        <div className="ml-auto flex w-max items-center gap-2" onClick={(event) => event.stopPropagation()}>
          <button data-ui-control="button" data-ui-icon="true"
            onClick={(ev) => { ev.stopPropagation(); navigate(`/expenses/${e.id}`); }}
            className="inline-flex size-11 shrink-0 items-center justify-center hover:bg-muted rounded transition-colors"
            title="ดูรายละเอียด"
            aria-label={`ดูรายละเอียด ${e.number}`}
          >
            <Eye className="size-4 text-muted-foreground" />
          </button>
          {e.status !== 'VOIDED' && (
            <DropdownMenu onOpenChange={(open) => { if (open) activeMenuRecord.current = e.id; }}>
              <DropdownMenuTrigger asChild>
                <button ref={(node) => {
                  if (node) menuTriggers.current.set(e.id, node);
                  else menuTriggers.current.delete(e.id);
                }} data-ui-control="button" data-ui-icon="true"
                  type="button"
                  className="inline-flex size-11 shrink-0 items-center justify-center hover:bg-muted rounded transition-colors"
                  aria-label={`เมนู ${e.number}`}
                >
                  <MoreVertical className="size-4 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-44">
                  {e.status === 'DRAFT' && (
                    <>
                      <DropdownMenuItem disabled={e.documentType !== 'PAYROLL'} onSelect={() => openEdit(e)} className="min-h-11 flex items-center gap-2">
                        <Pencil className="size-4" /> แก้ไข
                      </DropdownMenuItem>
                      {e.documentType !== 'PAYROLL' && (
                        <p className="max-w-56 px-2 pb-2 text-xs leading-snug text-muted-foreground">
                          ยังไม่รองรับการแก้ไขเอกสารประเภทนี้
                        </p>
                      )}
                      {/* D1.2.1.1 — "ส่งขออนุมัติ" only when approval workflow is enabled. */}
                      {uiFlags.approvalEnabled && (
                        <>
                          <DropdownMenuItem
                            onSelect={() =>
                              setConfirmDialog({
                                open: true,
                                message: `ส่งเอกสาร "${e.number}" ขออนุมัติ?`,
                                action: () => submitForApproval.mutate(e.id),
                              })
                            }
                            className="min-h-11 flex items-center gap-2"
                            disabled={submitForApproval.isPending}
                          >
                            <Send className="size-4" /> ส่งขออนุมัติ
                          </DropdownMenuItem>
                          {(() => {
                            // D1.2.1.2 / D1.2.1.4 — explain WHY this doc needs approval.
                            const reason = getApprovalReason({
                              totalAmount: parseFloat(e.totalAmount || '0'),
                              docType: e.documentType,
                              approvalThreshold: uiFlags.approvalThreshold,
                              approvalRequiredDocTypes: uiFlags.approvalRequiredDocTypes,
                            });
                            if (!reason) return null;
                            return (
                              <div className="px-3 py-1 text-[10px] text-muted-foreground leading-snug border-t border-border/40 mt-1 pt-1.5">
                                เอกสารนี้ต้องผ่านการอนุมัติเนื่องจาก:
                                <br />
                                {reason}
                              </div>
                            );
                          })()}
                        </>
                      )}
                      {/* Legacy direct POST — hidden when approval workflow is on so
                          users follow the new lifecycle. Backend gate also rejects
                          direct POST on DRAFT when approvalEnabled is true. */}
                      {!uiFlags.approvalEnabled && permissions.can('EXPENSE_POST') && e.documentType !== 'PAYROLL' && (
                        <DropdownMenuItem
                          onSelect={() => setConfirmDialog({ open: true, message: `โพสต์ "${e.number}"?`, action: () => actionMutation.mutate({ id: e.id, action: 'post' }) })}
                          className="min-h-11"
                        >
                          โพสต์
                        </DropdownMenuItem>
                      )}
                    </>
                  )}
                  {(e.status === 'PENDING_APPROVAL' || e.status === 'APPROVED') && isPayrollEditable(e) && (
                    <DropdownMenuItem onSelect={() => openEdit(e)} className="min-h-11 flex items-center gap-2">
                      <Pencil className="size-4" /> แก้ไข
                    </DropdownMenuItem>
                  )}
                  {/* Payroll D4 — อนุมัติ/ลงบัญชีใบเงินเดือนต้องผ่านด่าน (เวลาปิดงวด · วันติดธง · ยอดเปลี่ยน)
                      ซึ่งหน้ารายละเอียดแสดงเหตุผลครบ ⇒ แถวใบเงินเดือนมี "เปิดใบ" แทน "อนุมัติเอกสาร"/"โพสต์" */}
                  {isPayrollEditable(e) && (
                    <DropdownMenuItem asChild className="min-h-11 flex items-center gap-2">
                      <Link to={`/expenses/${e.id}`}>
                        <Eye className="size-4" /> {OPEN_DOC_LABEL}
                      </Link>
                    </DropdownMenuItem>
                  )}
                  {/* D1.2.1.6 — APPROVE button. Visible only on PENDING_APPROVAL +
                      current user is in approversList (or OWNER). Backend
                      assertUserCanApprove() re-validates. */}
                  {e.status === 'PENDING_APPROVAL' && isApprover && e.documentType !== 'PAYROLL' && (
                    <DropdownMenuItem
                      onSelect={() =>
                        setConfirmDialog({
                          open: true,
                          message: `อนุมัติเอกสาร "${e.number}"?`,
                          action: () => approve.mutate(e.id),
                        })
                      }
                      className="min-h-11 flex items-center gap-2 text-info"
                      disabled={approve.isPending}
                    >
                      <CheckCircle2 className="size-4" /> อนุมัติเอกสาร
                    </DropdownMenuItem>
                  )}
                  {/* APPROVED docs that didn't auto-post fall back to the legacy
                      POST action — OWNER can still finalize them manually. */}
                  {e.status === 'APPROVED' && permissions.can('EXPENSE_POST') && e.documentType !== 'PAYROLL' && (
                    <DropdownMenuItem
                      onSelect={() =>
                        setConfirmDialog({
                          open: true,
                          message: `โพสต์ "${e.number}"?`,
                          action: () => actionMutation.mutate({ id: e.id, action: 'post' }),
                        })
                      }
                      className="min-h-11"
                    >
                      โพสต์
                    </DropdownMenuItem>
                  )}
                  {permissions.can('EXPENSE_CANCEL') && (
                    <DropdownMenuItem
                      onSelect={() => { setReverseDialog({ open: true, id: e.id, number: e.number }); }}
                      className="min-h-11 text-destructive"
                    >
                      ยกเลิก
                    </DropdownMenuItem>
                  )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      ),
    },
  ];

  return (
    <div onClick={() => { setShowCreateMenu(false); }} onKeyDown={(e) => { if (e.key === 'Escape') { setShowCreateMenu(false); } }}>
      <ReopenedPeriodBanner />
      {/* Compact branded header */}
      <div className="flex items-center justify-between gap-4 pb-4 mb-5 border-b border-border flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="size-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Receipt className="size-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-semibold leading-snug text-foreground break-words">ค่าใช้จ่าย</h1>
            <p className="text-sm text-muted-foreground leading-snug">บันทึกรายจ่ายและติดตามการจ่ายเงิน</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {templatesEnabled && (
            <button data-ui-control="button"
              type="button"
              onClick={() => navigate('/expenses/favorites')}
              className="px-3 py-1.5 rounded-lg border border-border text-xs flex items-center gap-1.5 hover:bg-muted transition-colors"
            >
              <Bookmark className="size-3.5 text-muted-foreground" />
              <span className="text-foreground">รายการโปรด</span>
              <span className="text-primary font-semibold ml-0.5 font-mono">0</span>
            </button>
          )}
          {templatesEnabled && (
            <button data-ui-control="button"
              type="button"
              onClick={() => navigate('/expenses/recurring-bills')}
              className="px-3 py-1.5 rounded-lg border border-border text-xs flex items-center gap-1.5 hover:bg-muted transition-colors"
            >
              <CalendarClock className="size-3.5 text-muted-foreground" />
              <span className="text-foreground">บิลประจำ</span>
            </button>
          )}
          <button data-ui-control="button" type="button" onClick={() => navigate('/expenses/ap-aging')} className="px-3 py-1.5 rounded-lg border border-border text-xs flex items-center gap-1.5 hover:bg-muted transition-colors">
            <Wallet className="size-3.5 text-muted-foreground" />
            <span className="text-foreground">เจ้าหนี้คงค้าง</span>
            <span className="text-primary font-semibold ml-0.5 font-mono">{fmt(unpaidTotal)}</span>
          </button>
          <button data-ui-control="button" type="button" onClick={() => navigate('/expenses/daily-summary')} className="px-3 py-1.5 rounded-lg border border-border text-xs flex items-center gap-1.5 hover:bg-muted transition-colors">
            <BarChart3 className="size-3.5 text-muted-foreground" />
            <span className="text-foreground">สรุปรายวัน</span>
          </button>
        </div>
      </div>

      {/* Filter tabs — 7 cards mirror screenshot */}
      <div className="finance-card-grid finance-card-grid-compact grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-5">
        {tabs.map((tab) => {
          const isActive = (tabFilter || 'all') === tab.id;
          const Icon = tab.icon;
          const isAction = 'isAction' in tab && tab.isAction;
          const hasCount = 'count' in tab && tab.count !== undefined;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                if (tab.id === 'favorites') {
                  navigate('/expenses/favorites');
                  return;
                }
                if (tab.id === 'daily-summary') {
                  navigate('/expenses/daily-summary');
                  return;
                }
                if (isAction) return;
                setTab(tab.id);
              }}
              className={cn(
                'rounded-xl border p-4 text-left transition-all hover:bg-muted/30',
                isActive
                  ? 'border-foreground/30 bg-card shadow-sm ring-1 ring-foreground/10'
                  : 'border-border bg-card/40',
              )}
            >
              <div className="flex items-start justify-between mb-1.5">
                <Icon className={cn('size-4', isActive ? 'text-foreground' : 'text-muted-foreground')} />
                {hasCount ? (
                  <span className={cn(
                    'text-2xl font-bold leading-none tabular-nums',
                    tab.id === 'paid' || tab.id === 'recorded' || tab.id === 'unpaid'
                      ? 'text-success'
                      : 'text-foreground',
                  )}>
                    {tab.count}
                  </span>
                ) : isAction ? (
                  <ArrowRight className="size-4 text-muted-foreground" />
                ) : null}
              </div>
              <div className="text-xs font-medium text-foreground leading-snug">{tab.label}</div>
              {'sub' in tab && tab.sub && (
                <div className="text-[10px] text-muted-foreground mt-0.5 leading-snug">{tab.sub}</div>
              )}
            </button>
          );
        })}
      </div>

      {/* Search + filter toggle + type select + create */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="flex-1 min-w-0 basis-[calc(100%-3.5rem)] sm:basis-auto sm:min-w-[260px] relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            aria-label="ค้นหาค่าใช้จ่าย"
            placeholder="ค้นหาเลขเอกสาร / ผู้ขาย / เลขใบกำกับ..."
            className={cn(formControlClass, 'pl-10')}
          />
        </div>
        <button data-ui-control="button" data-ui-icon="true"
          type="button"
          onClick={() => setShowAdvancedFilters((v) => !v)}
          className={cn(
            'size-10 shrink-0 rounded-lg border flex items-center justify-center transition-colors',
            showAdvancedFilters ? 'bg-primary/10 border-primary text-primary' : 'border-input hover:bg-muted text-muted-foreground',
          )}
          title="ตัวกรองเพิ่มเติม"
        >
          <SlidersHorizontal className="size-4" />
        </button>
        <NativeSelect wrapperClassName="max-w-full w-full min-w-0 sm:w-auto sm:min-w-[150px]"
          aria-label="ประเภทค่าใช้จ่าย"
          value={categoryFilter}
          onChange={(e) => setFilter('category', e.target.value)}
          className={cn(formControlClass, "")}
        >
          <option value="">ทุกประเภท</option>
          {coaGroups.map((g) => (
            <optgroup key={g.category} label={g.category}>
              {g.accounts.map((a) => (
                <option key={a.code} value={a.code}>
                  {accountDisplayName(a.name)}
                </option>
              ))}
            </optgroup>
          ))}
        </NativeSelect>
        <div className="relative" onClick={(ev) => ev.stopPropagation()}>
          <Button variant="primary" size="md" onClick={() => setShowCreateMenu((v) => !v)}>
            <Plus className="size-4" /> สร้างเอกสารใหม่ <ChevronDown className="size-3" />
          </Button>
          {showCreateMenu && (
            <div className="absolute right-0 top-full mt-1 z-10 bg-card border border-border rounded-lg shadow-lg py-1 min-w-[160px]">
              <button onClick={() => { setShowCreateMenu(false); openCreate(); }}
                className="w-full px-3 py-2 text-sm text-left hover:bg-muted">รายจ่าย (EX)</button>
              <button onClick={() => { setShowCreateMenu(false); navigate('/expenses/new?type=CN'); }}
                className="w-full px-3 py-2 text-sm text-left hover:bg-muted">ใบลดหนี้ (CN)</button>
              <button onClick={() => { setShowCreateMenu(false); navigate('/expenses/new?type=PR'); }}
                className="w-full px-3 py-2 text-sm text-left hover:bg-muted">เงินเดือน (PR)</button>
              <button onClick={() => { setShowCreateMenu(false); navigate('/expenses/new?type=SE'); }}
                className="w-full px-3 py-2 text-sm text-left hover:bg-muted">จ่ายเจ้าหนี้ (SE)</button>
            </div>
          )}
        </div>
      </div>

      {/* Advanced filters drawer */}
      {showAdvancedFilters && (
        <div className="flex flex-wrap gap-4 mb-5 bg-card rounded-xl border border-border/50 shadow-sm p-5">
          <div>
            <label htmlFor={`${fieldId}-1`} className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">สถานะ (ละเอียด)</label>
            <NativeSelect wrapperClassName="max-w-full w-auto sm:min-w-[120px]" id={`${fieldId}-1`} value={statusFilter} onChange={(e) => setFilter('status', e.target.value)} className={inputClass}>
              <option value="">ตามแถบที่เลือก</option>
              {Object.entries(statusLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </NativeSelect>
          </div>
          <div>
            <label htmlFor={`${fieldId}-2`} className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">สาขา</label>
            <NativeSelect wrapperClassName="max-w-full w-auto sm:min-w-[120px]" id={`${fieldId}-2`} value={branchFilter} onChange={(e) => setFilter('branch', e.target.value)} className={inputClass}>
              <option value="">ทุกสาขา</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </NativeSelect>
          </div>
          <div>
            <label htmlFor={`${fieldId}-3`} className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ตั้งแต่</label>
            <ThaiDateInput id={`${fieldId}-3`} value={startDate} onChange={(e) => setFilter('startDate', e.target.value)} className={`${inputClass} w-auto`} />
          </div>
          <div>
            <label htmlFor={`${fieldId}-4`} className="block text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ถึง</label>
            <ThaiDateInput id={`${fieldId}-4`} value={endDate} onChange={(e) => setFilter('endDate', e.target.value)} className={`${inputClass} w-auto`} />
          </div>
          <div className="flex items-end gap-1">
            {quickPresets.map((p) => <button data-ui-control="button" key={p.label} onClick={p.fn} className="px-3 py-2 text-xs border border-input rounded-lg hover:bg-muted">{p.label}</button>)}
          </div>
        </div>
      )}

      <QueryBoundary
        isLoading={isLoading && !expensesData}
        isError={isError}
        error={error}
        onRetry={refetch}
        errorTitle="ไม่สามารถโหลดรายการรายจ่ายได้"
      >
        <DataTable columns={columns} data={expensesData?.data || []} isLoading={isLoading} emptyMessage="ไม่พบรายจ่าย" />
      </QueryBoundary>

      {/* Pagination */}
      <PaginationBar
        total={total}
        page={page}
        size={size}
        onPageChange={setPage}
        onSizeChange={setSize}
      />

      {/* Unified Expense Form V4 */}
      {showForm && (
        <ExpenseFormV4
          branchId={(branchFilter) || branches[0]?.id || ''}
          onClose={() => { setShowForm(false); }}
          onSaved={handleFormSaved}
        />
      )}

      <ConfirmDialog onCloseAutoFocus={restoreMenuFocus} open={confirmDialog.open} onOpenChange={(open) => setConfirmDialog(prev => ({ ...prev, open }))} description={confirmDialog.message} onConfirm={confirmDialog.action} />

      {/* InternalControlActionBar — unified ReverseConfirmDialog.
          The expense backend still expects the legacy `{reasonCode, reasonDetail, reverseDate}`
          shape, so we adapt at the boundary: every reason becomes `'other'`
          (matches the legacy fallback) and `reasonDetail` carries the
          admin-picked label + the user's free-form note. `reverseDate`
          defaults to today (BKK) since the unified dialog doesn't expose a
          date picker yet — backdating remains available via the legacy form
          if/when the owner reopens that affordance. */}
      <ReverseConfirmDialog
        onCloseAutoFocus={restoreMenuFocus}
        open={reverseDialog.open}
        onOpenChange={(open) => setReverseDialog((prev) => ({ ...prev, open }))}
        module="expense"
        docNumber={reverseDialog.number}
        isLoading={actionMutation.isPending}
        onConfirm={({ reasonLabel, note }) => {
          const todayBkk = new Date().toLocaleDateString('en-CA', {
            timeZone: 'Asia/Bangkok',
          });
          actionMutation.mutate(
            {
              id: reverseDialog.id,
              action: 'void',
              body: {
                reasonCode: 'other',
                reasonDetail: note ? `${reasonLabel} — ${note}` : reasonLabel,
                reverseDate: todayBkk,
              },
            },
            {
              onSuccess: () => setReverseDialog({ open: false, id: '', number: '' }),
            },
          );
        }}
      />
    </div>
  );
}
