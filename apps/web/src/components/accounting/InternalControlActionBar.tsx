import { useState } from 'react';
import {
  ArrowLeft,
  Save,
  Send,
  CheckCircle2,
  XCircle,
  Undo2,
  Printer,
  ShieldCheck,
  User as UserIcon,
  History,
  Circle,
  AlertCircle,
} from 'lucide-react';
import { useUiFlags } from '@/hooks/useUiFlags';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { AuditTimeline } from './AuditTimeline';
import { ReverseConfirmDialog } from './ReverseConfirmDialog';
import {
  ICAB_MODULE_DEFAULTS,
  type IcabAuditEvent,
  type IcabCurrentUser,
  type IcabModule,
  type IcabStatus,
} from './types';

/**
 * InternalControlActionBar — the single shared "ควบคุมภายใน" surface used by
 * all three accounting modules (Other Income, Expense, Asset).
 *
 * Rendered as an in-flow card at the end of the document form (NOT a floating
 * fixed bar), themed to match the page (emerald/zinc), with four zones:
 *   1. Header — identity + document number + status pill.
 *   2. Stepper — DRAFT → (READY) → ลงบัญชี → กลับรายการ progress.
 *   3. Meta — ผู้บันทึก / ผู้อนุมัติ + ต้องอนุมัติ badge + audit timeline preview.
 *   4. Footer — state-aware action buttons (DRAFT/READY/POSTED/REVERSED).
 *
 * Per-module logic (JE Generator, VAT/WHT, Auto Journal) lives in the parent.
 * This component is presentational + lightweight state only; it opens the
 * unified ReverseConfirmDialog and forwards (reasonId, reasonLabel, note) to
 * the parent via `onReverse` — it never touches the JE itself.
 */
export interface InternalControlActionBarProps {
  module: IcabModule;
  status: IcabStatus;
  /** Audit events for this single document (already filtered by parent). */
  auditLog: IcabAuditEvent[];
  /** Current viewer — used to gate reverse button + show "ผู้บันทึก". */
  currentUser: IcabCurrentUser;

  /** Maker-Checker mode (READY state shows + ต้องอนุมัติ badge). */
  makerCheckerEnabled?: boolean;
  /** Is the current viewer the doc creator? Suppresses "รออนุมัติ" hint. */
  isOwnDoc?: boolean;
  /** Is the current viewer an approver? Required for READY → APPROVE. */
  isViewerApprover?: boolean;

  /** Pre-computed gate: does this user have the right role/flag to reverse? */
  canReverse?: boolean;
  /** Pre-flight error count — disables POST when > 0 on DRAFT. */
  errorCount?: number;
  /** Master "can we even submit this?" flag — disables primary CTA. */
  canPost?: boolean;
  /** Pending mutation indicator — disables all buttons. */
  isLoading?: boolean;

  /** Override print button label — defaults per module. */
  printLabel?: string;
  /** Document subtitle shown in the reverse dialog (vendor, amount, ...). */
  docSubtitle?: string;
  /** Document number (required to render reverse dialog). */
  docNumber?: string;
  /** Document amount (for reverse-dialog header). */
  docAmount?: number;

  /** DRAFT actions */
  onCancel: () => void;
  onSaveDraft?: () => void;
  onPost?: () => void;
  onSubmitForApproval?: () => void;

  /** READY actions (approver only) */
  onApprove?: () => void;
  onReject?: () => void;

  /** POSTED / REVERSED actions */
  onReverse?: (payload: { reasonId: string; reasonLabel: string; note: string }) => void;
  onClose?: () => void;
  onPrint?: () => void;
}

const STATUS_LABEL: Record<IcabStatus, string> = {
  DRAFT: 'ฉบับร่าง',
  READY: 'รออนุมัติ',
  POSTED: 'ลงบัญชีแล้ว',
  REVERSED: 'กลับรายการแล้ว',
};

const STATUS_PILL: Record<IcabStatus, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  READY: 'bg-info/10 text-info',
  POSTED: 'bg-success/10 text-success',
  REVERSED: 'bg-destructive/10 text-destructive',
};

function Stepper({
  status,
  makerCheckerEnabled,
}: {
  status: IcabStatus;
  makerCheckerEnabled: boolean;
}) {
  // Force the READY step whenever the doc is already in READY, so the active
  // dot resolves even before useUiFlags settles (matches legacy behaviour).
  const steps: { key: IcabStatus; label: string }[] = [
    { key: 'DRAFT', label: 'ฉบับร่าง' },
    ...(makerCheckerEnabled || status === 'READY'
      ? [{ key: 'READY' as IcabStatus, label: 'รออนุมัติ' }]
      : []),
    { key: 'POSTED', label: 'ลงบัญชี' },
    { key: 'REVERSED', label: 'กลับรายการ' },
  ];
  const currentIndex = steps.findIndex((s) => s.key === status);

  return (
    <ol className="flex items-center">
      {steps.map((step, i) => {
        const done = i < currentIndex;
        const active = i === currentIndex;
        const reached = done || active;
        return (
          <li key={step.key} className="flex flex-1 items-center last:flex-none">
            <div
              className="flex flex-col items-center gap-1.5"
              data-testid="state-machine-dot"
              data-state={active ? 'active' : done ? 'past' : 'future'}
              data-label={step.key}
            >
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-full border ${
                  reached
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-muted/40 text-muted-foreground'
                }`}
              >
                {reached ? (
                  <CheckCircle2 size={18} aria-hidden />
                ) : (
                  <Circle size={16} aria-hidden />
                )}
              </span>
              <span
                className={`text-xs font-medium leading-snug ${
                  reached ? 'text-foreground' : 'text-muted-foreground'
                }`}
              >
                {step.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <span
                className={`mx-1.5 -mt-5 h-0.5 flex-1 rounded-full sm:mx-2 ${
                  i < currentIndex ? 'bg-primary' : 'bg-border'
                }`}
                aria-hidden
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function InternalControlActionBar(props: InternalControlActionBarProps) {
  const {
    module,
    status,
    auditLog,
    currentUser,
    makerCheckerEnabled = false,
    isOwnDoc = false,
    isViewerApprover = false,
    canReverse = false,
    errorCount = 0,
    canPost = true,
    isLoading = false,
    printLabel,
    docSubtitle,
    docNumber,
    docAmount,
    onCancel,
    onSaveDraft,
    onPost,
    onSubmitForApproval,
    onApprove,
    onReject,
    onReverse,
    onClose,
    onPrint,
  } = props;

  const flags = useUiFlags();
  const [reverseDialogOpen, setReverseDialogOpen] = useState(false);

  const recorder =
    auditLog.find((e) => e.event === 'CREATED')?.userName ?? currentUser.name;
  const approver = auditLog.find((e) => e.event === 'APPROVED' || e.event === 'POSTED');

  const resolvedPrintLabel = printLabel ?? ICAB_MODULE_DEFAULTS[module].printLabel;
  const showApprovalBadge = makerCheckerEnabled && (status === 'DRAFT' || status === 'READY');

  // Effective "is this user allowed to reverse?" — combines:
  //   1. OWNER always allowed (policy owner short-circuit).
  //   2. CUSTOM mode: per-user `canReverseOverride` flag.
  //   3. Other modes: caller-supplied `canReverse` prop (pre-flight role check).
  // The server `ReversePermissionGuard` re-validates on every reverse request,
  // so this flag is UI-only and never a security boundary.
  const canReverseResolved =
    currentUser.role === 'OWNER' ||
    (flags.reversePermission === 'CUSTOM'
      ? currentUser.canReverseOverride === true
      : canReverse);

  return (
    <>
      <section
        data-testid="icab-frame"
        data-module={module}
        data-status={status}
        className="mt-4 rounded-xl border border-border bg-card text-card-foreground"
      >
        {/* Zone 1 — Header */}
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ShieldCheck size={18} aria-hidden />
            </span>
            <div className="leading-snug">
              <h3 className="text-sm font-semibold text-foreground">ควบคุมภายใน</h3>
              <p className="text-xs text-muted-foreground">
                {docNumber ?? 'เอกสารยังไม่ออกเลขที่'}
              </p>
            </div>
          </div>
          <span
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium leading-snug ${STATUS_PILL[status]}`}
          >
            {STATUS_LABEL[status]}
          </span>
        </div>

        {/* Zone 2 — Stepper */}
        <div className="px-4 py-4 sm:px-5">
          <Stepper status={status} makerCheckerEnabled={makerCheckerEnabled} />
        </div>

        {/* Zone 3 — Meta + audit */}
        <div className="grid gap-4 border-t border-border px-4 py-4 sm:px-5 lg:grid-cols-2">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-sm leading-snug text-foreground">
                <UserIcon size={14} className="text-muted-foreground" aria-hidden />
                <span className="text-muted-foreground">ผู้บันทึก:</span>
                <span className="font-medium">{recorder}</span>
              </span>
              {showApprovalBadge && (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2.5 py-1 text-xs font-medium leading-snug text-warning"
                  title="เอกสารนี้ต้องผ่านการอนุมัติก่อนลงบัญชี"
                >
                  ต้องอนุมัติ
                </span>
              )}
            </div>
            {approver && (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-sm leading-snug text-foreground">
                <ShieldCheck size={14} className="text-muted-foreground" aria-hidden />
                <span className="text-muted-foreground">ผู้อนุมัติ:</span>
                <span className="font-medium">{approver.userName}</span>
              </span>
            )}
          </div>

          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-sm font-medium leading-snug text-foreground">
                <History size={14} className="text-muted-foreground" aria-hidden />
                ประวัติ ({auditLog.length})
              </span>
              {auditLog.length > 3 && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs text-primary"
                      aria-label="ดูประวัติทั้งหมด"
                    >
                      ดูทั้งหมด
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="max-h-[420px] w-80 overflow-y-auto">
                    <p className="mb-3 text-sm font-semibold leading-snug">
                      ประวัติการทำงาน ({auditLog.length})
                    </p>
                    <AuditTimeline events={auditLog} />
                  </PopoverContent>
                </Popover>
              )}
            </div>
            <AuditTimeline events={auditLog.slice(-3)} compact />
          </div>
        </div>

        {/* Zone 4 — State-aware action buttons */}
        <div className="flex flex-col gap-3 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="min-h-[1.25rem] text-xs leading-snug">
            {status === 'DRAFT' && errorCount > 0 && (
              <span className="inline-flex items-center gap-1.5 font-semibold text-destructive">
                <AlertCircle size={14} aria-hidden />
                มี {errorCount} ข้อต้องแก้ไข
              </span>
            )}
            {status === 'READY' && !isViewerApprover && !isOwnDoc && (
              <span className="text-muted-foreground">รออนุมัติจาก OWNER</span>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            {/* Universal "go back / close" button — label depends on context */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={status === 'POSTED' || status === 'REVERSED' ? (onClose ?? onCancel) : onCancel}
              disabled={isLoading}
            >
              <ArrowLeft size={14} className="mr-1.5" aria-hidden />
              {(() => {
                const isViewOnlyDraft =
                  status === 'DRAFT' && !onSaveDraft && !onPost && !onSubmitForApproval;
                if (status === 'POSTED' || status === 'REVERSED' || isViewOnlyDraft) return 'ปิด';
                if (status === 'READY') return 'กลับ';
                return 'ยกเลิก';
              })()}
            </Button>

            {/* DRAFT actions */}
            {status === 'DRAFT' && (
              <>
                {onSaveDraft && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onSaveDraft}
                    disabled={isLoading}
                  >
                    <Save size={14} className="mr-1.5" aria-hidden />
                    บันทึกร่าง
                  </Button>
                )}
                {makerCheckerEnabled
                  ? onSubmitForApproval && (
                      <Button
                        type="button"
                        size="sm"
                        onClick={onSubmitForApproval}
                        disabled={isLoading || !canPost}
                      >
                        <Send size={14} className="mr-1.5" aria-hidden />
                        ส่งให้อนุมัติ
                      </Button>
                    )
                  : onPost && (
                      <Button
                        type="button"
                        size="sm"
                        onClick={onPost}
                        disabled={isLoading || !canPost}
                      >
                        <CheckCircle2 size={14} className="mr-1.5" aria-hidden />
                        บันทึก & POST
                      </Button>
                    )}
              </>
            )}

            {/* READY actions (approver only) */}
            {status === 'READY' && isViewerApprover && (
              <>
                {onReject && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onReject}
                    disabled={isLoading}
                    className="border-destructive/40 text-destructive hover:bg-destructive/10"
                  >
                    <XCircle size={14} className="mr-1.5" aria-hidden />
                    ปฏิเสธ
                  </Button>
                )}
                {onApprove && (
                  <Button type="button" size="sm" onClick={onApprove} disabled={isLoading}>
                    <CheckCircle2 size={14} className="mr-1.5" aria-hidden />
                    อนุมัติ & POST
                  </Button>
                )}
              </>
            )}

            {/* POSTED actions */}
            {status === 'POSTED' && (
              <>
                {onPrint && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onPrint}
                    disabled={isLoading}
                  >
                    <Printer size={14} className="mr-1.5" aria-hidden />
                    {resolvedPrintLabel}
                  </Button>
                )}
                {onReverse && canReverseResolved && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setReverseDialogOpen(true)}
                    disabled={isLoading}
                    className="border-destructive/40 text-destructive hover:bg-destructive/10"
                  >
                    <Undo2 size={14} className="mr-1.5" aria-hidden />
                    ยกเลิก / กลับรายการ
                  </Button>
                )}
              </>
            )}

            {/* REVERSED actions */}
            {status === 'REVERSED' && onPrint && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onPrint}
                disabled={isLoading}
              >
                <Printer size={14} className="mr-1.5" aria-hidden />
                พิมพ์ใบกลับรายการ
              </Button>
            )}
          </div>
        </div>
      </section>

      {onReverse && docNumber && (
        <ReverseConfirmDialog
          open={reverseDialogOpen}
          onOpenChange={setReverseDialogOpen}
          module={module}
          docNumber={docNumber}
          docSubtitle={docSubtitle}
          docAmount={docAmount}
          isLoading={isLoading}
          onConfirm={(payload) => {
            onReverse(payload);
            setReverseDialogOpen(false);
          }}
        />
      )}
    </>
  );
}
