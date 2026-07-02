import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useQuery, useMutation } from '@tanstack/react-query';
import Decimal from 'decimal.js';
import {
  CheckCircle2,
  AlertCircle,
  Loader2,
  Upload,
  X,
  Banknote,
  QrCode,
  CreditCard,
  Building2,
  Info,
  Lock,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import api, { getErrorMessage } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { formatNumberDecimal } from '@/utils/formatters';
import { AccrualModeChip } from './AccrualModeChip';
import { CASH_ACCOUNT_CODES } from '@/components/CashAccountSelect';
import { formatThaiDate } from '@/lib/date';
import { useDebounce } from '@/hooks/useDebounce';
import { toast } from 'sonner';
import type { PendingPayment } from '../types';
import { computeNetReceiptDue } from '../computeNetReceiptDue';
import { computeWizardPrefill } from '../computeWizardPrefill';
import { AdvanceBalanceBanner } from './AdvanceBalanceBanner';
import { EarlyPayoffOverlay } from '@/components/contract/ContractEarlyPayoff';
import { RescheduleOverlay } from './RescheduleOverlay';
import { RepossessionOverlay } from './RepossessionOverlay';

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Auto-detected payment case (computed from amount diff client-side).
 * RESCHEDULE / EARLY_PAYOFF are handled in separate contract-detail pages, not here.
 */
type DetectedCase = 'NORMAL' | 'OVERPAY' | 'UNDERPAY' | 'OVERPAY_ADVANCE' | 'PARTIAL' | 'OUT_OF_RANGE';

/** Legacy type kept for API compatibility — backend accepts all 7 values */
type PaymentCase = 'NORMAL' | 'OVERPAY' | 'UNDERPAY' | 'PARTIAL' | 'EARLY_PAYOFF' | 'RESCHEDULE' | 'OVERPAY_ADVANCE';

type WizardMethod = 'CASH' | 'TRANSFER' | 'QR' | 'CARD';

interface JePreviewLine {
  accountCode: string;
  accountName: string;
  debit: string;
  credit: string;
  description: string;
  block?: '2A' | '2B';
  posted?: boolean;
}

interface BlockSubtotal {
  debit: string;
  credit: string;
  balanced: boolean;
}

interface JePreview {
  lines: JePreviewLine[];
  /** Already-posted 2A accrual context (present only in 2B_ONLY mode). */
  accrual2A?: { lines: JePreviewLine[]; subtotal: BlockSubtotal };
  /** Per-block Dr/Cr subtotals + balance flag. */
  subtotals?: { '2A'?: BlockSubtotal; '2B': BlockSubtotal };
  totalDebit: string;
  totalCredit: string;
  isBalanced: boolean;
  rescheduleFeeDisplay?: string;
  accrualMode?: '2B_ONLY' | 'CONSOLIDATED_PAYING_AHEAD' | 'CONSOLIDATED_BACKFILL';
  dueDate?: string;
}

interface CoaRow {
  code: string;
  name: string;
}

// ─── Contract info panel ──────────────────────────────────────────────────────

function ContractInfoPanel({
  payment,
  lateFee,
  netExposure,
  onOpenPayoff,
}: {
  payment: PendingPayment;
  lateFee: Decimal;
  netExposure: Decimal;
  onOpenPayoff: () => void;
}) {
  const amountDue = new Decimal(payment.amountDue);
  const amountPaid = new Decimal(payment.amountPaid);
  const totalDue = amountDue.add(lateFee).sub(amountPaid).toDecimalPlaces(2);
  const isOverdue = payment.status === 'OVERDUE';

  const row = (label: string, value: React.ReactNode, red?: boolean) => (
    <div className="flex justify-between text-sm py-0.5 border-b border-border/50 last:border-0">
      <span className="text-muted-foreground leading-snug">{label}</span>
      <span className={cn('font-medium leading-snug', red && 'text-destructive')}>{value}</span>
    </div>
  );

  return (
    <div className="rounded-xl border border-border bg-card p-3.5 space-y-0.5 min-w-0 h-fit">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
        ข้อมูลสัญญา
      </h3>
      {row('เลขสัญญา', <span className="font-mono text-xs">{payment.contract.contractNumber}</span>)}
      {row('ชื่อลูกค้า', payment.contract.customer.name)}
      {row('งวดที่', `งวดที่ ${payment.installmentNo}`)}
      {row('วันครบกำหนด', formatThaiDate(payment.dueDate), isOverdue)}
      {row(
        'ค่างวด',
        `${amountDue.toNumber().toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿`,
      )}
      {lateFee.gt(0) &&
        row(
          'ค่าปรับ',
          `${lateFee.toNumber().toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿`,
          true,
        )}
      {amountPaid.gt(0) && (
        <>
          {row(
            'จ่ายแล้ว',
            <span className="text-muted-foreground font-mono">
              {amountPaid.toNumber().toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
            </span>,
          )}
          <div className="flex justify-between text-sm py-1 border-b border-border/50 border-t mt-1 pt-1">
            <span className="text-warning font-bold leading-snug">ยอดเหลือ</span>
            <span className="text-warning font-bold font-mono leading-snug">
              {totalDue.toNumber().toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
            </span>
          </div>
        </>
      )}
      {amountPaid.lte(0) && (
      <div className="flex justify-between text-sm pt-2 font-bold">
        <span className="leading-snug">ยอดรวมต้องชำระ</span>
        <span className="text-primary leading-snug">
          {totalDue.toNumber().toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
        </span>
      </div>
      )}
      <div className="pt-2 mt-1 border-t border-border">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span className="leading-snug">Net Exposure</span>
          <span className="font-medium leading-snug text-foreground">
            {netExposure.toNumber().toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
          </span>
        </div>
        <div className="mt-1">
          <span
            className={cn(
              'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium leading-snug',
              isOverdue
                ? 'bg-destructive/10 text-destructive'
                : 'bg-success/10 text-success',
            )}
          >
            {isOverdue ? 'ค้างชำระ' : 'รอชำระ'}
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={onOpenPayoff}
        className="mt-2 w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-semibold rounded-lg bg-warning/10 text-warning border border-warning/30 hover:bg-warning/20 transition-colors"
      >
        <Lock className="size-4" />
        ปิดยอดสัญญาทั้งหมด
      </button>
    </div>
  );
}

// ─── Auto-detect case badge ────────────────────────────────────────────────────

function CaseBadge({
  detectedCase,
  diff,
}: {
  detectedCase: DetectedCase;
  diff: number;
}) {
  const absDiff = Math.abs(diff).toLocaleString('th-TH', { minimumFractionDigits: 2 });

  if (detectedCase === 'NORMAL') {
    return (
      <div className="flex items-center gap-1.5 rounded-lg border border-success/40 bg-success/5 px-3 py-2 text-sm">
        <CheckCircle2 className="size-4 text-success shrink-0" />
        <span className="text-success font-medium leading-snug">จ่ายครบยอด</span>
      </div>
    );
  }

  if (detectedCase === 'OVERPAY') {
    return (
      <div className="flex items-center gap-1.5 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-sm">
        <AlertCircle className="size-4 text-warning shrink-0" />
        <span className="text-warning font-medium leading-snug">
          จ่ายเกิน {absDiff} ฿ — บันทึกเข้า 53-1503 อัตโนมัติ
        </span>
      </div>
    );
  }

  if (detectedCase === 'UNDERPAY') {
    return (
      <div className="flex items-center gap-1.5 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-sm">
        <AlertCircle className="size-4 text-warning shrink-0" />
        <span className="text-warning font-medium leading-snug">
          จ่ายขาด {absDiff} ฿ — Dr 52-1104 (ต้องอนุมัติ)
        </span>
      </div>
    );
  }

  if (detectedCase === 'OVERPAY_ADVANCE') {
    return (
      <div className="flex items-center gap-1.5 rounded-lg border border-info/40 bg-info/5 px-3 py-2 text-sm">
        <Info className="size-4 text-info shrink-0" />
        <span className="text-info font-medium leading-snug">
          เกิน {absDiff} ฿ — บันทึกเป็นเงินรับล่วงหน้า (หักงวดถัดไปอัตโนมัติ)
        </span>
      </div>
    );
  }

  if (detectedCase === 'PARTIAL') {
    return (
      <div className="flex items-center gap-1.5 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-sm">
        <AlertCircle className="size-4 text-warning shrink-0" />
        <span className="text-warning font-medium leading-snug">
          จ่ายขาด {absDiff} ฿ — บันทึกบางส่วน ลูกค้าค้าง {absDiff} ฿ ต่อ
        </span>
      </div>
    );
  }

  // OUT_OF_RANGE
  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
      <AlertCircle className="size-4 text-destructive shrink-0" />
      <span className="text-destructive font-medium leading-snug">
        ห่างเกิน 1 ฿ — ใช้เมนูแบ่งชำระ/ปิดยอดแทน
      </span>
    </div>
  );
}

// ─── Slip upload helper ────────────────────────────────────────────────────────

const MAX_SLIP_BYTES = 10 * 1024 * 1024; // 10 MB
const SLIP_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

function useSlipUpload() {
  const mutation = useMutation({
    mutationFn: async (file: File) => {
      if (file.size > MAX_SLIP_BYTES) throw new Error('ไฟล์ใหญ่เกิน 10MB');
      if (!SLIP_MIME_TYPES.includes(file.type)) {
        throw new Error('รองรับ JPG, PNG, WebP, PDF เท่านั้น');
      }
      const { data: presign } = await api.post<{
        uploadUrl: string;
        method: string;
        key: string;
        publicUrl: string;
      }>('/shop/upload/signed-url', {
        kind: 'BANK_SLIP',
        contentType: file.type,
      });

      const putRes = await fetch(presign.uploadUrl, {
        method: presign.method,
        body: file,
        headers: { 'Content-Type': file.type },
      });
      if (!putRes.ok) throw new Error('อัปโหลดสลิปไม่สำเร็จ');

      return presign.publicUrl;
    },
  });
  return mutation;
}

// ─── Method options ───────────────────────────────────────────────────────────

const METHOD_OPTIONS: { id: WizardMethod; label: string; icon: React.ReactNode; desc: string }[] = [
  { id: 'CASH', label: 'เงินสด', icon: <Banknote className="size-4" />, desc: 'รับเงินสดโดยตรง' },
  { id: 'TRANSFER', label: 'โอนธนาคาร', icon: <Building2 className="size-4" />, desc: 'ลูกค้าโอนเอง · กรอก ref + slip' },
  { id: 'QR', label: 'ชำระผ่าน QR', icon: <QrCode className="size-4" />, desc: 'ส่ง QR ให้ลูกค้าใน LINE' },
  { id: 'CARD', label: 'บัตร', icon: <CreditCard className="size-4" />, desc: 'เครื่อง EDC · เงินเข้าบัญชีธนาคาร' },
];

// Late-fee waiver reasons (fallback; mirrors SystemConfig `late_fee_waiver_reasons` seed).
const WAIVER_REASONS: { code: string; label: string }[] = [
  { code: 'loyal_customer', label: 'ลูกค้าประจำ — ผ่อนตรงเวลามาตลอด' },
  { code: 'first_time', label: 'ผิดนัดครั้งแรก' },
  { code: 'system_error', label: 'ความผิดพลาดของระบบ' },
  { code: 'goodwill', label: 'รักษาความสัมพันธ์ (goodwill)' },
  { code: 'other', label: 'อื่นๆ (ระบุในหมายเหตุ)' },
];

const WAIVER_APPROVER_ROLES = ['OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER'];

interface ApproverRow {
  id: string;
  name: string;
  role: string;
  isActive?: boolean;
  deletedAt?: string | null;
}

// ─── JE Preview panel (always visible) ────────────────────────────────────────

/** One JE block (2A or 2B) — line rows + a per-block "Dr = Cr =" footer. */
function JeBlock({
  title,
  posted,
  lines,
  subtotal,
}: {
  title: string;
  posted?: boolean;
  lines: JePreviewLine[];
  subtotal?: BlockSubtotal;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border p-2',
        posted ? 'border-border/60 bg-muted/40' : 'border-border bg-background',
      )}
    >
      <div className="flex items-center justify-between mb-1.5">
        <h4 className="text-xs font-semibold text-foreground leading-snug">{title}</h4>
        {posted && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground text-[10px] font-medium leading-snug">
            โพสต์แล้ว
          </span>
        )}
      </div>
      <div className="space-y-1">
        <div className="grid grid-cols-[52px_1fr_64px_64px] gap-1 text-[11px] text-muted-foreground font-medium pb-1 border-b border-border/60">
          <span className="leading-snug">รหัส</span>
          <span className="leading-snug">บัญชี</span>
          <span className="text-right leading-snug">Dr</span>
          <span className="text-right leading-snug">Cr</span>
        </div>
        {lines.map((line, idx) => (
          <div key={idx} className="grid grid-cols-[52px_1fr_64px_64px] gap-1 text-xs">
            <span className="font-mono text-muted-foreground leading-snug">{line.accountCode}</span>
            <div className="min-w-0">
              <span className="leading-snug text-foreground truncate block">{line.accountName}</span>
              {line.description && (
                <span className="leading-snug text-muted-foreground/70 text-[10px]">
                  {line.description}
                </span>
              )}
            </div>
            <span className="text-right font-mono leading-snug text-foreground">
              {parseFloat(line.debit) > 0 ? formatNumberDecimal(line.debit) : ''}
            </span>
            <span className="text-right font-mono leading-snug text-foreground">
              {parseFloat(line.credit) > 0 ? formatNumberDecimal(line.credit) : ''}
            </span>
          </div>
        ))}
      </div>
      {subtotal && (
        <div
          className={cn(
            'flex items-center justify-between mt-2 pt-1.5 border-t text-[11px] font-medium',
            subtotal.balanced
              ? 'border-success/30 text-success'
              : 'border-destructive/30 text-destructive',
          )}
        >
          <div className="flex items-center gap-1 leading-snug">
            {subtotal.balanced ? (
              <CheckCircle2 className="size-3" />
            ) : (
              <AlertCircle className="size-3" />
            )}
            <span>Dr = Cr</span>
          </div>
          <span className="font-mono leading-snug">
            {formatNumberDecimal(subtotal.debit)} = {formatNumberDecimal(subtotal.credit)}
          </span>
        </div>
      )}
    </div>
  );
}

function JePreviewPanel({
  preview,
  isLoading,
  errorMessage,
}: {
  preview: JePreview | undefined;
  isLoading: boolean;
  errorMessage?: string;
}) {
  const has2A = !!preview?.accrual2A && preview.accrual2A.lines.length > 0;
  const consolidated =
    !!preview &&
    !has2A &&
    (preview.accrualMode === 'CONSOLIDATED_PAYING_AHEAD' ||
      preview.accrualMode === 'CONSOLIDATED_BACKFILL');
  // 2B subtotal: prefer the server's per-block value; fall back to overall totals.
  const sub2B: BlockSubtotal | undefined = preview
    ? preview.subtotals?.['2B'] ?? {
        debit: preview.totalDebit,
        credit: preview.totalCredit,
        balanced: preview.isBalanced,
      }
    : undefined;
  const label2B = has2A
    ? '2B — รับเงิน + อนุโลม'
    : consolidated
    ? '2A + 2B — โพสต์รวมตอนนี้'
    : '2B — รับเงิน';

  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-foreground leading-snug">รายการบัญชี</h3>
        <span
          className={cn(
            'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium leading-snug',
            preview && !preview.isBalanced
              ? 'bg-destructive/10 text-destructive'
              : 'bg-primary/10 text-primary',
          )}
        >
          <CheckCircle2 className="size-3" />
          {preview && !preview.isBalanced ? 'UNBALANCED' : 'BALANCED'}
        </span>
      </div>

      {preview?.accrualMode && (
        <AccrualModeChip mode={preview.accrualMode} dueDate={preview.dueDate} />
      )}

      {errorMessage && !isLoading && (
        <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-xs leading-snug flex gap-2 text-destructive">
          <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <div className="font-medium">ไม่สามารถสร้าง JE preview ได้</div>
            <div className="text-[11px] opacity-90">{errorMessage}</div>
          </div>
        </div>
      )}

      {isLoading && (
        <div className="flex items-center gap-2 py-4 text-muted-foreground text-sm">
          <Loader2 className="size-4 animate-spin" />
          <span className="leading-snug">กำลังคำนวณ...</span>
        </div>
      )}

      {!isLoading && !preview && !errorMessage && (
        <p className="text-xs text-muted-foreground leading-snug py-2">
          กรอกยอดรับเพื่อดู JE preview
        </p>
      )}

      {!isLoading && preview && (
        <div className="space-y-2">
          {has2A && (
            <JeBlock
              title="2A — ถึงกำหนดงวด (ACCRUAL)"
              posted
              lines={preview.accrual2A!.lines}
              subtotal={preview.subtotals?.['2A'] ?? preview.accrual2A!.subtotal}
            />
          )}
          <JeBlock title={label2B} lines={preview.lines} subtotal={sub2B} />
          {consolidated && (
            <p className="text-[11px] text-muted-foreground leading-snug">
              * งวดนี้ยังไม่ได้ตั้งค้าง (accrual) — ระบบจะโพสต์ 2A + 2B รวมกันตอนบันทึก
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Auto-detect case from amount diff ───────────────────────────────────────

function detectCase(
  received: number,
  expectedTotal: Decimal,
  advanceBalance: Decimal = new Decimal(0),
  consumeAdvance: boolean = true,
): DetectedCase {
  // Effective amount due = installment minus the advance that will actually be
  // deducted. When the credit checkbox is OFF (consumeAdvance=false) no advance
  // is deducted, so the cashier collects the full installment → NORMAL on full pay
  // (NOT OVERPAY_ADVANCE, which would wrongly re-park the cash as more advance).
  const effAdvance = consumeAdvance ? advanceBalance : new Decimal(0);
  const effectiveDue = Decimal.max(new Decimal(0), expectedTotal.minus(effAdvance));

  if (received <= 0) {
    // Zero cash is OK iff the deducted advance fully covers the installment
    return effAdvance.gte(expectedTotal) ? 'NORMAL' : 'OUT_OF_RANGE';
  }
  const diff = received - effectiveDue.toNumber();
  if (Math.abs(diff) < 0.01) return 'NORMAL';
  if (diff > 0 && diff <= 1) return 'OVERPAY';            // rounding (gain)
  if (diff < 0 && diff >= -1) return 'UNDERPAY';          // rounding (loss, requires approver)
  if (diff > 1) return 'OVERPAY_ADVANCE';                 // pay > installment+1฿ → park excess
  if (diff < -1) return 'PARTIAL';                        // paid something but not enough → partial payment
  return 'OUT_OF_RANGE';                                  // only reached when received <= 0 edge cases
}

/** Map auto-detected case to the API PaymentCase param (best fit) */
function toApiCase(detected: DetectedCase): PaymentCase {
  if (detected === 'OVERPAY') return 'OVERPAY';
  if (detected === 'UNDERPAY') return 'UNDERPAY';
  if (detected === 'OVERPAY_ADVANCE') return 'OVERPAY_ADVANCE';
  if (detected === 'PARTIAL') return 'PARTIAL';
  return 'NORMAL'; // OUT_OF_RANGE should never reach API (submit blocked)
}

// ─── Main dialog (single screen) ─────────────────────────────────────────────

export interface WizardSubmitPayload {
  contractId: string;
  installmentNo: number;
  amount: number;
  paymentMethod: string;
  depositAccountCode: string;
  lateFee: number;
  case: PaymentCase;
  wizardMethod: WizardMethod;
  referenceNumber?: string;
  slipUrl?: string;
  memo?: string;
  notes?: string;
  consumeAdvance: boolean;
  paidDate: string;
  lateFeeWaiverAmount?: number;
  lateFeeWaiverReasonCode?: string;
  waiverApproverId?: string;
}

interface RecordPaymentWizardProps {
  open: boolean;
  payment: PendingPayment;
  onClose: () => void;
  onSubmit: (payload: WizardSubmitPayload) => void;
  /** Phase 4 — save the current form as an unposted draft (no JE). */
  onSaveDraft?: (payload: WizardSubmitPayload) => void;
  /** Phase 4 — post an existing draft (ลงบัญชี). */
  onPostDraft?: (paymentId: string) => void;
  /** Phase 4 — discard an existing draft. */
  onCancelDraft?: (paymentId: string) => void;
  isSubmitting: boolean;
  defaultDepositAccountCode?: string;
}

export function RecordPaymentWizard({
  open,
  payment,
  onClose,
  onSubmit,
  onSaveDraft,
  onPostDraft,
  onCancelDraft,
  isSubmitting,
  defaultDepositAccountCode = '11-1101',
}: RecordPaymentWizardProps) {
  const [depositAccountCode, setDepositAccountCode] = useState(defaultDepositAccountCode);
  const [showPartialConfirm, setShowPartialConfirm] = useState(false);
  const [showPayoffOverlay, setShowPayoffOverlay] = useState(false);
  const [showRescheduleOverlay, setShowRescheduleOverlay] = useState(false);
  const [showRepoOverlay, setShowRepoOverlay] = useState(false);
  const { user } = useAuth();
  // Explicit payment-type override (null = auto-detect). แบ่งชำระ/ล่วงหน้า force the
  // API case; ปกติ falls back to the amount-detected case.
  const [caseOverride, setCaseOverride] = useState<'PARTIAL' | 'OVERPAY_ADVANCE' | null>(null);

  // Amount fields
  const lateFeeDecimal = useMemo(() => new Decimal(payment.lateFee), [payment.lateFee]);
  const amountDueDecimal = useMemo(() => new Decimal(payment.amountDue), [payment.amountDue]);
  const amountPaidDecimal = useMemo(() => new Decimal(payment.amountPaid), [payment.amountPaid]);
  // Pre-fill amount = FULL owed INCLUDING the net late fee (single source of truth:
  // computeNetReceiptDue). Pre-filling only the base (amountDue) let a cashier confirm
  // "จ่ายเต็ม" that silently dropped the late fee → the installment stuck at
  // PARTIALLY_PAID with a phantom "ค้าง". Since lateFeeStr also pre-fills from the
  // server-computed payment.lateFee (I4 fix), the first-render amount agrees with the
  // lateFee input → no spurious "ห่างเกิน 1฿" warning.
  const defaultAmount = computeWizardPrefill({
    amountDue: amountDueDecimal,
    lateFee: lateFeeDecimal,
    amountPaid: amountPaidDecimal,
  });

  const [amountReceived, setAmountReceived] = useState(defaultAmount.toFixed(2));
  const [amountManuallyEdited, setAmountManuallyEdited] = useState(false);
  // I4 fix: pre-fill lateFee from the server-computed payment.lateFee instead
  // of hard-coding '0.00'. Previously the cashier had to retype the displayed
  // late-fee figure from the contract info panel — error-prone and slow.
  const [lateFeeStr, setLateFeeStr] = useState(lateFeeDecimal.toFixed(2));

  // Advance balance parked in 21-1103 (Decimal, serialized as string from Prisma).
  const advanceBalance = useMemo(
    () => new Decimal(payment.contract.advanceBalance ?? 0),
    [payment.contract.advanceBalance],
  );
  // Credit-deduction toggle (mockup banner checkbox). Default ON = current backend
  // behaviour. OFF → cashier collects the full owed, advance stays for next time.
  const [consumeAdvance, setConsumeAdvance] = useState(true);

  // P2 (D1) — late-fee waiver (gross model). waiverStr is the waived ฿ (Dr 52-1105);
  // Cr 42-1103 stays gross. Reason + approver gate the submit when waiver > 0.
  const [waiverStr, setWaiverStr] = useState('0');
  const [waiverReasonCode, setWaiverReasonCode] = useState('');
  const [waiverApproverId, setWaiverApproverId] = useState('');

  // Auto-sync amountReceived = (amountDue + NET late fee − paid) minus the auto-deducted
  // advance, while the user hasn't touched the amount field. Toggling the credit checkbox
  // or changing the waiver clears manual-edit so this recomputes.
  useEffect(() => {
    if (amountManuallyEdited) return;
    const lf = parseFloat(lateFeeStr);
    if (isNaN(lf)) return;
    const next = computeNetReceiptDue({
      amountDue: amountDueDecimal,
      lateFee: lf,
      amountPaid: amountPaidDecimal,
      waiver: Math.max(parseFloat(waiverStr) || 0, 0),
      advanceBalance,
      consumeAdvance,
    });
    setAmountReceived(next.toFixed(2));
  }, [lateFeeStr, waiverStr, amountDueDecimal, amountPaidDecimal, amountManuallyEdited, consumeAdvance, advanceBalance]);

  // Method + evidence fields
  const [method, setMethod] = useState<WizardMethod>('CASH');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [slipUrl, setSlipUrl] = useState('');
  const [slipFileName, setSlipFileName] = useState('');
  const [memo, setMemo] = useState('');
  // วันที่รับเงิน (D4 backdating) — default = BKK today (YYYY-MM-DD). max = today.
  const bkkToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  const [paidDate, setPaidDate] = useState(() => bkkToday());

  // Slip upload
  const fileInputRef = useRef<HTMLInputElement>(null);
  const amountInputRef = useRef<HTMLInputElement>(null);
  const uploadMutation = useSlipUpload();

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setSlipFileName(file.name);
      try {
        const url = await uploadMutation.mutateAsync(file);
        setSlipUrl(url);
        toast.success('อัปโหลดสลิปสำเร็จ');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'อัปโหลดสลิปไม่สำเร็จ';
        toast.error(msg);
        setSlipFileName('');
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    [uploadMutation],
  );

  const handleClearSlip = () => {
    setSlipUrl('');
    setSlipFileName('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Net Exposure
  const netExposure = useMemo(
    () => amountDueDecimal.add(lateFeeDecimal).sub(amountPaidDecimal).toDecimalPlaces(2),
    [amountDueDecimal, lateFeeDecimal, amountPaidDecimal],
  );

  // Fetch CoA names
  const { data: coaData = [] } = useQuery<CoaRow[]>({
    queryKey: ['chart-of-accounts', 'cash-codes'],
    queryFn: async () => {
      const res = await api.get<CoaRow[]>(
        `/chart-of-accounts/by-codes?codes=${CASH_ACCOUNT_CODES.join(',')}`,
      );
      return res.data;
    },
    staleTime: Infinity,
  });
  const coaNames = useMemo(() => new Map(coaData.map((r) => [r.code, r.name])), [coaData]);

  // Method × account mapping (settings page → /settings/payment-methods).
  // Filters which cash account codes are valid for the picked method, and
  // identifies the default account to auto-select on method change.
  interface PaymentMethodConfig {
    id: string;
    method: WizardMethod;
    accountCode: string;
    isDefault: boolean;
    enabled: boolean;
  }
  const { data: methodConfigs = [] } = useQuery<PaymentMethodConfig[]>({
    queryKey: ['payment-method-configs'],
    queryFn: async () => (await api.get<PaymentMethodConfig[]>('/payment-method-configs')).data,
    staleTime: 60_000,
  });
  const accountsForMethod = useMemo(
    () =>
      methodConfigs.filter((c) => c.method === method && c.enabled).map((c) => c.accountCode),
    [methodConfigs, method],
  );
  const defaultAccountForMethod = useMemo(
    () => methodConfigs.find((c) => c.method === method && c.enabled && c.isDefault)?.accountCode,
    [methodConfigs, method],
  );

  // Auto-switch the cash account when the cashier changes method, OR when
  // the configs load late and the current selection turns out not to be
  // valid for the current method.
  useEffect(() => {
    if (methodConfigs.length === 0) return; // configs still loading
    const currentValid = accountsForMethod.includes(depositAccountCode);
    if (!currentValid && defaultAccountForMethod) {
      setDepositAccountCode(defaultAccountForMethod);
    }
  }, [methodConfigs, method, accountsForMethod, defaultAccountForMethod, depositAccountCode]);

  // Current effective late fee
  const currentLateFee = useMemo(() => {
    const v = parseFloat(lateFeeStr);
    return isNaN(v) ? new Decimal(0) : new Decimal(v);
  }, [lateFeeStr]);

  // P2 (D1) — waiver computed values (clamped ≤ gross late fee) + net late fee.
  const waiverDec = useMemo(() => {
    const w = parseFloat(waiverStr);
    if (isNaN(w) || w <= 0) return new Decimal(0);
    return Decimal.min(new Decimal(w), currentLateFee);
  }, [waiverStr, currentLateFee]);
  const netLateFee = useMemo(() => currentLateFee.minus(waiverDec), [currentLateFee, waiverDec]);

  // Phase 3 — approval matrix: which actions in THIS receipt need 4-eyes approval.
  // Today only the late-fee waiver is gated in-wizard (ปิดยอด/คืนเครื่อง route out;
  // กลับรายการ = Phase 4; ยอดเกินวงเงิน is gated server-side on the OVERPAY_ADVANCE ceiling).
  const approvalActions = useMemo(() => (waiverDec.gt(0) ? ['อนุโลม'] : []), [waiverDec]);
  const needsApproval = approvalActions.length > 0;

  // 4-eyes approver list — managers other than the current user (SoD).
  const { data: approverData = [] } = useQuery<ApproverRow[]>({
    queryKey: ['waiver-approvers'],
    queryFn: async () => {
      const { data } = await api.get('/users?limit=200');
      const list: ApproverRow[] = data?.data ?? data ?? [];
      return list;
    },
    staleTime: 60_000,
  });
  const approvers = useMemo(
    () =>
      approverData.filter(
        (u) =>
          WAIVER_APPROVER_ROLES.includes(u.role) &&
          u.id !== user?.id && // 4-eyes: approver ≠ recorder
          u.isActive !== false &&
          !u.deletedAt, // exclude inactive/soft-deleted (server rejects them anyway)
      ),
    [approverData, user?.id],
  );

  // Late-fee waiver reasons — server config (SystemConfig late_fee_waiver_reasons),
  // falling back to the built-in list so the dropdown always has options even when
  // the key is unset or the request fails.
  const { data: waiverReasons = WAIVER_REASONS } = useQuery<{ code: string; label: string }[]>({
    queryKey: ['waiver-reasons'],
    queryFn: async () => {
      const { data } = await api.get<{ code: string; label: string }[]>('/settings/waiver-reasons');
      return Array.isArray(data) && data.length > 0 ? data : WAIVER_REASONS;
    },
    staleTime: 5 * 60_000,
  });

  // Phase 4 — existing unposted draft for this installment (if any).
  const { data: existingDraft, isLoading: draftLoading } = useQuery<{ id: string; amount: string } | null>({
    queryKey: ['payment-draft', payment.id],
    queryFn: async () => {
      const { data } = await api.get(`/payments/draft/${payment.id}`);
      return data ?? null;
    },
    enabled: open,
    staleTime: 0,
  });
  const hasDraft = !!existingDraft;

  // Net to collect after the waiver + the (optional) advance deduction — drives tiles.
  const netDue = useMemo(
    () =>
      computeNetReceiptDue({
        amountDue: amountDueDecimal,
        lateFee: currentLateFee,
        amountPaid: amountPaidDecimal,
        waiver: waiverDec,
        advanceBalance,
        consumeAdvance,
      }),
    [amountDueDecimal, currentLateFee, waiverDec, amountPaidDecimal, consumeAdvance, advanceBalance],
  );
  // ปิดขึ้น = round the net up to a whole baht; the ≤1฿ residual rides the
  // existing 52-1104/53-1503 tolerance on the server.
  const netDueRoundedUp = useMemo(() => netDue.toDecimalPlaces(0, Decimal.ROUND_UP), [netDue]);

  // Auto-detect case
  const receivedNum = parseFloat(amountReceived) || 0;
  // Use NET late fee (gross − waiver) so detectCase classifies a correctly-entered
  // net payment as NORMAL (not UNDERPAY) when a waiver is active.
  const expectedTotal = useMemo(
    () => amountDueDecimal.plus(netLateFee),
    [amountDueDecimal, netLateFee],
  );
  const detectedCase = useMemo(
    () => detectCase(receivedNum, expectedTotal, advanceBalance, consumeAdvance),
    [receivedNum, expectedTotal, advanceBalance, consumeAdvance],
  );
  const amountDiff = useMemo(
    () => receivedNum - expectedTotal.toNumber(),
    [receivedNum, expectedTotal],
  );
  const apiCase = caseOverride ?? toApiCase(detectedCase);

  // JE Preview — debounced
  const previewParams = useMemo(
    () => ({
      contractId: payment.contract.id,
      installmentNo: payment.installmentNo,
      amountReceived: receivedNum,
      depositAccountCode,
      lateFee: currentLateFee.toNumber(),
      lateFeeWaived: waiverDec.toNumber(),
      case: apiCase,
      consumeAdvance,
    }),
    [receivedNum, depositAccountCode, currentLateFee, waiverDec, apiCase, payment, consumeAdvance],
  );
  const debouncedParams = useDebounce(previewParams, 300);

  // PARTIAL is now a valid case that can be submitted — treat same as other valid cases
  const isPreviewReady: boolean =
    detectedCase !== 'OUT_OF_RANGE' &&
    // Allow 0 cash when advance fully covers installment (detectCase = NORMAL)
    (debouncedParams.amountReceived > 0 || (detectedCase === 'NORMAL' && advanceBalance.gte(expectedTotal))) &&
    debouncedParams.depositAccountCode.length > 0;

  const { data: previewData, isFetching: previewLoading, error: previewError } = useQuery<JePreview, Error, JePreview>({
    queryKey: ['payment-preview', debouncedParams],
    queryFn: async () => {
      const { data } = await api.post<JePreview>('/payments/preview-journal', debouncedParams);
      return data;
    },
    enabled: isPreviewReady,
    retry: false,
    staleTime: 0,
  });

  const preview: JePreview | undefined = previewData;
  const previewErrorMessage = previewError ? getErrorMessage(previewError) : undefined;

  // QR mode: ref + slip auto-captured by webhook log, no manual input.
  // Submit becomes "ส่ง QR ให้ลูกค้า" instead of "บันทึกการชำระ".
  const isQrMode = method === 'QR';
  const requiresRef = method === 'TRANSFER';
  const requiresSlip = method === 'TRANSFER';

  const canSubmit = (): boolean => {
    // Allow zero-cash when advance fully covers the installment (detectCase returns NORMAL)
    if (receivedNum <= 0 && detectedCase !== 'NORMAL') return false;
    if (!depositAccountCode) return false;
    if (detectedCase === 'OUT_OF_RANGE') return false;
    if (requiresRef && !referenceNumber.trim()) return false;
    if (requiresSlip && !slipUrl) return false;
    // P2 (D1): a waiver requires a reason + a 4-eyes approver (≠ recorder).
    if (waiverDec.gt(0) && (!waiverReasonCode || !waiverApproverId)) return false;
    // QR mode skips the JE preview gate — the JE only posts when webhook
    // fires and recordPayment runs server-side, where the preview will be
    // recomputed against the actual paid amount.
    if (!isQrMode && !preview?.isBalanced) return false;
    return true;
  };

  const canSendQr = (): boolean => {
    if (receivedNum <= 0) return false;
    if (!depositAccountCode) return false;
    return true;
  };

  const buildPayload = (): WizardSubmitPayload => ({
    contractId: payment.contract.id,
    installmentNo: payment.installmentNo,
    amount: receivedNum,
    paymentMethod:
      method === 'TRANSFER'
        ? 'BANK_TRANSFER'
        : method === 'QR'
        ? 'QR_EWALLET'
        : method === 'CARD'
        ? 'CARD'
        : 'CASH',
    depositAccountCode,
    lateFee: currentLateFee.toNumber(),
    case: apiCase,
    wizardMethod: method,
    referenceNumber: referenceNumber || undefined,
    slipUrl: slipUrl || undefined,
    memo: memo || undefined,
    consumeAdvance,
    paidDate,
    lateFeeWaiverAmount: waiverDec.gt(0) ? waiverDec.toNumber() : undefined,
    lateFeeWaiverReasonCode: waiverDec.gt(0) ? waiverReasonCode : undefined,
    waiverApproverId: waiverDec.gt(0) ? waiverApproverId : undefined,
  });

  const actuallySubmit = () => {
    setShowPartialConfirm(false);
    onSubmit(buildPayload());
  };

  const handleSaveDraft = () => {
    onSaveDraft?.(buildPayload());
  };

  const handleSubmit = () => {
    if (detectedCase === 'PARTIAL') {
      setShowPartialConfirm(true);
      return;
    }
    actuallySubmit();
  };

  // QR mode: send PromptPay QR via PaySolutions + Flex push to customer's
  // LINE OA. Closes the dialog on success — webhook will record the payment
  // when the customer scans + pays.
  const sendQrMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<{
        partialPaymentLinkId: string;
        paymentUrl: string;
        orderRef: string;
        sentToLine: boolean;
      }>(`/payments/${payment.id}/partial-qr`, { amount: receivedNum });
      return data;
    },
    onSuccess: (data) => {
      if (data.sentToLine) {
        toast.success('ส่ง QR ให้ลูกค้าใน LINE แล้ว — จ่ายเสร็จระบบบันทึก auto');
      } else {
        toast.success('สร้าง QR แล้ว — ลูกค้ายังไม่ผูก LINE · ให้สแกนหน้าจอแทน');
      }
      onClose();
    },
    onError: (err: unknown) => {
      const msg =
        err instanceof Error ? err.message : 'ส่ง QR ไม่สำเร็จ — ลองอีกครั้ง';
      toast.error(msg);
    },
  });

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      onClose();
      setDepositAccountCode(defaultDepositAccountCode);
      setAmountReceived(defaultAmount.toFixed(2));
      setAmountManuallyEdited(false);
      setConsumeAdvance(true);
      setCaseOverride(null);
      setShowPayoffOverlay(false);
      setShowRescheduleOverlay(false);
      setShowRepoOverlay(false);
      setWaiverStr('0');
      setWaiverReasonCode('');
      setWaiverApproverId('');
      setPaidDate(bkkToday());
      setLateFeeStr(lateFeeDecimal.toFixed(2));
      setMethod('CASH');
      setReferenceNumber('');
      setSlipUrl('');
      setSlipFileName('');
      setMemo('');
    }
  };

  const hasAmount = receivedNum > 0;

  return (
    <>
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="w-full max-w-5xl max-h-[92vh] flex flex-col p-0 gap-0"
        // The payoff/reschedule/repossession overlays portal to document.body (outside
        // this Dialog), so clicking them (incl. their ยกเลิก) reads as an "interact
        // outside" and would close the wizard underneath. While an overlay is open,
        // keep the wizard mounted so cancelling the overlay returns to รับชำระ.
        onPointerDownOutside={(e) => {
          if (showPayoffOverlay || showRescheduleOverlay || showRepoOverlay) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (showPayoffOverlay || showRescheduleOverlay || showRepoOverlay) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (showPayoffOverlay || showRescheduleOverlay || showRepoOverlay) e.preventDefault();
        }}
      >
        {/* Header */}
        <DialogHeader className="px-6 pt-4 pb-2.5 shrink-0 border-b border-border">
          <DialogTitle className="text-base font-semibold leading-snug">
            บันทึกชำระ — {payment.contract.contractNumber} / {payment.contract.customer.name} — งวดที่{' '}
            {payment.installmentNo}
          </DialogTitle>
        </DialogHeader>

        {/* Body */}
        <DialogBody className="flex-1 overflow-y-auto px-6 py-3">
          {/* 2-column (mockup): form LEFT, contract info + JE preview RIGHT.
              Form is FIRST in DOM so keyboard/tab order follows the visual flow
              (data-entry first); the info+preview column comes after. */}
          <div className="grid grid-cols-[1fr_340px] gap-4 items-start">
            {/* LEFT column — Form. */}
            <div className="space-y-3 min-w-0">
              {/* Phase 4 — existing draft banner (DRAFT state): post or discard */}
              {hasDraft && (
                <div className="rounded-lg border border-info/40 bg-info/5 p-3 space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground leading-snug">
                    <Info className="size-4 text-info shrink-0" />
                    <span>
                      มีฉบับร่างอยู่ — ยอด{' '}
                      {formatNumberDecimal(String(existingDraft?.amount ?? '0'))} ฿ (ยังไม่ลงบัญชี)
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => onPostDraft?.(payment.id)}
                      disabled={isSubmitting}
                      className="flex-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                    >
                      ลงบัญชี (โพสต์ JE)
                    </button>
                    <button
                      type="button"
                      onClick={() => onCancelDraft?.(payment.id)}
                      disabled={isSubmitting}
                      className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50 transition-colors"
                    >
                      ยกเลิกร่าง
                    </button>
                  </div>
                </div>
              )}
              {/* Advance balance banner — shown when contract has advance to consume */}
              {advanceBalance.gt(0) && (
                <AdvanceBalanceBanner
                  amountDue={amountDueDecimal.add(currentLateFee).sub(amountPaidDecimal)}
                  advanceBalance={advanceBalance}
                  consumeAdvance={consumeAdvance}
                  onToggle={(next) => {
                    setConsumeAdvance(next);
                    // recompute amountReceived via the auto-sync effect
                    setAmountManuallyEdited(false);
                  }}
                />
              )}

              {/* Payment-type selector */}
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-2 leading-snug">
                  ประเภทการรับชำระ
                </h3>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    // The 3 case buttons reflect the EFFECTIVE case (override OR auto-detected),
                    // so "ปกติ" doesn't stay highlighted when the typed amount is partial/advance.
                    { key: 'NORMAL', label: 'ปกติ', toggle: true, onClick: () => setCaseOverride(null), active: apiCase !== 'PARTIAL' && apiCase !== 'OVERPAY_ADVANCE' },
                    { key: 'PARTIAL', label: 'แบ่งชำระ', toggle: true, onClick: () => setCaseOverride('PARTIAL'), active: apiCase === 'PARTIAL' },
                    { key: 'OVERPAY_ADVANCE', label: 'ล่วงหน้า', toggle: true, onClick: () => setCaseOverride('OVERPAY_ADVANCE'), active: apiCase === 'OVERPAY_ADVANCE' },
                    { key: 'PAYOFF', label: 'ปิดยอด', toggle: false, onClick: () => setShowPayoffOverlay(true), active: false },
                    { key: 'RESCHEDULE', label: 'ปรับดิว', toggle: false, onClick: () => setShowRescheduleOverlay(true), active: false },
                    { key: 'REPO', label: 'คืนเครื่อง', toggle: false, onClick: () => setShowRepoOverlay(true), active: false },
                  ].map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      aria-pressed={t.toggle ? t.active : undefined}
                      onClick={t.onClick}
                      className={cn(
                        'rounded-xl border-2 px-2 py-1.5 text-sm font-medium leading-snug transition-colors',
                        t.active
                          ? 'bg-primary border-primary text-primary-foreground'
                          : 'bg-card border-border text-foreground hover:border-primary/40 hover:bg-accent',
                      )}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Amount received */}
              <div>
                <Label className="block text-sm font-medium text-foreground mb-1.5 leading-snug">
                  ยอดรับจริง (฿) <span className="text-destructive">*</span>
                </Label>
                {/* Quick-amount tiles */}
                <div className="grid grid-cols-3 gap-2 mb-2">
                  {[
                    { key: 'full', label: 'เต็มงวด', value: netDue.toFixed(2), apply: () => netDue.toFixed(2) },
                    { key: 'roundup', label: 'ปิดขึ้น', value: netDueRoundedUp.toFixed(0), apply: () => netDueRoundedUp.toFixed(2) },
                    { key: 'custom', label: 'กำหนดเอง', value: 'ระบุจำนวน', apply: null },
                  ].map((tile) => {
                    const active =
                      tile.apply != null && new Decimal(amountReceived || 0).eq(new Decimal(tile.apply()));
                    return (
                      <button
                        key={tile.key}
                        type="button"
                        onClick={() => {
                          if (tile.apply) {
                            setAmountReceived(tile.apply());
                            setAmountManuallyEdited(true);
                          } else {
                            setAmountManuallyEdited(true);
                            amountInputRef.current?.focus();
                          }
                        }}
                        className={cn(
                          'rounded-xl border-2 px-2 py-1.5 text-center transition-colors',
                          active
                            ? 'bg-primary border-primary text-primary-foreground'
                            : 'bg-card border-border text-foreground hover:border-primary/40 hover:bg-accent',
                        )}
                      >
                        <div className="text-xs font-semibold leading-snug">{tile.label}</div>
                        <div
                          className={cn(
                            'text-xs font-mono leading-snug',
                            active ? 'text-primary-foreground/80' : 'text-muted-foreground',
                          )}
                        >
                          {tile.value}
                        </div>
                      </button>
                    );
                  })}
                </div>
                <Input
                  ref={amountInputRef}
                  type="number"
                  value={amountReceived}
                  onChange={(e) => { setAmountReceived(e.target.value); setAmountManuallyEdited(true); }}
                  min={0}
                  step="0.01"
                  className="text-right font-mono"
                />
                {hasAmount && (
                  <div className="mt-2">
                    <CaseBadge detectedCase={detectedCase} diff={amountDiff} />
                  </div>
                )}
              </div>

              {/* Late fee */}
              <div>
                <Label className="block text-sm font-medium text-foreground mb-1.5 leading-snug">
                  ค่าปรับ (฿)
                  <span className="ml-1 text-xs text-muted-foreground font-normal">(ระบุ 0 ถ้าไม่มี)</span>
                </Label>
                <Input
                  type="number"
                  value={lateFeeStr}
                  onChange={(e) => setLateFeeStr(e.target.value)}
                  min={0}
                  step="0.01"
                  className="text-right font-mono"
                />
              </div>

              {/* P2 (D1) — อนุโลมค่าปรับ (gross model: Dr 52-1105 / Cr 42-1103 gross) */}
              {currentLateFee.gt(0) && (
                <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-foreground leading-snug">อนุโลมค่าปรับ</h3>
                    <span className="text-xs text-muted-foreground leading-snug">
                      ค่าปรับเต็ม {currentLateFee.toFixed(2)} ฿
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { key: '50', label: '50%', apply: () => currentLateFee.div(2).toDecimalPlaces(2).toFixed(2) },
                      { key: 'full', label: 'เต็ม', apply: () => currentLateFee.toFixed(2) },
                      { key: 'custom', label: 'กำหนดเอง', apply: null as null | (() => string) },
                    ].map((b) => {
                      const active = b.apply != null && waiverDec.eq(new Decimal(b.apply()));
                      return (
                        <button
                          key={b.key}
                          type="button"
                          aria-pressed={b.apply != null ? active : undefined}
                          onClick={() => {
                            setWaiverStr(b.apply ? b.apply() : '0');
                            setAmountManuallyEdited(false);
                          }}
                          className={cn(
                            'rounded-xl border-2 px-2 py-1.5 text-sm font-medium leading-snug transition-colors',
                            active
                              ? 'bg-primary border-primary text-primary-foreground'
                              : 'bg-card border-border text-foreground hover:border-primary/40 hover:bg-accent',
                          )}
                        >
                          {b.label}
                        </button>
                      );
                    })}
                  </div>
                  <Input
                    type="number"
                    value={waiverStr}
                    min={0}
                    max={currentLateFee.toNumber()}
                    step="0.01"
                    onChange={(e) => { setWaiverStr(e.target.value); setAmountManuallyEdited(false); }}
                    className="text-right font-mono"
                    aria-label="ยอดอนุโลมค่าปรับ"
                  />
                  {waiverDec.gt(0) && (
                    <div>
                      <Label className="block text-xs font-medium text-foreground mb-1 leading-snug">
                        เหตุผลการอนุโลม <span className="text-destructive">*</span>
                      </Label>
                      <select
                        value={waiverReasonCode}
                        onChange={(e) => setWaiverReasonCode(e.target.value)}
                        className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground leading-snug"
                        aria-label="เหตุผลการอนุโลม"
                      >
                        <option value="">— เลือกเหตุผล —</option>
                        {waiverReasons.map((r) => (
                          <option key={r.code} value={r.code}>{r.label}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-xs font-medium pt-1 border-t border-border/50">
                    <span className="text-muted-foreground leading-snug">
                      ค่าปรับ {currentLateFee.toFixed(2)} − อนุโลม {waiverDec.toFixed(2)} =
                    </span>
                    <span className="text-foreground font-mono leading-snug">{netLateFee.toFixed(2)} ฿</span>
                  </div>
                </div>
              )}

              {/* วันที่รับเงิน (D4 backdating — period-lock guards closed periods) */}
              <div>
                <Label className="block text-sm font-medium text-foreground mb-1.5 leading-snug">
                  วันที่รับเงิน
                  <span className="ml-1 text-xs text-muted-foreground font-normal">(ย้อนหลังได้ถ้างวดบัญชียังเปิด)</span>
                </Label>
                <Input
                  type="date"
                  value={paidDate}
                  max={bkkToday()}
                  onChange={(e) => setPaidDate(e.target.value)}
                  className="font-mono"
                />
              </div>

              {/* Method selector — comes first so the cash account list can
                  filter to compatible accounts (set in /settings/payment-methods). */}
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-2 leading-snug">
                  ช่องทางรับชำระ <span className="text-destructive">*</span>
                </h3>
                <div className="grid grid-cols-3 gap-2">
                  {METHOD_OPTIONS.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setMethod(m.id)}
                      className={cn(
                        'flex items-center gap-2 rounded-xl border-2 px-2.5 py-2 text-left text-sm transition-colors',
                        method === m.id
                          ? 'bg-primary border-primary text-primary-foreground'
                          : 'bg-card border-border text-foreground hover:border-primary/40 hover:bg-accent',
                      )}
                    >
                      <span
                        className={cn(
                          'shrink-0',
                          method === m.id ? 'text-primary-foreground' : 'text-muted-foreground',
                        )}
                      >
                        {m.icon}
                      </span>
                      <div className="min-w-0">
                        <div className="font-semibold leading-snug">{m.label}</div>
                        <div
                          className={cn(
                            'text-xs leading-snug',
                            method === m.id ? 'text-primary-foreground/80' : 'text-muted-foreground',
                          )}
                        >
                          {m.desc}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Cash account selector — filtered by method ↦ account mapping
                  configured in /settings/payment-methods. Out-of-mapping codes
                  appear disabled so cashier sees the constraint visually. */}
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-2 leading-snug flex items-center gap-2">
                  <span>บัญชีรับเงิน <span className="text-destructive">*</span></span>
                  {accountsForMethod.length > 0 && (
                    <span className="text-xs text-muted-foreground font-normal">
                      เฉพาะที่ผูกกับ "{METHOD_OPTIONS.find((o) => o.id === method)?.label}"
                    </span>
                  )}
                </h3>
                <div className="grid grid-cols-3 gap-2">
                  {CASH_ACCOUNT_CODES.map((code) => {
                    const name = coaNames.get(code) ?? '';
                    const isBank = code.startsWith('11-12');
                    const allowed =
                      accountsForMethod.length === 0 || accountsForMethod.includes(code);
                    return (
                      <button
                        key={code}
                        type="button"
                        onClick={() => allowed && setDepositAccountCode(code)}
                        disabled={!allowed}
                        className={cn(
                          'flex flex-col items-start rounded-xl border-2 px-2.5 py-2 text-left text-sm transition-colors',
                          depositAccountCode === code
                            ? 'bg-primary border-primary text-primary-foreground'
                            : 'bg-card border-border text-foreground hover:border-primary/40 hover:bg-accent',
                          !allowed && 'opacity-30 pointer-events-none',
                        )}
                      >
                        <span className="font-mono text-xs leading-snug opacity-75">{code}</span>
                        <span className="font-medium leading-snug text-xs mt-0.5 line-clamp-2">
                          {name || (isBank ? 'ธนาคาร' : 'เงินสด')}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* QR mode info pane — replaces ref + slip inputs (webhook log
                  is the audit trail, no manual evidence needed). */}
              {isQrMode && (
                <div className="rounded-lg border border-info/30 bg-info/5 px-3 py-3 flex items-start gap-2.5">
                  <Info className="size-4 text-info shrink-0 mt-0.5" />
                  <div className="text-xs text-foreground leading-relaxed">
                    <strong className="block mb-1">ระบบจะส่ง QR ให้ลูกค้าทาง LINE OA</strong>
                    <span className="text-muted-foreground">
                      เลขอ้างอิง + หลักฐานบันทึกอัตโนมัติจาก PaySolutions webhook · QR หมดอายุ 24 ชม. · ลูกค้าจ่ายเสร็จระบบบันทึก payment ให้ทันที
                    </span>
                  </div>
                </div>
              )}

              {/* Reference number — TRANSFER only */}
              {requiresRef && (
                <div>
                  <Label className="block text-sm font-medium text-foreground mb-1.5 leading-snug">
                    เลขอ้างอิงธุรกรรม <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    value={referenceNumber}
                    onChange={(e) => setReferenceNumber(e.target.value)}
                    placeholder="ระบุเลขอ้างอิง / เลขธุรกรรม"
                    maxLength={255}
                  />
                </div>
              )}

              {/* Slip upload — TRANSFER only (QR webhook captures evidence) */}
              {!isQrMode && (
              <div>
                <Label className="block text-sm font-medium text-foreground mb-1.5 leading-snug">
                  สลิป / หลักฐาน
                  {requiresSlip ? (
                    <span className="text-destructive"> *</span>
                  ) : (
                    <span className="ml-1 text-xs text-muted-foreground font-normal">(ไม่บังคับ)</span>
                  )}
                </Label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={SLIP_MIME_TYPES.join(',')}
                  className="hidden"
                  aria-label="อัปโหลดสลิป"
                  onChange={handleFileChange}
                />
                {slipUrl ? (
                  <div className="flex items-center gap-2 rounded-lg border border-success/40 bg-success/5 px-3 py-2.5">
                    <CheckCircle2 className="size-4 text-success shrink-0" />
                    <span className="text-sm text-foreground leading-snug truncate flex-1">
                      {slipFileName || 'สลิปอัปโหลดแล้ว'}
                    </span>
                    <button
                      type="button"
                      onClick={handleClearSlip}
                      className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      aria-label="ลบสลิป"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadMutation.isPending}
                    className={cn(
                      'flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-3 text-sm transition-colors',
                      'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground hover:bg-accent',
                      uploadMutation.isPending && 'opacity-60 pointer-events-none',
                    )}
                  >
                    {uploadMutation.isPending ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        <span className="leading-snug">กำลังอัปโหลด...</span>
                      </>
                    ) : (
                      <>
                        <Upload className="size-4" />
                        <span className="leading-snug">คลิกเพื่ออัปโหลดสลิป (JPG/PNG/PDF)</span>
                      </>
                    )}
                  </button>
                )}
              </div>
              )}

              {/* Memo — disclosure-style: smaller label + compact textarea */}
              <details className="group">
                <summary className="cursor-pointer list-none flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors select-none">
                  <span className="leading-snug">หมายเหตุ (ไม่บังคับ)</span>
                  <span className="text-[10px] group-open:hidden">+ เพิ่ม</span>
                </summary>
                <div className="mt-2">
                  <Textarea
                    value={memo}
                    onChange={(e) => setMemo(e.target.value)}
                    placeholder="หมายเหตุเพิ่มเติม..."
                    rows={2}
                    maxLength={1000}
                    className="resize-none text-sm"
                  />
                </div>
              </details>

              {/* Phase 3 — ควบคุมภายใน / approval matrix */}
              <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Lock className="size-3.5 text-muted-foreground" />
                  <h3 className="text-sm font-semibold text-foreground leading-snug">ควบคุมภายใน</h3>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-muted-foreground leading-snug">ผู้บันทึก</span>
                    <div className="font-medium text-foreground leading-snug">{user?.name ?? '—'}</div>
                  </div>
                  <div>
                    <label htmlFor="waiver-approver" className="text-muted-foreground leading-snug">
                      ผู้อนุมัติ {needsApproval && <span className="text-destructive">*</span>}
                    </label>
                    <select
                      id="waiver-approver"
                      value={waiverApproverId}
                      onChange={(e) => setWaiverApproverId(e.target.value)}
                      disabled={!needsApproval}
                      className="w-full rounded-lg border border-border bg-background px-2 py-1 text-sm text-foreground leading-snug disabled:opacity-50"
                    >
                      <option value="">— เลือกผู้อนุมัติ —</option>
                      {approvers.map((a) => (
                        <option key={a.id} value={a.id}>{a.name} ({a.role})</option>
                      ))}
                    </select>
                    {needsApproval && approvers.length === 0 && (
                      <p className="text-[11px] text-destructive leading-snug mt-1">
                        ไม่มีผู้อนุมัติที่ใช้ได้ (ต้องมี OWNER/FM/BM คนอื่น)
                      </p>
                    )}
                  </div>
                </div>
                {needsApproval && (
                  <div className="flex items-center gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2 py-1 text-xs text-warning leading-snug">
                    <AlertCircle className="size-3.5 shrink-0" />
                    <span>ต้องอนุมัติ ({approvalActions.join(' · ')})</span>
                  </div>
                )}
                <div className="text-[10px] text-muted-foreground leading-snug">
                  Approval Matrix: อนุโลม · ปิดยอด · คืนเครื่อง · กลับรายการ · ยอดเกินวงเงิน
                </div>
              </div>
            </div>

            {/* RIGHT column — contract info + auto-journal preview. */}
            <div className="space-y-3 min-w-0">
              <ContractInfoPanel
                payment={payment}
                lateFee={currentLateFee}
                netExposure={netExposure}
                onOpenPayoff={() => setShowPayoffOverlay(true)}
              />
              <JePreviewPanel
                preview={preview}
                isLoading={previewLoading}
                errorMessage={previewErrorMessage}
              />
            </div>
          </div>
        </DialogBody>

        {/* Footer — single submit · QR mode swaps "บันทึกชำระ" for "ส่ง QR" */}
        <DialogFooter className="px-6 py-3 border-t border-border shrink-0 flex items-center justify-between">
          <Button variant="outline" onClick={onClose} disabled={isSubmitting || sendQrMutation.isPending}>
            {isQrMode ? 'ปิด' : 'ยกเลิก'}
          </Button>
          {isQrMode ? (
            <Button
              onClick={() => sendQrMutation.mutate()}
              disabled={sendQrMutation.isPending || !canSendQr()}
              className="gap-2"
            >
              {sendQrMutation.isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  กำลังส่ง...
                </>
              ) : (
                <>
                  <QrCode className="size-4" />
                  ส่ง QR ให้ลูกค้าสแกนจ่าย ฿{receivedNum.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                </>
              )}
            </Button>
          ) : (
            <div className="flex gap-2">
              {/* Hide the draft button until the draft query resolves — avoids a
                  flash of "บันทึก (Draft)" before an existing draft loads (which
                  would otherwise swap to the draft banner). */}
              {onSaveDraft && !hasDraft && !draftLoading && (
                <Button
                  variant="outline"
                  onClick={handleSaveDraft}
                  disabled={
                    isSubmitting ||
                    receivedNum <= 0 ||
                    !depositAccountCode ||
                    detectedCase === 'OUT_OF_RANGE'
                  }
                  title="เก็บเป็นฉบับร่าง — ยังไม่ลงบัญชี"
                >
                  บันทึก (Draft)
                </Button>
              )}
              <Button
                onClick={handleSubmit}
                disabled={isSubmitting || previewLoading || !canSubmit()}
                title={
                  detectedCase === 'OUT_OF_RANGE'
                    ? 'ห่างเกิน 1 ฿ — ใช้เมนูแบ่งชำระหรือปิดยอดแทน'
                    : !preview?.isBalanced && isPreviewReady
                    ? 'รายการบัญชีไม่สมดุล'
                    : undefined
                }
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin mr-2" />
                    กำลังบันทึก...
                  </>
                ) : (
                  'บันทึก + ลงบัญชี'
                )}
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>

      {/* Partial payment confirmation gate */}
      <ConfirmDialog
        open={showPartialConfirm}
        onOpenChange={setShowPartialConfirm}
        title="ยืนยันบันทึกบางส่วน"
        description={`ค่างวด ${expectedTotal.toFixed(2)} ฿ • ลูกค้าจ่าย ${(receivedNum).toFixed(2)} ฿ • ค้าง ${Math.abs(amountDiff).toFixed(2)} ฿. ลูกค้าจะค้างยอดนี้จนกว่าจะจ่ายเพิ่ม.`}
        confirmLabel="ยืนยันบันทึก"
        cancelLabel="ยกเลิก"
        onConfirm={actuallySubmit}
      />

    </Dialog>

      {/* Early-payoff overlay — rendered via createPortal to document.body to escape Radix Dialog's portal context (otherwise the overlay's fixed-positioned div is trapped inside wizard's portal and invisible). */}
      {showPayoffOverlay && createPortal(
        <EarlyPayoffOverlay
          contractId={payment.contract.id}
          contractNumber={payment.contract.contractNumber}
          customerName={payment.contract.customer.name}
          branchName={payment.contract.branch.name}
          onClose={() => setShowPayoffOverlay(false)}
          onSuccess={() => {
            setShowPayoffOverlay(false);
            onClose(); // close wizard after successful payoff
          }}
        />,
        document.body,
      )}

      {/* Reschedule overlay (ปรับดิว) — self-portals to document.body. Collect-first
          (2026-07-02): the overlay collects ค่าธรรมเนียม (6a) + ค่าปรับ BEFORE the
          due-date shift; the collect JE posts atomically at confirm (QR → on webhook). */}
      {showRescheduleOverlay && (
        <RescheduleOverlay
          contractId={payment.contract.id}
          contractNumber={payment.contract.contractNumber}
          customerName={payment.contract.customer.name}
          branchName={payment.contract.branch.name}
          paymentId={payment.id}
          installmentNo={payment.installmentNo}
          currentDueDate={payment.dueDate}
          monthlyPayment={payment.contract.monthlyPayment}
          defaultDepositAccountCode={depositAccountCode}
          onClose={() => setShowRescheduleOverlay(false)}
          onSuccess={() => {
            setShowRescheduleOverlay(false);
            onClose(); // close wizard after successful reschedule
          }}
        />
      )}

      {/* Repossession overlay (คืนเครื่อง) — self-portals; full create (OWNER-only submit). */}
      {showRepoOverlay && (
        <RepossessionOverlay
          contractId={payment.contract.id}
          contractNumber={payment.contract.contractNumber}
          customerName={payment.contract.customer.name}
          branchName={payment.contract.branch.name}
          onClose={() => setShowRepoOverlay(false)}
          onSuccess={() => {
            setShowRepoOverlay(false);
            onClose(); // close wizard after successful repossession
          }}
        />
      )}
    </>
  );
}
