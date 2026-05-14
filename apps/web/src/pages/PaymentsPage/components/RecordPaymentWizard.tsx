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
import { formatNumberDecimal } from '@/utils/formatters';
import { AccrualModeChip } from './AccrualModeChip';
import { CASH_ACCOUNT_CODES } from '@/components/CashAccountSelect';
import { formatThaiDate } from '@/lib/date';
import { useDebounce } from '@/hooks/useDebounce';
import { toast } from 'sonner';
import type { PendingPayment } from '../types';
import { AdvanceBalanceBanner } from './AdvanceBalanceBanner';
import { EarlyPayoffOverlay } from '@/components/contract/ContractEarlyPayoff';

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Auto-detected payment case (computed from amount diff client-side).
 * RESCHEDULE / EARLY_PAYOFF are handled in separate contract-detail pages, not here.
 */
type DetectedCase = 'NORMAL' | 'OVERPAY' | 'UNDERPAY' | 'OVERPAY_ADVANCE' | 'PARTIAL' | 'OUT_OF_RANGE';

/** Legacy type kept for API compatibility — backend accepts all 7 values */
type PaymentCase = 'NORMAL' | 'OVERPAY' | 'UNDERPAY' | 'PARTIAL' | 'EARLY_PAYOFF' | 'RESCHEDULE' | 'OVERPAY_ADVANCE';

type WizardMethod = 'CASH' | 'TRANSFER' | 'QR';

interface JePreviewLine {
  accountCode: string;
  accountName: string;
  debit: string;
  credit: string;
  description: string;
}

interface JePreview {
  lines: JePreviewLine[];
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
    <div className="flex justify-between text-sm py-1 border-b border-border/50 last:border-0">
      <span className="text-muted-foreground leading-snug">{label}</span>
      <span className={cn('font-medium leading-snug', red && 'text-destructive')}>{value}</span>
    </div>
  );

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-1 min-w-0 h-fit">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
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
        className="mt-3 w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-semibold rounded-lg bg-warning/10 text-warning border border-warning/30 hover:bg-warning/20 transition-colors"
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
];

// ─── JE Preview panel (always visible) ────────────────────────────────────────

function JePreviewPanel({
  preview,
  isLoading,
  errorMessage,
}: {
  preview: JePreview | undefined;
  isLoading: boolean;
  errorMessage?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground leading-snug">
          JOURNAL AUTO — บันทึกทางบัญชี
        </h3>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium leading-snug">
          <CheckCircle2 className="size-3" />
          AUTO
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
        <>
          <div className="space-y-1">
            <div className="grid grid-cols-[80px_1fr_80px_80px] gap-1 text-xs text-muted-foreground font-medium pb-1 border-b border-border">
              <span className="leading-snug">รหัส</span>
              <span className="leading-snug">บัญชี</span>
              <span className="text-right leading-snug">Dr</span>
              <span className="text-right leading-snug">Cr</span>
            </div>
            {preview.lines.map((line, idx) => (
              <div key={idx} className="grid grid-cols-[80px_1fr_80px_80px] gap-1 text-xs">
                <span className="font-mono text-muted-foreground leading-snug">{line.accountCode}</span>
                <div className="min-w-0">
                  <span className="leading-snug text-foreground truncate block">{line.accountName}</span>
                  <span className="leading-snug text-muted-foreground/70 text-[10px]">
                    {line.description}
                  </span>
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

          <div
            className={cn(
              'flex items-center justify-between mt-3 pt-2 border-t text-xs font-medium',
              preview.isBalanced
                ? 'border-success/30 text-success'
                : 'border-destructive/30 text-destructive',
            )}
          >
            <div className="flex items-center gap-1 leading-snug">
              {preview.isBalanced ? (
                <CheckCircle2 className="size-3.5" />
              ) : (
                <AlertCircle className="size-3.5" />
              )}
              <span>Dr รวม = Cr รวม</span>
            </div>
            <span className="font-mono leading-snug">
              {formatNumberDecimal(preview.totalDebit)} ={' '}
              {formatNumberDecimal(preview.totalCredit)}{' '}
              {preview.isBalanced ? 'BALANCED' : 'UNBALANCED'}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Auto-detect case from amount diff ───────────────────────────────────────

function detectCase(
  received: number,
  expectedTotal: Decimal,
  advanceBalance: Decimal = new Decimal(0),
): DetectedCase {
  // Effective amount due = installment minus existing advance (FIFO consume).
  // Cashier collects this — system splits internally on save.
  const effectiveDue = Decimal.max(new Decimal(0), expectedTotal.minus(advanceBalance));

  if (received <= 0) {
    // Zero cash is OK iff advance fully covers the installment
    return advanceBalance.gte(expectedTotal) ? 'NORMAL' : 'OUT_OF_RANGE';
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

interface RecordPaymentWizardProps {
  open: boolean;
  payment: PendingPayment;
  onClose: () => void;
  onSubmit: (payload: {
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
  }) => void;
  isSubmitting: boolean;
  defaultDepositAccountCode?: string;
}

export function RecordPaymentWizard({
  open,
  payment,
  onClose,
  onSubmit,
  isSubmitting,
  defaultDepositAccountCode = '11-1101',
}: RecordPaymentWizardProps) {
  const [depositAccountCode, setDepositAccountCode] = useState(defaultDepositAccountCode);
  const [showPartialConfirm, setShowPartialConfirm] = useState(false);
  const [showPayoffOverlay, setShowPayoffOverlay] = useState(false);

  // Amount fields
  const lateFeeDecimal = useMemo(() => new Decimal(payment.lateFee), [payment.lateFee]);
  const amountDueDecimal = useMemo(() => new Decimal(payment.amountDue), [payment.amountDue]);
  const amountPaidDecimal = useMemo(() => new Decimal(payment.amountPaid), [payment.amountPaid]);
  // Pre-fill amount = amountDue only (no auto-add lateFee). User explicitly enters
  // lateFee in the dedicated field if applicable, then can manually update amount.
  // This avoids the "ห่างเกิน 1฿" warning on first render when payment.lateFee was
  // server-computed but lateFee input shows 0.00.
  const defaultAmount = amountDueDecimal.sub(amountPaidDecimal).toDecimalPlaces(2);

  const [amountReceived, setAmountReceived] = useState(defaultAmount.toFixed(2));
  const [amountManuallyEdited, setAmountManuallyEdited] = useState(false);
  // I4 fix: pre-fill lateFee from the server-computed payment.lateFee instead
  // of hard-coding '0.00'. Previously the cashier had to retype the displayed
  // late-fee figure from the contract info panel — error-prone and slow.
  const [lateFeeStr, setLateFeeStr] = useState(lateFeeDecimal.toFixed(2));

  // Auto-sync amountReceived = amountDue + lateFee while user hasn't touched
  // the amount field. Once user edits amount manually, stop auto-syncing so
  // their edit isn't clobbered.
  useEffect(() => {
    if (amountManuallyEdited) return;
    const lf = parseFloat(lateFeeStr);
    if (isNaN(lf)) return;
    const next = amountDueDecimal.plus(lf).sub(amountPaidDecimal).toDecimalPlaces(2);
    setAmountReceived(next.toFixed(2));
  }, [lateFeeStr, amountDueDecimal, amountPaidDecimal, amountManuallyEdited]);

  // Method + evidence fields
  const [method, setMethod] = useState<WizardMethod>('CASH');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [slipUrl, setSlipUrl] = useState('');
  const [slipFileName, setSlipFileName] = useState('');
  const [memo, setMemo] = useState('');

  // Slip upload
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  // Advance balance from contract (Decimal, serialized as string from Prisma)
  const advanceBalance = useMemo(
    () => new Decimal(payment.contract.advanceBalance ?? 0),
    [payment.contract.advanceBalance],
  );

  // Auto-detect case
  const receivedNum = parseFloat(amountReceived) || 0;
  const expectedTotal = useMemo(
    () => amountDueDecimal.plus(currentLateFee),
    [amountDueDecimal, currentLateFee],
  );
  const detectedCase = useMemo(
    () => detectCase(receivedNum, expectedTotal, advanceBalance),
    [receivedNum, expectedTotal, advanceBalance],
  );
  const amountDiff = useMemo(
    () => receivedNum - expectedTotal.toNumber(),
    [receivedNum, expectedTotal],
  );
  const apiCase = toApiCase(detectedCase);

  // JE Preview — debounced
  const previewParams = useMemo(
    () => ({
      contractId: payment.contract.id,
      installmentNo: payment.installmentNo,
      amountReceived: receivedNum,
      depositAccountCode,
      lateFee: currentLateFee.toNumber(),
      case: apiCase,
    }),
    [receivedNum, depositAccountCode, currentLateFee, apiCase, payment],
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

  const actuallySubmit = () => {
    setShowPartialConfirm(false);
    onSubmit({
      contractId: payment.contract.id,
      installmentNo: payment.installmentNo,
      amount: receivedNum,
      paymentMethod:
        method === 'TRANSFER'
          ? 'BANK_TRANSFER'
          : method === 'QR'
          ? 'QR_EWALLET'
          : 'CASH',
      depositAccountCode,
      lateFee: currentLateFee.toNumber(),
      case: apiCase,
      wizardMethod: method,
      referenceNumber: referenceNumber || undefined,
      slipUrl: slipUrl || undefined,
      memo: memo || undefined,
    });
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
      <DialogContent className="w-full max-w-5xl max-h-[92vh] flex flex-col p-0 gap-0">
        {/* Header */}
        <DialogHeader className="px-6 pt-5 pb-3 shrink-0 border-b border-border">
          <DialogTitle className="text-base font-semibold leading-snug">
            บันทึกชำระ — {payment.contract.contractNumber} / {payment.contract.customer.name} — งวดที่{' '}
            {payment.installmentNo}
          </DialogTitle>
        </DialogHeader>

        {/* Body */}
        <DialogBody className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* 2-column: info LEFT, form RIGHT */}
          <div className="grid grid-cols-[260px_1fr] gap-4 items-start">
            {/* LEFT: Contract info */}
            <ContractInfoPanel
              payment={payment}
              lateFee={currentLateFee}
              netExposure={netExposure}
              onOpenPayoff={() => setShowPayoffOverlay(true)}
            />

            {/* RIGHT: Form */}
            <div className="space-y-5 min-w-0">
              {/* Advance balance banner — shown when contract has advance to consume */}
              {advanceBalance.gt(0) && (
                <AdvanceBalanceBanner
                  amountDue={amountDueDecimal.add(currentLateFee).sub(amountPaidDecimal)}
                  advanceBalance={advanceBalance}
                  onApply={(netDue) => {
                    setAmountReceived(netDue);
                    setAmountManuallyEdited(true);
                  }}
                />
              )}

              {/* Amount received */}
              <div>
                <Label className="block text-sm font-medium text-foreground mb-1.5 leading-snug">
                  ยอดรับจริง (฿) <span className="text-destructive">*</span>
                </Label>
                <Input
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
                        'flex items-center gap-2.5 rounded-xl border-2 px-3 py-3 text-left text-sm transition-colors',
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
                          'flex flex-col items-start rounded-xl border-2 px-3 py-2.5 text-left text-sm transition-colors',
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
                <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 px-3 py-3 flex items-start gap-2.5">
                  <Info className="size-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
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
            </div>
          </div>

          {/* JE Preview — always visible */}
          <JePreviewPanel preview={preview} isLoading={previewLoading} errorMessage={previewErrorMessage} />
        </DialogBody>

        {/* Footer — single submit · QR mode swaps "บันทึกชำระ" for "ส่ง QR" */}
        <DialogFooter className="px-6 py-4 border-t border-border shrink-0 flex items-center justify-between">
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
                'บันทึกชำระ'
              )}
            </Button>
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
    </>
  );
}
