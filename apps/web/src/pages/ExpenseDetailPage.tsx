import { useNavigate, useParams } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Wallet } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import {
  InternalControlActionBar,
  resolveCanReverse,
  mapAuditEvents,
  type RawAuditEntry,
  type IcabStatus,
} from '@/components/accounting';
import api from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useUiFlags } from '@/hooks/useUiFlags';
import { formatNumberDecimal } from '@/utils/formatters';
import { formatThaiDateShort } from '@/lib/date';

/**
 * ExpenseDetailPage — single-document view that hosts the shared
 * InternalControlActionBar for the Expense module (mirrors OtherIncomeViewPage,
 * the Other Income pilot). The bar is the unified "ควบคุมภายใน" control surface:
 * audit timeline + state-machine buttons + reverse/void dialog.
 *
 * Per-module responsibility (the bar is presentation-only): this page maps the
 * 6-state expense DocumentStatus into the bar's 4-state ICAB model and wires the
 * existing expense mutations (post / submit / approve / void / print).
 */

type ExpenseStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'ACCRUAL'
  | 'POSTED'
  | 'VOIDED';

interface ExpenseLine {
  lineNo?: number;
  category: string;
  description?: string | null;
  amountBeforeVat?: string | null;
  vatAmount?: string | null;
  whtAmount?: string | null;
}

interface ExpenseDocument {
  id: string;
  number: string;
  documentType: string;
  status: ExpenseStatus;
  documentDate: string;
  vendorName: string | null;
  vendorTaxId: string | null;
  description: string | null;
  subtotal: string;
  vatAmount: string;
  withholdingTax: string;
  totalAmount: string;
  netPayment: string | null;
  branch?: { id: string; name: string } | null;
  createdBy?: { id: string; name: string } | null;
  expenseDetail?: { lines: ExpenseLine[] } | null;
}

const DOC_TYPE_LABELS: Record<string, string> = {
  EXPENSE: 'ค่าใช้จ่าย',
  CREDIT_NOTE: 'ใบลดหนี้',
  PAYROLL: 'เงินเดือน',
  VENDOR_SETTLEMENT: 'ชำระเจ้าหนี้',
  PETTY_CASH_REIMBURSEMENT: 'เบิกเงินสดย่อย',
  REPAIR_SERVICE: 'ค่าซ่อม',
};

/**
 * Map the 6-state expense DocumentStatus onto the bar's 4-state ICAB model.
 *   DRAFT            → DRAFT     (editable; post / submit-for-approval)
 *   PENDING_APPROVAL → READY     (awaiting approval; approve)
 *   APPROVED         → POSTED    (approved + booked; close / print / reverse)
 *   ACCRUAL          → POSTED    (owner decision: a booked accrual has a JE)
 *   POSTED           → POSTED
 *   VOIDED           → REVERSED  (terminal)
 * Void is allowed server-side from any non-VOIDED state, but the bar only
 * surfaces the reverse button in POSTED — which the three "booked" states map
 * to, so the reverse affordance lines up with what the server accepts.
 */
export function mapExpenseStatusToIcab(status: ExpenseStatus): IcabStatus {
  switch (status) {
    case 'DRAFT':
      return 'DRAFT';
    case 'PENDING_APPROVAL':
      return 'READY';
    case 'VOIDED':
      return 'REVERSED';
    case 'APPROVED':
    case 'ACCRUAL':
    case 'POSTED':
    default:
      return 'POSTED';
  }
}

const STATUS_BADGE: Record<ExpenseStatus, { label: string; cls: string }> = {
  DRAFT: { label: '📝 ฉบับร่าง', cls: 'border-warning/40 bg-warning/10 text-warning' },
  PENDING_APPROVAL: { label: '⏳ รออนุมัติ', cls: 'border-info/40 bg-info/10 text-info' },
  APPROVED: { label: '✓ อนุมัติแล้ว', cls: 'border-success/40 bg-success/10 text-success' },
  ACCRUAL: { label: '📒 ตั้งค้างจ่าย', cls: 'border-info/40 bg-info/10 text-info' },
  POSTED: { label: '✓ ลงบัญชีแล้ว', cls: 'border-success/40 bg-success/10 text-success' },
  VOIDED: { label: '↺ กลับรายการแล้ว', cls: 'border-destructive/40 bg-destructive/10 text-destructive' },
};

function StatusBadge({ status }: { status: ExpenseStatus }) {
  const b = STATUS_BADGE[status];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium leading-snug ${b.cls}`}
    >
      {b.label}
    </span>
  );
}

/** Fetch the server-rendered voucher PDF (JWT in-memory → axios) and open it. */
async function openVoucherPdf(docId: string, docNumber: string): Promise<void> {
  const res = await api.get(`/expense-documents/${docId}/voucher.pdf`, { responseType: 'blob' });
  const blob = new Blob([res.data], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (!win) {
    const a = document.createElement('a');
    a.href = url;
    a.download = `${docNumber}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export default function ExpenseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const flags = useUiFlags();

  const docQuery = useQuery<ExpenseDocument>({
    queryKey: ['expense-document', id],
    queryFn: async () => (await api.get<ExpenseDocument>(`/expense-documents/${id}`)).data,
    enabled: !!id,
  });

  const auditQuery = useQuery<RawAuditEntry[]>({
    queryKey: ['expense-document', id, 'audit'],
    queryFn: async () => (await api.get<RawAuditEntry[]>(`/expense-documents/${id}/audit`)).data,
    enabled: !!id,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['expense-document', id] });
    queryClient.invalidateQueries({ queryKey: ['expenses'] });
    queryClient.invalidateQueries({ queryKey: ['expenses-summary'] });
  };

  const postMutation = useMutation({
    mutationFn: () => api.post(`/expense-documents/${id}/post`, {}),
    onSuccess: () => {
      toast.success('บันทึกบัญชีเรียบร้อย');
      invalidate();
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'บันทึกบัญชีไม่สำเร็จ'),
  });

  const submitMutation = useMutation({
    mutationFn: () => api.post(`/expense-documents/${id}/submit-for-approval`, {}),
    onSuccess: () => {
      toast.success('ส่งขออนุมัติแล้ว');
      invalidate();
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'ส่งขออนุมัติไม่สำเร็จ'),
  });

  const approveMutation = useMutation({
    mutationFn: () => api.post(`/expense-documents/${id}/approve`, {}),
    onSuccess: () => {
      toast.success('อนุมัติเรียบร้อย');
      invalidate();
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'อนุมัติไม่สำเร็จ'),
  });

  const voidMutation = useMutation({
    mutationFn: ({ reasonLabel, note }: { reasonId: string; reasonLabel: string; note: string }) =>
      api.post(`/expense-documents/${id}/void`, {
        // The bar's reasons come from the admin-managed reverse-reasons table
        // (uuid ids), which don't match the expense reasonCode whitelist — so we
        // carry the human label/note under the catch-all 'other' code. The
        // structured reasonLabel/note are stamped into the audit log as
        // reverseReasonLabel/reverseNote so the timeline renders them (parity
        // with other-income / asset). reverseDate omitted → server default (BKK noon).
        reasonCode: 'other',
        reasonDetail: note ? `${reasonLabel} — ${note}` : reasonLabel,
        reasonLabel,
        note,
      }),
    onSuccess: () => {
      toast.success('กลับรายการเอกสารเรียบร้อย');
      invalidate();
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'กลับรายการไม่สำเร็จ'),
  });

  const printMutation = useMutation({
    mutationFn: ({ docId, docNumber }: { docId: string; docNumber: string }) =>
      openVoucherPdf(docId, docNumber),
    onError: () => toast.error('ไม่สามารถสร้างใบสำคัญจ่าย PDF ได้'),
  });

  const doc = docQuery.data;
  const makerCheckerEnabled = flags.approvalEnabled;
  const icabStatus = doc ? mapExpenseStatusToIcab(doc.status) : 'DRAFT';

  // Mode-aware reverse gate (Audit Finding A) — mirrors the backend
  // ReversePermissionGuard so the button only shows when the server will allow.
  const canReverse =
    resolveCanReverse(flags.reversePermission, user?.role, user?.canReverseOverride) &&
    icabStatus === 'POSTED';

  const isOwnDoc = !!doc && doc.createdBy?.id === user?.id;
  const isViewerApprover =
    !!user &&
    (user.role === 'OWNER' || user.role === 'FINANCE_MANAGER') &&
    doc?.createdBy?.id !== user.id;

  const isActionLoading =
    postMutation.isPending ||
    submitMutation.isPending ||
    approveMutation.isPending ||
    voidMutation.isPending;

  const money = (v: string | null | undefined) => `${formatNumberDecimal(Number(v ?? 0), 2)} ฿`;

  return (
    <div className="p-6 max-w-7xl mx-auto pb-44 md:pb-40">
      <PageHeader
        title="รายละเอียดเอกสารรายจ่าย"
        icon={<Wallet size={20} />}
        onBack={() => navigate('/expenses')}
        badge={doc ? <StatusBadge status={doc.status} /> : undefined}
      />

      <QueryBoundary
        isLoading={docQuery.isLoading}
        isError={docQuery.isError}
        error={docQuery.error as Error | null}
        onRetry={docQuery.refetch}
      >
        {doc && (
          <div className="space-y-6">
            {/* Document header */}
            <section className="rounded-lg border border-border bg-card p-5">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <div className="text-lg font-semibold leading-snug">{doc.number}</div>
                  <div className="text-sm text-muted-foreground leading-snug">
                    {DOC_TYPE_LABELS[doc.documentType] ?? doc.documentType} ·{' '}
                    {formatThaiDateShort(doc.documentDate)}
                    {doc.branch?.name ? ` · ${doc.branch.name}` : ''}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-muted-foreground leading-snug">ยอดสุทธิที่จ่าย</div>
                  <div className="text-xl font-semibold leading-snug">
                    {money(doc.netPayment ?? doc.totalAmount)}
                  </div>
                </div>
              </div>

              <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground leading-snug">ผู้ขาย / ผู้รับเงิน</dt>
                  <dd className="font-medium leading-snug text-right">{doc.vendorName ?? '—'}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground leading-snug">เลขผู้เสียภาษีผู้ขาย</dt>
                  <dd className="font-medium leading-snug text-right">{doc.vendorTaxId ?? '—'}</dd>
                </div>
                {doc.description ? (
                  <div className="flex justify-between gap-3 sm:col-span-2">
                    <dt className="text-muted-foreground leading-snug">รายละเอียด</dt>
                    <dd className="font-medium leading-snug text-right">{doc.description}</dd>
                  </div>
                ) : null}
              </dl>
            </section>

            {/* Line items */}
            {doc.expenseDetail?.lines?.length ? (
              <section className="rounded-lg border border-border bg-card overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium leading-snug">บัญชี / รายการ</th>
                      <th className="px-4 py-2 text-right font-medium leading-snug">ก่อน VAT</th>
                      <th className="px-4 py-2 text-right font-medium leading-snug">VAT</th>
                      <th className="px-4 py-2 text-right font-medium leading-snug">หัก ณ ที่จ่าย</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {doc.expenseDetail.lines.map((ln, i) => (
                      <tr key={ln.lineNo ?? i}>
                        <td className="px-4 py-2 align-top leading-snug">
                          <div className="font-medium">{ln.category}</div>
                          {ln.description ? (
                            <div className="text-xs text-muted-foreground">{ln.description}</div>
                          ) : null}
                        </td>
                        <td className="px-4 py-2 text-right align-top tabular-nums">{money(ln.amountBeforeVat)}</td>
                        <td className="px-4 py-2 text-right align-top tabular-nums">{money(ln.vatAmount)}</td>
                        <td className="px-4 py-2 text-right align-top tabular-nums">{money(ln.whtAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ) : null}

            {/* Totals */}
            <section className="rounded-lg border border-border bg-card p-5">
              <dl className="space-y-1.5 text-sm max-w-xs ml-auto">
                <div className="flex justify-between gap-6">
                  <dt className="text-muted-foreground leading-snug">ยอดก่อนภาษี</dt>
                  <dd className="tabular-nums leading-snug">{money(doc.subtotal)}</dd>
                </div>
                <div className="flex justify-between gap-6">
                  <dt className="text-muted-foreground leading-snug">VAT</dt>
                  <dd className="tabular-nums leading-snug">{money(doc.vatAmount)}</dd>
                </div>
                <div className="flex justify-between gap-6">
                  <dt className="text-muted-foreground leading-snug">หัก ณ ที่จ่าย</dt>
                  <dd className="tabular-nums leading-snug">- {money(doc.withholdingTax)}</dd>
                </div>
                <div className="flex justify-between gap-6 border-t border-border pt-1.5 font-semibold">
                  <dt className="leading-snug">ยอดสุทธิที่จ่าย</dt>
                  <dd className="tabular-nums leading-snug">{money(doc.netPayment ?? doc.totalAmount)}</dd>
                </div>
              </dl>
            </section>
          </div>
        )}
      </QueryBoundary>

      {/* InternalControlActionBar — shared across all 3 accounting modules. */}
      {doc && user && (
        <InternalControlActionBar
          module="expense"
          status={icabStatus}
          docNumber={doc.number}
          docAmount={Number(doc.netPayment ?? doc.totalAmount)}
          docSubtitle={doc.vendorName ?? undefined}
          auditLog={mapAuditEvents(auditQuery.data ?? [])}
          currentUser={{
            id: user.id,
            role: user.role,
            name: user.name,
            canReverseOverride: user.canReverseOverride,
          }}
          makerCheckerEnabled={makerCheckerEnabled}
          isViewerApprover={isViewerApprover}
          isOwnDoc={isOwnDoc}
          isLoading={isActionLoading}
          canReverse={Boolean(canReverse)}
          onCancel={() => navigate('/expenses')}
          onClose={() => navigate('/expenses')}
          onPost={() => postMutation.mutate()}
          onSubmitForApproval={() => submitMutation.mutate()}
          onApprove={() => approveMutation.mutate()}
          onReverse={(payload) => voidMutation.mutate(payload)}
          onPrint={() => printMutation.mutate({ docId: doc.id, docNumber: doc.number })}
        />
      )}
    </div>
  );
}
