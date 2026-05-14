import { ArrowLeft, Save, Send, CheckCircle2, XCircle, Undo2, Lock, ShieldAlert, User as UserIcon } from 'lucide-react';

export type DocStatus = 'DRAFT' | 'READY' | 'POSTED' | 'REVERSED';

export interface InternalControlBarProps {
  status: DocStatus;
  recorder: { name: string };
  approver: { name: string };
  makerCheckerEnabled: boolean;
  isViewerApprover?: boolean;
  isLoading?: boolean;
  errorCount?: number;
  canPost?: boolean;

  onCancel: () => void;
  onSaveDraft?: () => void;
  onPost?: () => void;
  onSubmitForApproval?: () => void;
  onApprove?: () => void;
  onReject?: () => void;
  onReverse?: () => void;
}

const STATE_LABELS: Record<DocStatus, string> = {
  DRAFT: 'DRAFT',
  READY: 'READY',
  POSTED: 'POSTED',
  REVERSED: 'REVERSED',
};

function StateMachineBar({
  status,
  makerCheckerEnabled,
}: {
  status: DocStatus;
  makerCheckerEnabled: boolean;
}) {
  const statesAll: DocStatus[] = ['DRAFT', 'READY', 'POSTED', 'REVERSED'];
  // Force the 4-step bar whenever doc is in READY, even if the flag is still
  // loading or temporarily off — otherwise indexOf('READY') in a 3-step array
  // returns -1 and every dot renders as "future" (no active dot).
  const states =
    makerCheckerEnabled || status === 'READY'
      ? statesAll
      : (['DRAFT', 'POSTED', 'REVERSED'] as DocStatus[]);
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
              <div data-testid="state-machine-dot" data-state={state} data-label={s} className={dotClasses} />
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

export function InternalControlBar({
  status,
  recorder,
  approver,
  makerCheckerEnabled,
  isViewerApprover = false,
  isLoading = false,
  errorCount = 0,
  canPost = true,
  onCancel,
  onSaveDraft,
  onPost,
  onSubmitForApproval,
  onApprove,
  onReject,
  onReverse,
}: InternalControlBarProps) {
  const showApprovalBadge =
    makerCheckerEnabled && (status === 'DRAFT' || status === 'READY');

  const frameClass =
    'fixed bottom-0 left-0 right-0 z-40 px-4 md:px-6 py-3 ' +
    'border-t-2 bg-[hsl(var(--accent-purple)/0.04)] border-[hsl(var(--accent-purple)/0.3)] ' +
    'shadow-lg backdrop-blur-sm';

  return (
    <div className={frameClass}>
      <div className="max-w-5xl mx-auto space-y-3">
        {/* Row 1 — Internal Control label + pills */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[hsl(var(--accent-purple))]">
            <Lock size={13} />
            ควบคุมภายใน
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-info/10 text-info text-xs"
              title="ระบบกำหนดอัตโนมัติตาม user ที่เข้าใช้งานในขณะนี้"
            >
              <UserIcon size={13} />
              <span className="text-muted-foreground">ผู้บันทึก:</span>
              <span className="font-semibold text-foreground">{recorder.name}</span>
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-success/10 text-success text-xs">
              <CheckCircle2 size={13} />
              <span className="text-muted-foreground">ผู้อนุมัติ:</span>
              <span className="font-semibold text-foreground">{approver.name}</span>
            </span>
            {showApprovalBadge && (
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-warning/15 text-warning text-xs font-semibold"
                title="เอกสารนี้ต้องผ่านการอนุมัติก่อนลงบัญชี"
              >
                <ShieldAlert size={13} />
                ต้องอนุมัติ
              </span>
            )}
          </div>
        </div>

        {/* Row 2 — State Machine Bar */}
        <div className="hidden md:block">
          <StateMachineBar status={status} makerCheckerEnabled={makerCheckerEnabled} />
        </div>
        <div className="md:hidden text-xs text-muted-foreground">
          สถานะ: <span className="font-semibold text-primary">● {STATE_LABELS[status]}</span>
        </div>

        {/* Row 3 — State-aware action buttons */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="text-xs">
            {status === 'DRAFT' && errorCount > 0 && (
              <span className="text-destructive font-semibold">มี {errorCount} ข้อต้องแก้ไข</span>
            )}
            {status === 'READY' && !isViewerApprover && (
              <span className="text-muted-foreground">รออนุมัติจาก OWNER</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={isLoading}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border rounded-md hover:bg-accent disabled:opacity-50"
            >
              <ArrowLeft size={14} />
              {status === 'POSTED' || status === 'REVERSED' ? 'ปิด' : status === 'READY' ? 'กลับ' : 'ยกเลิก'}
            </button>

            {/* DRAFT actions */}
            {status === 'DRAFT' && (
              <>
                <button
                  type="button"
                  onClick={onSaveDraft}
                  disabled={isLoading}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold border rounded-md hover:bg-accent disabled:opacity-50"
                >
                  <Save size={14} />
                  บันทึกร่าง
                </button>
                {makerCheckerEnabled ? (
                  <button
                    type="button"
                    onClick={onSubmitForApproval}
                    disabled={isLoading || !canPost}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Send size={14} />
                    ส่งให้อนุมัติ
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onPost}
                    disabled={isLoading || !canPost}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <CheckCircle2 size={14} />
                    บันทึก & POST
                  </button>
                )}
              </>
            )}

            {/* READY actions (approver only) */}
            {status === 'READY' && isViewerApprover && (
              <>
                <button
                  type="button"
                  onClick={onReject}
                  disabled={isLoading}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold border border-destructive/40 text-destructive rounded-md hover:bg-destructive/10 disabled:opacity-50"
                >
                  <XCircle size={14} />
                  ปฏิเสธ
                </button>
                <button
                  type="button"
                  onClick={onApprove}
                  disabled={isLoading}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-40"
                >
                  <CheckCircle2 size={14} />
                  อนุมัติ & POST
                </button>
              </>
            )}

            {/* POSTED actions */}
            {status === 'POSTED' && onReverse && (
              <button
                type="button"
                onClick={onReverse}
                disabled={isLoading}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold border border-destructive/40 text-destructive rounded-md hover:bg-destructive/10 disabled:opacity-50"
              >
                <Undo2 size={14} />
                กลับรายการ
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
