import { useState } from 'react';
import {
  ArrowLeft,
  Save,
  Send,
  CheckCircle2,
  XCircle,
  Undo2,
  Lock,
  ShieldAlert,
  User as UserIcon,
  Printer,
  History,
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
 * InternalControlActionBar — the single shared "ควบคุมภายใน" action bar
 * used by all three accounting modules (Other Income, Expense, Asset).
 *
 * Responsibilities (per InternalControlActionBar v2.2 spec):
 *  1. Render the purple-border control panel with state machine + buttons.
 *  2. Render the audit timeline (CREATED → POSTED → REVERSED + reason).
 *  3. Conditionally render buttons per status:
 *     - DRAFT      → ยกเลิก / บันทึกร่าง / บันทึก+POST (or submit-for-approval)
 *     - READY      → กลับ / ปฏิเสธ / อนุมัติ+POST (approver only)
 *     - POSTED     → ปิด / พิมพ์ / กลับรายการ (gated by canReverse)
 *     - REVERSED   → ปิด / พิมพ์ใบกลับรายการ
 *  4. Open the unified ReverseConfirmDialog and forward (reasonLabel, note)
 *     to the parent module via `onReverse`. Parent module is responsible
 *     for the actual Reverse Entry — this component never touches JE.
 *  5. Enforce the state machine — REVERSED is terminal, no buttons re-fire.
 *
 * Per-module logic (JE Generator, VAT/WHT, Auto Journal) lives in the
 * parent module. This component is presentational + lightweight state only.
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

const STATE_LABELS: Record<IcabStatus, string> = {
  DRAFT: 'DRAFT',
  READY: 'READY',
  POSTED: 'POSTED',
  REVERSED: 'REVERSED',
};

function StateMachineBar({
  status,
  makerCheckerEnabled,
}: {
  status: IcabStatus;
  makerCheckerEnabled: boolean;
}) {
  const statesAll: IcabStatus[] = ['DRAFT', 'READY', 'POSTED', 'REVERSED'];
  // Force 4-step bar whenever doc is in READY so the dot resolves to active
  // even before useUiFlags settles.
  const states =
    makerCheckerEnabled || status === 'READY'
      ? statesAll
      : (['DRAFT', 'POSTED', 'REVERSED'] as IcabStatus[]);
  const currentIndex = states.indexOf(status);

  return (
    <div className="flex items-center gap-2 w-full">
      {states.map((s, i) => {
        const isActive = i === currentIndex;
        const isPast = i < currentIndex;
        const state = isActive ? 'active' : isPast ? 'past' : 'future';
        const dotClasses =
          state === 'active'
            ? 'w-3 h-3 rounded-full bg-primary ring-4 ring-primary/20'
            : state === 'past'
              ? 'w-2.5 h-2.5 rounded-full bg-muted-foreground'
              : 'w-2.5 h-2.5 rounded-full border-2 border-border bg-background';
        const labelClasses =
          state === 'active'
            ? 'text-xs font-semibold text-primary'
            : state === 'past'
              ? 'text-xs text-muted-foreground'
              : 'text-xs text-muted-foreground/60';
        return (
          <div key={s} className="flex items-center gap-2 flex-1">
            <div className="flex flex-col items-center gap-1">
              <div
                data-testid="state-machine-dot"
                data-state={state}
                data-label={s}
                className={dotClasses}
              />
              <span className={labelClasses}>{STATE_LABELS[s]}</span>
            </div>
            {i < states.length - 1 && (
              <div className="flex-1 border-t-2 border-dashed border-border" />
            )}
          </div>
        );
      })}
    </div>
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

  const frameClass =
    'fixed bottom-0 left-0 right-0 z-40 px-4 md:px-6 py-3 ' +
    'border-t-2 bg-[hsl(var(--accent-purple)/0.04)] border-[hsl(var(--accent-purple)/0.3)] ' +
    'shadow-lg backdrop-blur-sm';

  return (
    <>
      <div className={frameClass} data-testid="icab-frame" data-module={module} data-status={status}>
        <div className="max-w-5xl mx-auto space-y-3">
          {/* Row 1 — Internal-Control label + recorder/approver pills + history popover */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[hsl(var(--accent-purple))]">
              <Lock size={13} aria-hidden />
              ควบคุมภายใน
              <StatusBadge status={status} docNumber={docNumber} />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {recorder && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-info/10 text-info text-xs leading-snug">
                  <UserIcon size={13} aria-hidden />
                  <span className="text-muted-foreground">ผู้บันทึก:</span>
                  <span className="font-semibold text-foreground">{recorder}</span>
                </span>
              )}
              {approver && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-success/10 text-success text-xs leading-snug">
                  <CheckCircle2 size={13} aria-hidden />
                  <span className="text-muted-foreground">ผู้อนุมัติ:</span>
                  <span className="font-semibold text-foreground">{approver.userName}</span>
                </span>
              )}
              {showApprovalBadge && (
                <span
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-warning/15 text-warning text-xs font-semibold leading-snug"
                  title="เอกสารนี้ต้องผ่านการอนุมัติก่อนลงบัญชี"
                >
                  <ShieldAlert size={13} aria-hidden />
                  ต้องอนุมัติ
                </span>
              )}

              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1.5 text-xs"
                    aria-label="ดูประวัติการทำงาน"
                  >
                    <History size={14} aria-hidden />
                    ประวัติ ({auditLog.length})
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  className="w-[420px] max-h-[480px] overflow-y-auto"
                >
                  <h4 className="text-sm font-semibold mb-3 leading-snug">
                    ประวัติการทำงาน
                  </h4>
                  <AuditTimeline events={auditLog} />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* Row 2 — State machine bar (collapses to a single dot on mobile) */}
          <div className="hidden md:block">
            <StateMachineBar status={status} makerCheckerEnabled={makerCheckerEnabled} />
          </div>
          <div className="md:hidden text-xs text-muted-foreground">
            สถานะ: <span className="font-semibold text-primary">● {STATE_LABELS[status]}</span>
          </div>

          {/* Row 3 — State-aware action buttons */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-xs leading-snug">
              {status === 'DRAFT' && errorCount > 0 && (
                <span className="text-destructive font-semibold">
                  มี {errorCount} ข้อต้องแก้ไข
                </span>
              )}
              {status === 'READY' && !isViewerApprover && !isOwnDoc && (
                <span className="text-muted-foreground">รออนุมัติจาก OWNER</span>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
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
        </div>
      </div>

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

function StatusBadge({ status, docNumber }: { status: IcabStatus; docNumber?: string }) {
  if (status === 'DRAFT') {
    return (
      <span className="ml-2 inline-flex items-center gap-1 rounded-md border border-warning/40 bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning leading-snug">
        📝 ฉบับร่าง — ยังไม่ลงบัญชี
      </span>
    );
  }
  if (status === 'POSTED') {
    return (
      <span className="ml-2 inline-flex items-center gap-1 rounded-md border border-success/40 bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success leading-snug">
        ✓ ลงบัญชีแล้ว{docNumber ? ` — ${docNumber}` : ''}
      </span>
    );
  }
  if (status === 'REVERSED') {
    return (
      <span className="ml-2 inline-flex items-center gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive leading-snug">
        ↺ กลับรายการแล้ว{docNumber ? ` — ${docNumber}` : ''}
      </span>
    );
  }
  if (status === 'READY') {
    return (
      <span className="ml-2 inline-flex items-center gap-1 rounded-md border border-info/40 bg-info/10 px-2 py-0.5 text-[11px] font-medium text-info leading-snug">
        ⏳ รออนุมัติ
      </span>
    );
  }
  return null;
}
