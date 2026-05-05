import { useState, useMemo, useRef, useCallback } from 'react';
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
import api from '@/lib/api';
import { CASH_ACCOUNT_CODES } from '@/components/CashAccountSelect';
import { formatThaiDate } from '@/lib/date';
import { useDebounce } from '@/hooks/useDebounce';
import { toast } from 'sonner';
import type { PendingPayment } from '../types';

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Auto-detected payment case (computed from amount diff client-side).
 * RESCHEDULE / EARLY_PAYOFF are handled in separate contract-detail pages, not here.
 */
type DetectedCase = 'NORMAL' | 'OVERPAY' | 'UNDERPAY' | 'OUT_OF_RANGE';

/** Legacy type kept for API compatibility — backend accepts all 6 values */
type PaymentCase = 'NORMAL' | 'OVERPAY' | 'UNDERPAY' | 'PARTIAL' | 'EARLY_PAYOFF' | 'RESCHEDULE';

type WizardMethod = 'CASH' | 'TRANSFER' | 'QR' | 'PAYSOLUTIONS';

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
}: {
  payment: PendingPayment;
  lateFee: Decimal;
  netExposure: Decimal;
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
      <div className="flex justify-between text-sm pt-2 font-bold">
        <span className="leading-snug">ยอดรวมต้องชำระ</span>
        <span className="text-primary leading-snug">
          {totalDue.toNumber().toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿
        </span>
      </div>
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
  { id: 'TRANSFER', label: 'โอนธนาคาร', icon: <Building2 className="size-4" />, desc: 'QR / พร้อมเพย์ / โอน' },
  { id: 'QR', label: 'QR', icon: <QrCode className="size-4" />, desc: 'QR Code / PromptPay' },
  { id: 'PAYSOLUTIONS', label: 'PaySolutions', icon: <CreditCard className="size-4" />, desc: 'ผ่าน gateway' },
];

// ─── JE Preview panel (always visible) ────────────────────────────────────────

function JePreviewPanel({
  preview,
  isLoading,
}: {
  preview: JePreview | undefined;
  isLoading: boolean;
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

      {isLoading && (
        <div className="flex items-center gap-2 py-4 text-muted-foreground text-sm">
          <Loader2 className="size-4 animate-spin" />
          <span className="leading-snug">กำลังคำนวณ...</span>
        </div>
      )}

      {!isLoading && !preview && (
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
                  {parseFloat(line.debit) > 0
                    ? parseFloat(line.debit).toLocaleString('th-TH', { minimumFractionDigits: 2 })
                    : ''}
                </span>
                <span className="text-right font-mono leading-snug text-foreground">
                  {parseFloat(line.credit) > 0
                    ? parseFloat(line.credit).toLocaleString('th-TH', { minimumFractionDigits: 2 })
                    : ''}
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
              {parseFloat(preview.totalDebit).toLocaleString('th-TH', { minimumFractionDigits: 2 })} ={' '}
              {parseFloat(preview.totalCredit).toLocaleString('th-TH', { minimumFractionDigits: 2 })}{' '}
              {preview.isBalanced ? 'BALANCED' : 'UNBALANCED'}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Auto-detect case from amount diff ───────────────────────────────────────

function detectCase(received: number, expectedTotal: Decimal): DetectedCase {
  if (received <= 0) return 'OUT_OF_RANGE';
  const diff = received - expectedTotal.toNumber();
  if (Math.abs(diff) < 0.01) return 'NORMAL';
  if (diff > 0 && diff <= 1) return 'OVERPAY';
  if (diff < 0 && diff >= -1) return 'UNDERPAY';
  return 'OUT_OF_RANGE';
}

/** Map auto-detected case to the API PaymentCase param (best fit) */
function toApiCase(detected: DetectedCase): PaymentCase {
  if (detected === 'OVERPAY') return 'OVERPAY';
  if (detected === 'UNDERPAY') return 'UNDERPAY';
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

  // Amount fields
  const lateFeeDecimal = useMemo(() => new Decimal(payment.lateFee), [payment.lateFee]);
  const amountDueDecimal = useMemo(() => new Decimal(payment.amountDue), [payment.amountDue]);
  const amountPaidDecimal = useMemo(() => new Decimal(payment.amountPaid), [payment.amountPaid]);
  const defaultAmount = amountDueDecimal.add(lateFeeDecimal).sub(amountPaidDecimal).toDecimalPlaces(2);

  const [amountReceived, setAmountReceived] = useState(defaultAmount.toFixed(2));
  const [lateFeeStr, setLateFeeStr] = useState(lateFeeDecimal.toFixed(2));

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

  // Current effective late fee
  const currentLateFee = useMemo(() => {
    const v = parseFloat(lateFeeStr);
    return isNaN(v) ? new Decimal(0) : new Decimal(v);
  }, [lateFeeStr]);

  // Auto-detect case
  const receivedNum = parseFloat(amountReceived) || 0;
  const expectedTotal = useMemo(
    () => amountDueDecimal.plus(currentLateFee),
    [amountDueDecimal, currentLateFee],
  );
  const detectedCase = useMemo(
    () => detectCase(receivedNum, expectedTotal),
    [receivedNum, expectedTotal],
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

  const isPreviewReady: boolean =
    detectedCase !== 'OUT_OF_RANGE' &&
    debouncedParams.amountReceived > 0 &&
    debouncedParams.depositAccountCode.length > 0;

  const { data: previewData, isFetching: previewLoading } = useQuery<JePreview, Error, JePreview>({
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

  // Validation
  const requiresRef = method !== 'CASH';
  const requiresSlip = method === 'TRANSFER' || method === 'QR';

  const canSubmit = (): boolean => {
    if (receivedNum <= 0) return false;
    if (!depositAccountCode) return false;
    if (detectedCase === 'OUT_OF_RANGE') return false;
    if (requiresRef && !referenceNumber.trim()) return false;
    if (requiresSlip && !slipUrl) return false;
    if (!preview?.isBalanced) return false;
    return true;
  };

  const handleSubmit = () => {
    onSubmit({
      contractId: payment.contract.id,
      installmentNo: payment.installmentNo,
      amount: receivedNum,
      paymentMethod:
        method === 'TRANSFER' || method === 'PAYSOLUTIONS'
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
            />

            {/* RIGHT: Form */}
            <div className="space-y-5 min-w-0">
              {/* Hint */}
              <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                <Info className="size-4 text-muted-foreground shrink-0 mt-0.5" />
                <p className="text-xs text-muted-foreground leading-snug">
                  หากต้องการปิดยอดก่อนกำหนดหรือปรับดิว ใช้เมนูแยกในหน้าสัญญา
                </p>
              </div>

              {/* Amount received */}
              <div>
                <Label className="block text-sm font-medium text-foreground mb-1.5 leading-snug">
                  ยอดรับจริง (฿) <span className="text-destructive">*</span>
                </Label>
                <Input
                  type="number"
                  value={amountReceived}
                  onChange={(e) => setAmountReceived(e.target.value)}
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

              {/* Cash account selector */}
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-2 leading-snug">
                  บัญชีรับเงิน <span className="text-destructive">*</span>
                </h3>
                <div className="grid grid-cols-3 gap-2">
                  {CASH_ACCOUNT_CODES.map((code) => {
                    const name = coaNames.get(code) ?? '';
                    const isBank = code.startsWith('11-12');
                    return (
                      <button
                        key={code}
                        type="button"
                        onClick={() => setDepositAccountCode(code)}
                        className={cn(
                          'flex flex-col items-start rounded-xl border-2 px-3 py-2.5 text-left text-sm transition-colors',
                          depositAccountCode === code
                            ? 'bg-primary border-primary text-primary-foreground'
                            : 'bg-card border-border text-foreground hover:border-primary/40 hover:bg-accent',
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

              {/* Method selector */}
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-2 leading-snug">
                  ช่องทางรับชำระ <span className="text-destructive">*</span>
                </h3>
                <div className="grid grid-cols-2 gap-2">
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

              {/* Reference number — shown for non-cash methods */}
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

              {/* Slip upload */}
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
          <JePreviewPanel preview={preview} isLoading={previewLoading} />
        </DialogBody>

        {/* Footer — single submit */}
        <DialogFooter className="px-6 py-4 border-t border-border shrink-0 flex items-center justify-between">
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            ยกเลิก
          </Button>
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
