import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import Decimal from 'decimal.js';
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
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
import { cn } from '@/lib/utils';
import api from '@/lib/api';
import { CASH_ACCOUNT_CODES } from '@/components/CashAccountSelect';
import { formatThaiDate } from '@/lib/date';
import { useDebounce } from '@/hooks/useDebounce';
import type { PendingPayment } from '../types';

// ─── Types ───────────────────────────────────────────────────────────────────

type PaymentCase =
  | 'NORMAL'
  | 'OVERPAY'
  | 'UNDERPAY'
  | 'PARTIAL'
  | 'EARLY_PAYOFF'
  | 'RESCHEDULE';

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
}

interface CoaRow {
  code: string;
  name: string;
}

// ─── Step indicator (simple custom stepper) ───────────────────────────────────

const STEPS = ['ข้อมูล', 'กรณี', 'ช่องทาง', 'Journal'];

function WizardStepper({ step }: { step: number }) {
  return (
    <div className="flex items-center w-full mb-6">
      {STEPS.map((label, idx) => {
        const stepNo = idx + 1;
        const done = step > stepNo;
        const active = step === stepNo;
        return (
          <div key={label} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1">
              <div
                className={cn(
                  'flex items-center justify-center size-7 rounded-full text-xs font-semibold border-2 transition-colors',
                  done
                    ? 'bg-primary border-primary text-primary-foreground'
                    : active
                    ? 'bg-primary border-primary text-primary-foreground'
                    : 'bg-background border-border text-muted-foreground',
                )}
              >
                {done ? <CheckCircle2 className="size-4" /> : stepNo}
              </div>
              <span
                className={cn(
                  'text-xs leading-snug whitespace-nowrap',
                  active ? 'text-foreground font-medium' : 'text-muted-foreground',
                )}
              >
                {label}
              </span>
            </div>
            {idx < STEPS.length - 1 && (
              <div
                className={cn(
                  'flex-1 h-0.5 mx-2 mb-5 rounded-full',
                  step > stepNo ? 'bg-primary' : 'bg-border',
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Contract info panel (left, always visible) ───────────────────────────────

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
    <div className="rounded-xl border border-border bg-card p-4 space-y-1 min-w-0">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
        ข้อมูลสัญญา
      </h3>
      {row('เลขสัญญา', <span className="font-mono text-xs">{payment.contract.contractNumber}</span>)}
      {row('ชื่อลูกค้า', payment.contract.customer.name)}
      {row(
        'งวดที่',
        `${payment.installmentNo} / ${payment.contract.totalMonths}`,
      )}
      {row(
        'วันครบกำหนด',
        formatThaiDate(payment.dueDate),
        isOverdue,
      )}
      {row('ค่างวด', `${amountDue.toNumber().toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿`)}
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

// ─── Case selector (Step 2) ───────────────────────────────────────────────────

const PAYMENT_CASES: { id: PaymentCase; label: string; desc: string }[] = [
  { id: 'NORMAL', label: 'ปกติ', desc: 'จ่ายครบยอด' },
  { id: 'OVERPAY', label: 'จ่ายเกิน', desc: 'ปัดเศษขึ้น' },
  { id: 'UNDERPAY', label: 'จ่ายขาด', desc: 'ยกให้ ≤1฿' },
  { id: 'PARTIAL', label: 'แบ่งชำระ', desc: 'บางส่วน' },
  { id: 'EARLY_PAYOFF', label: 'ปิดยอด', desc: 'ก่อนกำหนด' },
  { id: 'RESCHEDULE', label: 'ปรับดิว', desc: 'เลื่อนวัน' },
];

function CaseStep({
  selectedCase,
  onCaseChange,
  amountReceived,
  onAmountChange,
}: {
  selectedCase: PaymentCase;
  onCaseChange: (c: PaymentCase) => void;
  amountReceived: string;
  onAmountChange: (v: string) => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3 leading-snug">
          เลือกกรณีที่เกิดขึ้น
        </h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {PAYMENT_CASES.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onCaseChange(c.id)}
              className={cn(
                'flex flex-col items-center justify-center rounded-xl border-2 px-3 py-3 text-sm transition-colors',
                selectedCase === c.id
                  ? 'bg-primary border-primary text-primary-foreground'
                  : 'bg-card border-border text-foreground hover:border-primary/40 hover:bg-accent',
              )}
            >
              <span className="font-semibold leading-snug">{c.label}</span>
              <span
                className={cn(
                  'text-xs leading-snug mt-0.5',
                  selectedCase === c.id ? 'text-primary-foreground/80' : 'text-muted-foreground',
                )}
              >
                {c.desc}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground mb-1.5 leading-snug">
          ยอดรับจริง (฿) <span className="text-destructive">*</span>
        </label>
        <Input
          type="number"
          value={amountReceived}
          onChange={(e) => onAmountChange(e.target.value)}
          min={0}
          step="0.01"
          className="text-right font-mono"
        />
      </div>
    </div>
  );
}

// ─── Channel step (Step 3) ─────────────────────────────────────────────────────

function ChannelStep({
  depositAccountCode,
  onDepositAccountCodeChange,
  coaNames,
}: {
  depositAccountCode: string;
  onDepositAccountCodeChange: (code: string) => void;
  coaNames: Map<string, string>;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3 leading-snug">
          ช่องทางรับชำระ
        </h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {CASH_ACCOUNT_CODES.map((code) => {
            const name = coaNames.get(code) ?? '';
            const isBank = code.startsWith('11-12');
            return (
              <button
                key={code}
                type="button"
                onClick={() => onDepositAccountCodeChange(code)}
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
    </div>
  );
}

// ─── JE Preview panel (always visible at bottom) ─────────────────────────────

function JePreviewPanel({
  preview,
  isLoading,
}: {
  preview: JePreview | undefined;
  isLoading: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 mt-4">
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
          กรอกข้อมูลเพื่อดู JE preview
        </p>
      )}

      {!isLoading && preview && (
        <>
          <div className="space-y-1">
            {/* Header row */}
            <div className="grid grid-cols-[80px_1fr_80px_80px] gap-1 text-xs text-muted-foreground font-medium pb-1 border-b border-border">
              <span className="leading-snug">รหัส</span>
              <span className="leading-snug">บัญชี</span>
              <span className="text-right leading-snug">Dr</span>
              <span className="text-right leading-snug">Cr</span>
            </div>
            {preview.lines.map((line, idx) => (
              <div
                key={idx}
                className="grid grid-cols-[80px_1fr_80px_80px] gap-1 text-xs"
              >
                <span className="font-mono text-muted-foreground leading-snug">{line.accountCode}</span>
                <div className="min-w-0">
                  <span className="leading-snug text-foreground truncate block">{line.accountName}</span>
                  <span className="leading-snug text-muted-foreground/70 text-[10px]">{line.description}</span>
                </div>
                <span className="text-right font-mono leading-snug text-foreground">
                  {parseFloat(line.debit) > 0 ? parseFloat(line.debit).toLocaleString('th-TH', { minimumFractionDigits: 2 }) : ''}
                </span>
                <span className="text-right font-mono leading-snug text-foreground">
                  {parseFloat(line.credit) > 0 ? parseFloat(line.credit).toLocaleString('th-TH', { minimumFractionDigits: 2 }) : ''}
                </span>
              </div>
            ))}
          </div>

          {/* Balance indicator */}
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

// ─── Journal review step (Step 4) ─────────────────────────────────────────────

function JournalReviewStep({
  preview,
  isLoading,
}: {
  preview: JePreview | undefined;
  isLoading: boolean;
}) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground leading-snug">
        ตรวจสอบรายการบัญชีก่อนบันทึก
      </h3>
      <p className="text-xs text-muted-foreground leading-snug">
        ระบบจะสร้างรายการบัญชีเหล่านี้อัตโนมัติเมื่อกดบันทึก
      </p>
      {isLoading || !preview ? (
        <div className="flex items-center gap-2 py-4 text-muted-foreground text-sm">
          <Loader2 className="size-4 animate-spin" />
          <span className="leading-snug">กำลังคำนวณ...</span>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted">
                <th className="px-3 py-2 text-left font-medium text-muted-foreground leading-snug">รหัส</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground leading-snug">บัญชี</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground leading-snug">Dr</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground leading-snug">Cr</th>
              </tr>
            </thead>
            <tbody>
              {preview.lines.map((line, idx) => (
                <tr key={idx} className="border-t border-border/50">
                  <td className="px-3 py-2 font-mono text-muted-foreground leading-snug">{line.accountCode}</td>
                  <td className="px-3 py-2 leading-snug">
                    <div className="text-foreground">{line.accountName}</div>
                    <div className="text-muted-foreground/70 text-[10px]">{line.description}</div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono leading-snug">
                    {parseFloat(line.debit) > 0
                      ? parseFloat(line.debit).toLocaleString('th-TH', { minimumFractionDigits: 2 })
                      : '—'}
                  </td>
                  <td className="px-3 py-2 text-right font-mono leading-snug">
                    {parseFloat(line.credit) > 0
                      ? parseFloat(line.credit).toLocaleString('th-TH', { minimumFractionDigits: 2 })
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border bg-muted/50">
                <td colSpan={2} className="px-3 py-2 font-semibold text-xs leading-snug">รวม</td>
                <td className="px-3 py-2 text-right font-mono font-semibold text-xs leading-snug">
                  {parseFloat(preview.totalDebit).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                </td>
                <td className="px-3 py-2 text-right font-mono font-semibold text-xs leading-snug">
                  {parseFloat(preview.totalCredit).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                </td>
              </tr>
            </tfoot>
          </table>
          {!preview.isBalanced && (
            <div className="flex items-center gap-1.5 px-3 py-2 bg-destructive/10 border-t border-destructive/20">
              <AlertCircle className="size-3.5 text-destructive shrink-0" />
              <span className="text-xs text-destructive leading-snug font-medium">
                รายการไม่สมดุล — ไม่สามารถบันทึกได้
              </span>
            </div>
          )}
          {preview.isBalanced && (
            <div className="flex items-center gap-1.5 px-3 py-2 bg-success/10 border-t border-success/20">
              <CheckCircle2 className="size-3.5 text-success shrink-0" />
              <span className="text-xs text-success leading-snug font-medium">รายการสมดุล — พร้อมบันทึก</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main wizard ──────────────────────────────────────────────────────────────

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
  const [step, setStep] = useState(1);
  const [selectedCase, setSelectedCase] = useState<PaymentCase>('NORMAL');
  const [depositAccountCode, setDepositAccountCode] = useState(defaultDepositAccountCode);

  // Compute initial amount (installmentTotal + lateFee from existing payment row)
  const lateFeeDecimal = useMemo(() => new Decimal(payment.lateFee), [payment.lateFee]);
  const amountDueDecimal = useMemo(() => new Decimal(payment.amountDue), [payment.amountDue]);
  const amountPaidDecimal = useMemo(() => new Decimal(payment.amountPaid), [payment.amountPaid]);
  const defaultAmount = amountDueDecimal.add(lateFeeDecimal).sub(amountPaidDecimal).toDecimalPlaces(2);

  const [amountReceived, setAmountReceived] = useState(defaultAmount.toFixed(2));

  // Net Exposure: (totalMonths - paidInstallments) * installmentTotal + accumulated lateFees
  // We use monthlyPayment as the per-installment amount + current late fee as proxy
  const netExposure = useMemo(() => {
    const monthlyPayment = new Decimal(payment.contract.monthlyPayment);
    const totalMonths = payment.contract.totalMonths;
    const remaining = Math.max(totalMonths - (payment.installmentNo - 1), 0);
    return monthlyPayment.mul(remaining).add(lateFeeDecimal).toDecimalPlaces(2);
  }, [payment, lateFeeDecimal]);

  // Fetch CoA names for cash account chips
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

  // Build the preview query params — debounced so we don't fire on every keystroke
  const previewParams = useMemo(
    () => ({
      contractId: payment.contract.id,
      installmentNo: payment.installmentNo,
      amountReceived: parseFloat(amountReceived) || 0,
      depositAccountCode,
      lateFee: lateFeeDecimal.toNumber(),
      case: selectedCase,
    }),
    [amountReceived, depositAccountCode, lateFeeDecimal, selectedCase, payment],
  );
  const debouncedParams = useDebounce(previewParams, 300);

  const isPreviewReady: boolean =
    debouncedParams.amountReceived > 0 && debouncedParams.depositAccountCode.length > 0;

  const {
    data: previewData,
    isFetching: previewLoading,
  } = useQuery<JePreview, Error, JePreview>({
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

  const handleSubmit = () => {
    onSubmit({
      contractId: payment.contract.id,
      installmentNo: payment.installmentNo,
      amount: parseFloat(amountReceived) || 0,
      paymentMethod: depositAccountCode.startsWith('11-12') ? 'BANK_TRANSFER' : 'CASH',
      depositAccountCode,
      lateFee: lateFeeDecimal.toNumber(),
      case: selectedCase,
    });
  };

  const canAdvance = () => {
    if (step === 1) return true;
    if (step === 2) return parseFloat(amountReceived) > 0;
    if (step === 3) return !!depositAccountCode;
    if (step === 4) return !!(preview?.isBalanced);
    return false;
  };

  // Reset state when dialog opens
  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      onClose();
      setStep(1);
      setSelectedCase('NORMAL');
      setDepositAccountCode(defaultDepositAccountCode);
      setAmountReceived(defaultAmount.toFixed(2));
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-4xl max-h-[92vh] flex flex-col p-0 gap-0">
        {/* Header */}
        <DialogHeader className="px-6 pt-5 pb-0 shrink-0">
          <DialogTitle className="text-base font-semibold leading-snug">
            {payment.contract.contractNumber} / {payment.contract.customer.name} — งวดที่{' '}
            {payment.installmentNo}
          </DialogTitle>
        </DialogHeader>

        <DialogBody className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Stepper */}
          <WizardStepper step={step} />

          {/* Step 1: Info — shown as left panel summary in steps 2-4 */}
          {step === 1 && (
            <div className="grid grid-cols-1 gap-4">
              <ContractInfoPanel
                payment={payment}
                lateFee={lateFeeDecimal}
                netExposure={netExposure}
              />
              <div className="rounded-xl border border-border bg-card p-4">
                <p className="text-sm text-muted-foreground leading-snug">
                  กดถัดไปเพื่อเลือกกรณีการชำระและจำนวนเงิน
                </p>
              </div>
            </div>
          )}

          {step >= 2 && (
            <div className="grid grid-cols-[280px_1fr] gap-4">
              {/* Left: always show contract info */}
              <ContractInfoPanel
                payment={payment}
                lateFee={lateFeeDecimal}
                netExposure={netExposure}
              />

              {/* Right: step content */}
              <div className="min-w-0">
                {step === 2 && (
                  <CaseStep
                    selectedCase={selectedCase}
                    onCaseChange={setSelectedCase}
                    amountReceived={amountReceived}
                    onAmountChange={setAmountReceived}
                  />
                )}
                {step === 3 && (
                  <ChannelStep
                    depositAccountCode={depositAccountCode}
                    onDepositAccountCodeChange={setDepositAccountCode}
                    coaNames={coaNames}
                  />
                )}
                {step === 4 && (
                  <JournalReviewStep preview={preview} isLoading={previewLoading} />
                )}
              </div>
            </div>
          )}

          {/* JE Preview — always visible at bottom (steps 2+) */}
          {step >= 2 && (
            <JePreviewPanel preview={preview} isLoading={previewLoading} />
          )}
        </DialogBody>

        {/* Footer */}
        <DialogFooter className="px-6 py-4 border-t border-border shrink-0 flex items-center justify-between">
          <Button
            variant="ghost"
            onClick={() => setStep((s) => Math.max(1, s - 1))}
            disabled={step === 1 || isSubmitting}
          >
            ก่อนหน้า
          </Button>
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
              ยกเลิก
            </Button>
            {step < 4 ? (
              <Button
                onClick={() => setStep((s) => Math.min(4, s + 1))}
                disabled={!canAdvance()}
              >
                ถัดไป
              </Button>
            ) : (
              <Button
                onClick={handleSubmit}
                disabled={isSubmitting || previewLoading || !preview?.isBalanced}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin mr-2" />
                    กำลังบันทึก...
                  </>
                ) : (
                  'บันทึกการชำระ'
                )}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
