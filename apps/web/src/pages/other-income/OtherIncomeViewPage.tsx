import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Edit,
  History,
  Printer,
  RotateCcw,
  Receipt,
  FileText,
  Send,
} from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { RejectModal } from './components/RejectModal';
import { SaveAsTemplateModal } from './components/SaveAsTemplateModal';
import { AutoJournalPreview } from './components/AutoJournalPreview';
import { InternalControlActionBar, resolveCanReverse } from '@/components/accounting';
import type { IcabAuditEvent } from '@/components/accounting';
import { otherIncomeApi } from '@/lib/otherIncome';
import api from '@/lib/api';
import type { OtherIncome, OtherIncomeStatus } from '@/lib/otherIncome.types';
import { useAuth } from '@/contexts/AuthContext';
import { useUiFlags } from '@/hooks/useUiFlags';
import { formatThaiDateLong, formatThaiDateShort } from '@/lib/date';

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

const STATUS_LABELS: Record<OtherIncomeStatus, string> = {
  DRAFT: 'ร่าง',
  READY: 'รออนุมัติ',
  POSTED: 'บันทึกแล้ว',
  REVERSED: 'กลับรายการแล้ว',
};

const STATUS_COLORS: Record<OtherIncomeStatus, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  READY: 'bg-warning/10 text-warning',
  POSTED: 'bg-success/10 text-success',
  REVERSED: 'bg-destructive/10 text-destructive',
};

function StatusBadge({ status }: { status: OtherIncomeStatus }) {
  return (
    <span
      className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold ${STATUS_COLORS[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

function fmt(v: string | number | undefined | null) {
  if (v === undefined || v === null) return '—';
  const n = typeof v === 'string' ? parseFloat(v) : v;
  if (isNaN(n)) return '—';
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  return formatThaiDateLong(d);
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2 py-1.5 border-b border-border last:border-b-0">
      <span className="text-muted-foreground text-sm w-40 shrink-0">{label}</span>
      <span className="text-sm font-medium flex-1">{value ?? '—'}</span>
    </div>
  );
}

// Reconstruct JE preview from posted doc (read-only; mirrors AutoJournalService)
interface JeLine {
  accountCode: string;
  debit: number;
  credit: number;
  description?: string;
}

function buildJeFromDoc(doc: OtherIncome): JeLine[] {
  const lines: JeLine[] = [];

  for (const item of doc.items) {
    const amtBeforeVat = parseFloat(item.amountBeforeVat) || 0;
    if (amtBeforeVat > 0) {
      lines.push({
        accountCode: item.accountCode,
        debit: 0,
        credit: amtBeforeVat,
        description: item.description ?? undefined,
      });
    }
  }

  const totalVat = parseFloat(doc.vatAmount) || 0;
  if (totalVat > 0) {
    lines.push({ accountCode: '21-2101', debit: 0, credit: totalVat, description: 'ภาษีขาย' });
  }

  // B6: WHT is Dr 11-4103 (WHT receivable) per AutoJournalService — not Cr 21-3101
  const totalWht = parseFloat(doc.whtAmount) || 0;
  if (totalWht > 0) {
    lines.push({
      accountCode: '11-4103',
      debit: totalWht,
      credit: 0,
      description: 'ภาษีหัก ณ ที่จ่าย',
    });
  }

  for (const adj of doc.adjustments) {
    const amt = parseFloat(adj.amount) || 0;
    if (amt > 0 && adj.accountCode) {
      const netExpected = parseFloat(doc.netReceived) || 0;
      const received = parseFloat(doc.amountReceived) || 0;
      const diff = received - netExpected;
      if (diff > 0) {
        lines.push({
          accountCode: adj.accountCode,
          debit: 0,
          credit: amt,
          description: adj.note ?? undefined,
        });
      } else {
        lines.push({
          accountCode: adj.accountCode,
          debit: amt,
          credit: 0,
          description: adj.note ?? undefined,
        });
      }
    }
  }

  const received = parseFloat(doc.amountReceived) || 0;
  if (received > 0) {
    lines.push({
      accountCode: doc.paymentAccountCode,
      debit: received,
      credit: 0,
      description: 'รับเงิน',
    });
  }

  return lines;
}

/**
 * Map server-side AuditLogEntry rows to the IcabAuditEvent shape consumed
 * by the shared InternalControlActionBar timeline.
 *
 * The server action strings (e.g. `CREATED`, `POSTED`, `REVERSED`) are
 * preserved verbatim; the bar's AuditTimeline has a label registry that
 * handles the canonical set + falls back gracefully for unknown values.
 *
 * `reason` is plucked from `newValue.reverseReason` when present (set by
 * the reverse mutation), so the timeline can render the "เหตุผล: ..." note.
 */
function mapAuditEvents(
  entries: { id: string; action: string; createdAt: string; user: { id: string; name: string } | null; newValue?: unknown }[],
): IcabAuditEvent[] {
  return entries.map((e) => {
    const nv = (e.newValue && typeof e.newValue === 'object'
      ? (e.newValue as Record<string, unknown>)
      : null);
    // Prefer the structured label written by the new component, then fall
    // back to the free-form note, then the enum value itself so older docs
    // (pre-label backfill) still render something useful.
    const label =
      nv && typeof nv.reverseReasonLabel === 'string' && nv.reverseReasonLabel.length > 0
        ? (nv.reverseReasonLabel as string)
        : undefined;
    const note =
      nv && typeof nv.reverseNote === 'string' && nv.reverseNote.length > 0
        ? (nv.reverseNote as string)
        : undefined;
    const enumFallback =
      nv && typeof nv.reverseReason === 'string' ? (nv.reverseReason as string) : undefined;
    const reason =
      label && note && label !== note ? `${label} — ${note}` : (label ?? note ?? enumFallback);
    return {
      event: e.action,
      userId: e.user?.id ?? 'unknown',
      userName: e.user?.name ?? 'ระบบ',
      timestamp: e.createdAt,
      reason,
    };
  });
}

/**
 * Fetch server-rendered PDF receipt and open in a new tab.
 * Uses axios (JWT in-memory) since the in-memory token isn't on cookies.
 */
async function fetchAndOpenReceiptPdf(docId: string, docNumber: string): Promise<void> {
  const res = await api.get(`/other-income/${docId}/receipt.pdf`, {
    responseType: 'blob',
  });
  const blob = new Blob([res.data], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (!win) {
    // Popup blocked — fall back to download
    const a = document.createElement('a');
    a.href = url;
    a.download = `${docNumber}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  // Revoke after a delay to avoid breaking the new tab before it loads
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ------------------------------------------------------------------
// Main component
// ------------------------------------------------------------------

export default function OtherIncomeViewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const flags = useUiFlags();

  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);

  const auditQuery = useQuery({
    queryKey: ['other-income', id, 'audit'],
    queryFn: () => otherIncomeApi.getAuditTrail(id!),
    enabled: !!id,
  });

  const docQuery = useQuery({
    queryKey: ['other-income', id],
    queryFn: () => otherIncomeApi.findOne(id!),
    enabled: !!id,
  });

  /**
   * Reverse mutation — wired through the unified InternalControlActionBar.
   *
   * The new shared component returns `{reasonId, reasonLabel, note}`. The
   * backend DTO accepts the canonical Prisma enum `reason` (kept as `OTHER`
   * for dynamic reasons) plus an optional structured `reasonLabel` that
   * persists the admin-managed label alongside the note — preserves audit
   * analytics (group-by label) without breaking the enum-typed reports.
   */
  const reverseMutation = useMutation({
    mutationFn: ({
      reasonLabel,
      note,
    }: {
      reasonId: string;
      reasonLabel: string;
      note: string;
    }) => otherIncomeApi.reverse(id!, 'OTHER', note || reasonLabel, reasonLabel),
    onSuccess: (reversingDoc) => {
      toast.success(`สร้าง Reversing Entry ${reversingDoc.docNumber} แล้ว`);
      queryClient.invalidateQueries({ queryKey: ['other-income'] });
      navigate(`/other-income/${reversingDoc.id}`);
    },
    onError: () => toast.error('ไม่สามารถกลับรายการได้'),
  });

  const copyMutation = useMutation({
    mutationFn: () => otherIncomeApi.copy(id!),
    onSuccess: (newDoc) => {
      toast.success(`คัดลอกเป็น ${newDoc.docNumber} แล้ว`);
      queryClient.invalidateQueries({ queryKey: ['other-income'] });
      // W-R6 — pass `?fromCopy=1` so EntryPage surfaces the "verify amount" banner.
      // amountReceived was carried over from the source to keep V10 satisfied, so
      // the operator needs a visible reminder before posting recurring templates.
      navigate(`/other-income/${newDoc.id}/edit?fromCopy=1`);
    },
    onError: () => toast.error('ไม่สามารถคัดลอกเอกสารได้'),
  });

  const flagQuery = useQuery({
    queryKey: ['other-income-maker-checker-enabled'],
    queryFn: () => otherIncomeApi.isMakerCheckerEnabled(),
    staleTime: 5 * 60_000,
  });
  const makerCheckerEnabled = flagQuery.data ?? false;

  const requestApprovalMutation = useMutation({
    mutationFn: () => otherIncomeApi.requestApproval(id!),
    onSuccess: () => {
      toast.success('ส่งขออนุมัติแล้ว');
      queryClient.invalidateQueries({ queryKey: ['other-income', id] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'ส่งขออนุมัติไม่สำเร็จ'),
  });

  const approveMutation = useMutation({
    mutationFn: (note: string | undefined) => otherIncomeApi.approve(id!, note),
    onSuccess: () => {
      toast.success('อนุมัติและบันทึกบัญชีเรียบร้อย');
      queryClient.invalidateQueries({ queryKey: ['other-income', id] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'อนุมัติไม่สำเร็จ'),
  });

  const rejectMutation = useMutation({
    mutationFn: (note: string) => otherIncomeApi.reject(id!, note),
    onSuccess: () => {
      toast.success('ปฏิเสธคำขอแล้ว');
      queryClient.invalidateQueries({ queryKey: ['other-income', id] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'ปฏิเสธไม่สำเร็จ'),
  });

  const saveTemplateMutation = useMutation({
    mutationFn: (name: string) => otherIncomeApi.templates.saveAsFromDoc(id!, name),
    onSuccess: () => {
      toast.success('บันทึกเป็น template แล้ว');
      setShowTemplateModal(false);
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'บันทึก template ไม่สำเร็จ'),
  });

  const printReceiptMutation = useMutation({
    mutationFn: ({ docId, docNumber }: { docId: string; docNumber: string }) =>
      fetchAndOpenReceiptPdf(docId, docNumber),
    onError: () => toast.error('ไม่สามารถสร้างใบเสร็จ PDF ได้'),
  });

  // Mode-aware (Audit Finding A): mirrors the backend ReversePermissionGuard so
  // the "↺ ยกเลิก/กลับรายการ" button only shows when the server will allow it —
  // respects OWNER_ONLY / +FM / +FM+ACCOUNTANT / CUSTOM modes uniformly.
  const canReverse =
    resolveCanReverse(flags.reversePermission, user?.role, user?.canReverseOverride) &&
    docQuery.data?.status === 'POSTED';

  const doc = docQuery.data;
  const jeLines = doc ? buildJeFromDoc(doc) : [];

  const isActionLoading =
    reverseMutation.isPending ||
    copyMutation.isPending ||
    requestApprovalMutation.isPending ||
    approveMutation.isPending ||
    rejectMutation.isPending;

  return (
    <div className="p-6 max-w-7xl mx-auto pb-6">
      <PageHeader
        title="รายละเอียดเอกสารรายได้อื่น"
        icon={<Receipt size={20} />}
        onBack={() => navigate('/other-income')}
        badge={doc ? <StatusBadge status={doc.status} /> : undefined}
        action={
          doc ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={isActionLoading}
                onClick={() => copyMutation.mutate()}
                className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium border rounded-lg hover:bg-accent disabled:opacity-50"
              >
                <Copy size={14} />
                คัดลอก
              </button>
              {(doc.status === 'POSTED' || doc.status === 'REVERSED') && (
                <button
                  type="button"
                  onClick={() => setShowTemplateModal(true)}
                  className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium border rounded-lg hover:bg-accent"
                >
                  บันทึกเป็น Template
                </button>
              )}
              {doc.status === 'POSTED' && doc.customerId && (
                <button
                  type="button"
                  onClick={() =>
                    printReceiptMutation.mutate({ docId: doc.id, docNumber: doc.docNumber })
                  }
                  disabled={printReceiptMutation.isPending}
                  className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium border rounded-lg hover:bg-accent disabled:opacity-50"
                >
                  <Printer size={14} />
                  {printReceiptMutation.isPending ? 'กำลังสร้าง...' : 'พิมพ์ใบเสร็จ'}
                </button>
              )}
              {doc.status === 'DRAFT' && (
                <>
                  <button
                    type="button"
                    onClick={() => navigate(`/other-income/${doc.id}/edit`)}
                    className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium border rounded-lg hover:bg-accent"
                  >
                    <Edit size={14} />
                    แก้ไข
                  </button>
                  {makerCheckerEnabled ? (
                    <button
                      type="button"
                      onClick={() => requestApprovalMutation.mutate()}
                      disabled={requestApprovalMutation.isPending}
                      className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
                    >
                      <Send size={14} />
                      ส่งขออนุมัติ
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => navigate(`/other-income/${doc.id}/edit`)}
                      className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
                    >
                      <Check size={14} />
                      แก้ไขและ POST
                    </button>
                  )}
                </>
              )}
              {doc.status === 'READY' && doc.rejectNote && (
                <div className="rounded-md bg-warning/10 text-warning text-xs px-3 py-2">
                  เคยถูกปฏิเสธ: {doc.rejectNote}
                </div>
              )}
              {doc.status === 'READY' && user?.role === 'OWNER' && doc.createdById === user.id && (
                <div className="rounded-md bg-muted text-muted-foreground text-sm px-3 py-2">
                  ไม่สามารถอนุมัติเอกสารที่ตนสร้างได้
                </div>
              )}
            </div>
          ) : undefined
        }
      />

      <QueryBoundary
        isLoading={docQuery.isLoading}
        isError={docQuery.isError}
        error={docQuery.error}
        onRetry={docQuery.refetch}
      >
        {doc && (
          <div>
            {doc.postedAt && Date.now() - new Date(doc.postedAt).getTime() < 60_000 && (
              <div className="rounded-xl border-2 border-success bg-success/10 px-5 py-4 mb-4 flex items-center gap-4">
                <CheckCircle2 size={24} className="text-success" />
                <div className="flex-1">
                  <p className="font-bold text-success">บันทึกและ POST เรียบร้อยแล้ว</p>
                  <p className="text-xs text-success/80">เอกสาร {doc.docNumber} ลงบัญชีเรียบร้อย</p>
                </div>
                {doc.customerId && (
                  <button
                    onClick={() =>
                      printReceiptMutation.mutate({ docId: doc.id, docNumber: doc.docNumber })
                    }
                    disabled={printReceiptMutation.isPending}
                    className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-bold bg-primary text-primary-foreground rounded-md animate-pulse disabled:opacity-50 disabled:animate-none"
                  >
                    <Printer size={16} />{' '}
                    {printReceiptMutation.isPending ? 'กำลังสร้าง...' : 'พิมพ์ใบเสร็จ'}
                  </button>
                )}
              </div>
            )}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
              {/* Left / Main column */}
              <div className="xl:col-span-2 space-y-6">
                {/* --- Document header info --- */}
                <div className="rounded-xl border bg-card p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                      ข้อมูลเอกสาร
                    </h2>
                    <span className="font-mono font-bold text-lg text-primary">
                      {doc.docNumber}
                    </span>
                  </div>
                  <div>
                    <InfoRow label="วันที่เอกสาร" value={fmtDate(doc.issueDate)} />
                    <InfoRow label="วันครบกำหนด" value={fmtDate(doc.dueDate)} />
                    <InfoRow label="วันที่รับเงิน" value={fmtDate(doc.paymentDate)} />
                    <InfoRow
                      label="ประเภทราคา"
                      value={doc.priceType === 'INCLUSIVE' ? 'รวม VAT' : 'ไม่รวม VAT'}
                    />
                    <InfoRow label="ช่องทางรับเงิน" value={doc.paymentAccountCode} />
                    {doc.receiptNo && <InfoRow label="เลขที่ใบเสร็จ" value={doc.receiptNo} />}
                    {doc.postedAt && <InfoRow label="วันที่ POST" value={fmtDate(doc.postedAt)} />}
                  </div>
                </div>

                {/* --- Counterparty --- */}
                <div className="rounded-xl border bg-card p-5">
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                    คู่ค้า / ลูกค้า
                  </h2>
                  <InfoRow
                    label="ชื่อ"
                    value={
                      doc.counterpartyName ??
                      doc.customer?.name ?? <span className="text-muted-foreground">—</span>
                    }
                  />
                  {doc.counterpartyTaxId && (
                    <InfoRow label="เลขที่ผู้เสียภาษี" value={doc.counterpartyTaxId} />
                  )}
                  {doc.counterpartyPhone && (
                    <InfoRow label="เบอร์โทร" value={doc.counterpartyPhone} />
                  )}
                  {doc.counterpartyAddress && (
                    <InfoRow label="ที่อยู่" value={doc.counterpartyAddress} />
                  )}
                </div>

                {/* --- Items table --- */}
                <div className="rounded-xl border bg-card p-5">
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                    รายการรายได้
                  </h2>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-2 pr-3 text-xs text-muted-foreground font-medium">
                            #
                          </th>
                          <th className="text-left py-2 pr-3 text-xs text-muted-foreground font-medium">
                            บัญชี
                          </th>
                          <th className="text-left py-2 pr-3 text-xs text-muted-foreground font-medium">
                            คำอธิบาย
                          </th>
                          <th className="text-right py-2 pr-3 text-xs text-muted-foreground font-medium">
                            จำนวน
                          </th>
                          <th className="text-right py-2 pr-3 text-xs text-muted-foreground font-medium">
                            ราคา
                          </th>
                          <th className="text-right py-2 pr-3 text-xs text-muted-foreground font-medium">
                            ส่วนลด
                          </th>
                          <th className="text-right py-2 pr-3 text-xs text-muted-foreground font-medium">
                            VAT%
                          </th>
                          <th className="text-right py-2 pr-3 text-xs text-muted-foreground font-medium">
                            WHT%
                          </th>
                          <th className="text-right py-2 text-xs text-muted-foreground font-medium">
                            ก่อนภาษี
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {doc.items.map((item) => (
                          <tr key={item.id} className="border-b hover:bg-muted/20">
                            <td className="py-2 pr-3 text-muted-foreground text-xs">
                              {item.lineNo}
                            </td>
                            <td className="py-2 pr-3 font-mono text-xs font-semibold">
                              {item.accountCode}
                            </td>
                            <td className="py-2 pr-3 text-xs">{item.description ?? '—'}</td>
                            <td className="py-2 pr-3 text-right font-mono">{fmt(item.quantity)}</td>
                            <td className="py-2 pr-3 text-right font-mono">
                              {fmt(item.unitAmount)}
                            </td>
                            <td className="py-2 pr-3 text-right font-mono text-muted-foreground">
                              {fmt(item.discountAmount)}
                            </td>
                            <td className="py-2 pr-3 text-right font-mono">{item.vatPct}%</td>
                            <td className="py-2 pr-3 text-right font-mono">{item.whtPct}%</td>
                            <td className="py-2 text-right font-mono font-semibold">
                              {fmt(item.amountBeforeVat)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Adjustments */}
                  {doc.adjustments.length > 0 && (
                    <div className="mt-4 pt-3 border-t">
                      <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                        บัญชีปรับผลต่าง
                      </p>
                      {doc.adjustments.map((adj) => (
                        <div key={adj.id} className="flex justify-between text-sm py-1">
                          <span className="font-mono text-xs">{adj.accountCode}</span>
                          <span className="text-muted-foreground text-xs">{adj.note ?? '—'}</span>
                          <span className="font-mono">{fmt(adj.amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* --- Reverse info --- */}
                {doc.status === 'REVERSED' && (
                  <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5">
                    <h2 className="text-sm font-semibold text-destructive uppercase tracking-wide mb-3 flex items-center gap-2">
                      <RotateCcw size={14} />
                      ข้อมูลการกลับรายการ
                    </h2>
                    <InfoRow label="ประเภทเหตุผล" value={doc.reverseReason ?? '—'} />
                    <InfoRow label="รายละเอียด" value={doc.reverseNote ?? '—'} />
                    {doc.reversedBy && (
                      <InfoRow
                        label="เอกสาร Reversing"
                        value={
                          <button
                            type="button"
                            onClick={() => navigate(`/other-income/${doc.reversedBy!.id}`)}
                            className="font-mono text-primary hover:underline"
                          >
                            {doc.reversedBy.docNumber} — ดูเอกสาร Reversing Entry
                          </button>
                        }
                      />
                    )}
                  </div>
                )}

                {/* --- W6: Reverses (back-link from -R doc to its original) --- */}
                {doc.reverses && (
                  <div className="rounded-xl border bg-card p-5">
                    <p className="text-xs text-muted-foreground">
                      เอกสารนี้คือใบกลับรายการของ{' '}
                      <button
                        type="button"
                        onClick={() => navigate(`/other-income/${doc.reverses!.id}`)}
                        className="font-mono text-primary hover:underline"
                      >
                        {doc.reverses.docNumber}
                      </button>
                    </p>
                  </div>
                )}

                {/* --- Copied from --- */}
                {doc.copiedFromId && (
                  <div className="rounded-xl border bg-card p-5">
                    <p className="text-xs text-muted-foreground">
                      คัดลอกจากเอกสาร{' '}
                      <button
                        type="button"
                        onClick={() => navigate(`/other-income/${doc.copiedFromId}`)}
                        className="font-mono text-primary hover:underline"
                      >
                        ดูต้นฉบับ
                      </button>
                    </p>
                  </div>
                )}

                {/* --- Customer note --- */}
                {doc.customerNote && (
                  <div className="rounded-xl border bg-card p-5">
                    <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                      หมายเหตุ
                    </h2>
                    <p className="text-sm">{doc.customerNote}</p>
                  </div>
                )}

                {/* --- Attachments --- */}
                {doc.attachments.length > 0 && (
                  <div className="rounded-xl border bg-card p-5">
                    <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                      เอกสารแนบ
                    </h2>
                    <div className="space-y-2">
                      {doc.attachments.map((att) => (
                        <div key={att.id} className="flex items-center gap-3 text-sm">
                          <FileText size={14} className="text-muted-foreground shrink-0" />
                          <span className="flex-1 truncate">{att.filename}</span>
                          <span className="text-xs text-muted-foreground">
                            {(att.size / 1024).toFixed(1)} KB
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Right column — summary + JE preview */}
              <div className="space-y-4 xl:sticky xl:top-6 xl:self-start">
                {/* Summary */}
                <div className="rounded-xl border bg-card p-5">
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                    สรุปยอด
                  </h2>
                  <div className="space-y-2 font-mono text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">รายได้ก่อนภาษี</span>
                      <span className="font-semibold">{fmt(doc.incomeGross)} ฿</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">VAT</span>
                      <span>{fmt(doc.vatAmount)} ฿</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">WHT</span>
                      <span>-{fmt(doc.whtAmount)} ฿</span>
                    </div>
                    <div className="flex justify-between border-t pt-2 font-bold">
                      <span>สุทธิที่คาดรับ</span>
                      <span>{fmt(doc.netReceived)} ฿</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">ได้รับจริง</span>
                      <span
                        className={
                          Math.abs(parseFloat(doc.amountReceived) - parseFloat(doc.netReceived)) >
                          0.01
                            ? 'text-warning'
                            : 'text-success'
                        }
                      >
                        {fmt(doc.amountReceived)} ฿
                      </span>
                    </div>
                    {doc.isOverridden && (
                      <p className="text-xs text-warning pt-1">* JE ถูก override โดยผู้ใช้</p>
                    )}
                  </div>
                </div>

                {/* JE Preview — only when POSTED */}
                {doc.status === 'POSTED' && <AutoJournalPreview lines={jeLines} />}

                {/* Draft action shortcut */}
                {doc.status === 'DRAFT' && (
                  <div className="rounded-xl border bg-card p-5 space-y-2">
                    <p className="text-sm text-muted-foreground">
                      เอกสารนี้ยังเป็นร่าง — ยังไม่มี Journal Entry
                    </p>
                    {makerCheckerEnabled ? (
                      <button
                        type="button"
                        onClick={() => requestApprovalMutation.mutate()}
                        disabled={requestApprovalMutation.isPending}
                        className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 disabled:opacity-50"
                      >
                        <Send size={14} />
                        ส่งขออนุมัติ
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => navigate(`/other-income/${doc.id}/edit`)}
                        className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90"
                      >
                        <Edit size={14} />
                        แก้ไขและ POST
                      </button>
                    )}
                  </div>
                )}
                {/* READY shortcut info */}
                {doc.status === 'READY' && (
                  <div className="rounded-xl border bg-card p-5 space-y-2">
                    <div className="inline-flex items-center gap-2 text-warning text-sm font-semibold">
                      <Clock size={16} />
                      รออนุมัติ
                    </div>
                    <p className="text-xs text-muted-foreground">
                      เอกสารนี้รอการอนุมัติจาก OWNER — ยังไม่มี Journal Entry
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Audit trail */}
            <section className="rounded-xl border bg-card p-5 mt-6">
              <h3 className="font-bold mb-3 flex items-center gap-2">
                <History size={16} /> ประวัติการแก้ไข
              </h3>
              {auditQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">กำลังโหลด...</p>
              ) : !auditQuery.data || auditQuery.data.length === 0 ? (
                <p className="text-sm text-muted-foreground">— ไม่มีประวัติ —</p>
              ) : (
                <ul className="space-y-2">
                  {auditQuery.data.map((log) => (
                    <li key={log.id} className="border-l-2 pl-3 py-1.5 border-border">
                      {log.action === 'JV_OVERRIDDEN' ? (
                        <div className="rounded border border-warning/50 bg-warning/10 p-3 space-y-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="px-2 py-0.5 rounded bg-warning/20 font-mono text-xs font-semibold text-warning">
                              JV_OVERRIDDEN
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {log.user?.name ?? '—'} ·{' '}
                              {new Date(log.createdAt).toLocaleString('th-TH')}
                            </span>
                          </div>
                          <p className="text-sm italic text-muted-foreground">
                            {(log.newValue as any)?.diffSummary ?? '(ไม่มีสรุปการเปลี่ยนแปลง)'}
                          </p>

                          <details className="text-xs">
                            <summary className="cursor-pointer text-muted-foreground hover:text-foreground font-medium">
                              ดูรายละเอียดทั้งหมด
                            </summary>
                            <div className="grid grid-cols-2 gap-4 mt-3 pt-3 border-t border-warning/30">
                              <div>
                                <p className="font-semibold text-xs mb-2 text-muted-foreground">
                                  Original (Auto)
                                </p>
                                <table className="w-full font-mono text-[11px]">
                                  <tbody>
                                    {(log.oldValue as any)?.jvLines?.map((l: any, i: number) => (
                                      <tr key={i} className="border-b border-border/30">
                                        <td className="py-1 pr-2">{l.accountCode}</td>
                                        <td className="text-right pr-2">
                                          {Number(l.debit).toLocaleString('th-TH', {
                                            minimumFractionDigits: 2,
                                            maximumFractionDigits: 2,
                                          })}
                                        </td>
                                        <td className="text-right">
                                          {Number(l.credit).toLocaleString('th-TH', {
                                            minimumFractionDigits: 2,
                                            maximumFractionDigits: 2,
                                          })}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                              <div>
                                <p className="font-semibold text-xs mb-2 text-muted-foreground">
                                  Modified
                                </p>
                                <table className="w-full font-mono text-[11px]">
                                  <tbody>
                                    {(log.newValue as any)?.jvLines?.map((l: any, i: number) => (
                                      <tr key={i} className="border-b border-border/30">
                                        <td className="py-1 pr-2">{l.accountCode}</td>
                                        <td className="text-right pr-2">
                                          {Number(l.debit).toLocaleString('th-TH', {
                                            minimumFractionDigits: 2,
                                            maximumFractionDigits: 2,
                                          })}
                                        </td>
                                        <td className="text-right">
                                          {Number(l.credit).toLocaleString('th-TH', {
                                            minimumFractionDigits: 2,
                                            maximumFractionDigits: 2,
                                          })}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </details>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-xs flex-wrap">
                          <span className="px-2 py-0.5 rounded bg-muted font-mono text-xs">
                            {log.action}
                          </span>
                          <span className="text-muted-foreground">{fmtDate(log.createdAt)}</span>
                          {log.user && (
                            <span>
                              โดย <strong>{log.user.name}</strong>
                            </span>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </QueryBoundary>

      {/* InternalControlActionBar — shared across all 3 accounting modules.
          Reverse dialog is rendered internally; modules supply the audit
          timeline + callbacks. */}
      {doc && user && (
        <InternalControlActionBar
          module="other_income"
          status={doc.status}
          docNumber={doc.docNumber}
          docAmount={
            typeof doc.amountReceived === 'string'
              ? Number(doc.amountReceived)
              : doc.amountReceived ?? undefined
          }
          docSubtitle={doc.paymentAccountCode ? `บัญชี ${doc.paymentAccountCode}` : undefined}
          auditLog={mapAuditEvents(auditQuery.data ?? [])}
          currentUser={{
            id: user.id,
            role: user.role,
            name: user.name,
            canReverseOverride: user.canReverseOverride,
          }}
          makerCheckerEnabled={makerCheckerEnabled}
          isViewerApprover={user.role === 'OWNER' && doc.createdById !== user.id}
          isOwnDoc={doc.createdById === user.id}
          isLoading={isActionLoading}
          canReverse={Boolean(canReverse)}
          onCancel={() => navigate('/other-income')}
          onClose={() => navigate('/other-income')}
          onApprove={() => approveMutation.mutate(undefined)}
          onReject={() => setShowRejectModal(true)}
          onReverse={(payload) => reverseMutation.mutate(payload)}
          onPrint={() =>
            printReceiptMutation.mutate({ docId: doc.id, docNumber: doc.docNumber })
          }
        />
      )}

      {/* Reject modal (PR-2 Maker-Checker) */}
      {showRejectModal && doc && (
        <RejectModal
          docNumber={doc.docNumber}
          isLoading={rejectMutation.isPending}
          onCancel={() => setShowRejectModal(false)}
          onConfirm={(note) => {
            rejectMutation.mutate(note);
            setShowRejectModal(false);
          }}
        />
      )}

      {/* Save-as-template modal */}
      {showTemplateModal && doc && (
        <SaveAsTemplateModal
          defaultName={`${doc.counterpartyName ?? 'รายได้อื่น'} — ${formatThaiDateShort(doc.issueDate)}`}
          isLoading={saveTemplateMutation.isPending}
          onCancel={() => setShowTemplateModal(false)}
          onConfirm={(name) => saveTemplateMutation.mutate(name)}
        />
      )}
    </div>
  );
}
