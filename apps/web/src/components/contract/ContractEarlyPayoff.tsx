import PaymentApprovalRequestDialog from '@/components/payment/PaymentApprovalRequestDialog';
import { useRef, useState } from 'react';
import { FocusScope } from '@radix-ui/react-focus-scope';
import { WizardStackedOverlay } from '@/components/WizardStackedOverlay';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Camera,
  Check,
  CheckCircle2,
  FileText,
  Loader2,
  Lock,
  Store,
  Upload,
  XCircle,
} from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import { formatDateShort, formatNumber, formatNumberDecimal } from '@/utils/formatters';
import { CashAccountSelect, KBANK_ONLY_CODES } from '@/components/CashAccountSelect';
import { useAuth } from '@/contexts/AuthContext';
import { invalidatePaymentQueries } from '@/pages/PaymentsPage/invalidatePaymentQueries';

/* ─── Types ───────────────────────────────────────── */
export interface JeLinePreview {
  accountCode: string;
  accountName: string;
  debit: string;
  credit: string;
  description: string;
}

export interface EarlyPayoffQuote {
  monthlyPayment: number;
  remainingMonths: number;
  totalRemaining: number;
  advancePayment: number;
  /** ค่าปรับดิวที่ลูกค้าจ่ายล่วงหน้าไว้ (21-1103) — หักเต็มจำนวนจากยอดปิด */
  rescheduleAdvanceApplied: number;
  remainingBalance: number;
  remainingExVat: number;
  remainingCost: number;
  grossProfit: number;
  discountPct: number;
  discountAmount: number;
  unpaidLateFees: number;
  totalPayoff: number;
  /** JE preview (JP4 template) — emitted when contract is in payoff-eligible state. */
  journalPreview?: {
    lines: JeLinePreview[];
    totalDebit: string;
    totalCredit: string;
    isBalanced: boolean;
  };
}

/** ผลตรวจสลิป — POST /contracts/:id/early-payoff/slip (กติกา 5 ข้อ · mockup 69ezDjY8) */
export interface SlipCheck {
  code: 'READABLE' | 'AMOUNT_MATCH' | 'COMPANY_ACCOUNT' | 'NOT_REUSED' | 'DATE_VALID';
  ok: boolean;
  label: string;
  detail?: string;
}
export interface SlipVerifyResult {
  engine: 'OCR';
  available: boolean;
  imageKey: string;
  slipUrl: string;
  reading: {
    amount?: number | null;
    refNo?: string | null;
    bankName?: string | null;
    date?: string | null;
    time?: string | null;
    toAccount?: string | null;
    fromAccount?: string | null;
    confidence: number;
  } | null;
  expectedAmount: number;
  discountPct: number;
  checks: SlipCheck[];
  matched: boolean;
  paymentDate: string;
  ticket: string | null;
}
type SlipState =
  | { phase: 'idle' }
  | { phase: 'checking'; fileName: string }
  | { phase: 'done'; fileName: string; result: SlipVerifyResult }
  | { phase: 'error'; fileName: string; message: string };

interface Props {
  contractId: string;
  contractNumber: string;
  customerName: string;
  productName?: string;
  branchName?: string;
  onClose: () => void;
  onSuccess: () => void;
}

const DISCOUNT_PRESETS = [0, 10, 20, 30, 40, 50];
const MAX_DISCOUNT = 50;

/* ─── Display-only summary card (kept for compatibility) ───────── */
export function ContractEarlyPayoffQuote({
  payoffQuote,
  contractStatus,
}: {
  payoffQuote: { totalPayoff: number; remainingMonths: number };
  contractStatus: string;
}) {
  if (!['ACTIVE', 'OVERDUE', 'DEFAULT'].includes(contractStatus)) return null;
  return (
    <div className="bg-primary/5 rounded-xl border border-primary/20 p-6 mb-6 shadow-sm">
      <h2 className="text-lg font-semibold text-primary mb-3">ประเมินปิดก่อนกำหนด</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div>
          <div className="text-xs text-primary">งวดคงเหลือ</div>
          <div className="font-medium">{payoffQuote.remainingMonths} งวด</div>
        </div>
        <div>
          <div className="text-xs text-primary font-semibold">ยอดปิดสัญญา (ส่วนลด 50%)</div>
          <div className="text-xl font-bold text-primary">
            {formatNumber(payoffQuote.totalPayoff)} บาท
          </div>
        </div>
      </div>
    </div>
  );
}

/** Today's date in Asia/Bangkok (YYYY-MM-DD) — avoids UTC off-by-one during BKK evening. */
const bkkToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });

/* ─── Full-screen overlay ─────────────────────────── */
export function EarlyPayoffOverlay({
  contractId,
  contractNumber,
  customerName,
  productName,
  branchName,
  onClose,
  onSuccess,
}: Props) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [discountPct, setDiscountPct] = useState(50);
  const [approvalOpen, setApprovalOpen] = useState(false);
  // Owner rule 2026-07-08: direct FINANCE receipt = ธนาคารกสิกร (11-1201) only.
  const [depositAccountCode, setDepositAccountCode] = useState('11-1201');
  // BKK-aware today — toISOString() is UTC and yields "yesterday" before 07:00 น. (PR #1327 bug class)
  const [paymentDate, setPaymentDate] = useState(bkkToday);
  const [notes, setNotes] = useState('');
  // วิธีรับเงิน (mockup 2026-09-23): โอนเข้าบัญชีบริษัท (แนบสลิป → ปิดเลยถ้ายอดตรง) | เก็บที่หน้าร้าน (Dr 11-2107 · ต้องขออนุมัติ)
  const [receiveMode, setReceiveMode] = useState<'TRANSFER' | 'SHOP'>('TRANSFER');
  const collectedByShop = receiveMode === 'SHOP';
  // สลิปที่แนบ + ผลตรวจ 5 ข้อ — ส่วนลดเปลี่ยน = ยอดปิดเปลี่ยน ⇒ ต้องแนบ/ตรวจใหม่
  const [slip, setSlip] = useState<SlipState>({ phase: 'idle' });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [done, setDone] = useState<{ totalPayoff: number; paidDate: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  // Settlement dialog state
  const [settlementOpen, setSettlementOpen] = useState(false);
  const [settlementAccountCode, setSettlementAccountCode] = useState('11-1201');
  const [settlementAmount, setSettlementAmount] = useState('');
  // Client-generated per-dialog-open UUID — dedupe key for shop-collect
  // settlement retries without swallowing an intentional same-amount repeat.
  const [settlementRequestId, setSettlementRequestId] = useState('');

  const canSettlement = ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'].includes(user?.role ?? '');

  const { data: quote, isLoading } = useQuery<EarlyPayoffQuote>({
    queryKey: ['contract-payoff', contractId, discountPct, depositAccountCode, collectedByShop],
    queryFn: async () => {
      const params = new URLSearchParams({
        discountPct: String(discountPct),
        depositAccountCode,
      });
      if (collectedByShop) params.set('collectedByShop', 'true');
      const { data } = await api.get(
        `/contracts/${contractId}/early-payoff-quote?${params.toString()}`,
      );
      return data;
    },
  });

  const settlementMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/contracts/${contractId}/shop-collect-settlement`, {
        depositAccountCode: settlementAccountCode,
        amount: Number(settlementAmount),
        requestId: settlementRequestId,
      });
      return data;
    },
    onSuccess: () => {
      toast.success('บันทึกรับโอนจากหน้าร้านสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['contract', contractId] });
      queryClient.invalidateQueries({ queryKey: ['contract-payoff', contractId] });
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
      invalidatePaymentQueries(queryClient);
      setSettlementOpen(false);
      setSettlementAmount('');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const verifyMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('slip', file);
      form.append('discountPct', String(discountPct));
      const { data } = await api.post<SlipVerifyResult>(
        `/contracts/${contractId}/early-payoff/slip`,
        form,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      return data;
    },
    onMutate: (file) => setSlip({ phase: 'checking', fileName: file.name }),
    onSuccess: (result, file) => setSlip({ phase: 'done', fileName: file.name, result }),
    onError: (err, file) =>
      setSlip({ phase: 'error', fileName: file.name, message: getErrorMessage(err) }),
  });

  const confirmMutation = useMutation({
    mutationFn: async (ticket: string) => {
      const { data } = await api.post<{ totalPayoff: number; paidDate: string }>(
        `/contracts/${contractId}/early-payoff/slip-confirm`,
        { ticket, notes: notes || undefined },
      );
      return data;
    },
    onSuccess: (data) => {
      setConfirmOpen(false);
      setDone({ totalPayoff: data.totalPayoff, paidDate: data.paidDate });
      queryClient.invalidateQueries({ queryKey: ['contract', contractId] });
      queryClient.invalidateQueries({ queryKey: ['contract-payoff', contractId] });
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
      invalidatePaymentQueries(queryClient);
      toast.success('ปิดสัญญาแล้ว');
      onSuccess();
    },
    onError: (err) => {
      setConfirmOpen(false);
      toast.error(getErrorMessage(err));
      // ยอดปิดเปลี่ยน/สลิปถูกใช้/ตั๋วหมดอายุ → ต้องตรวจสลิปใหม่
      setSlip({ phase: 'idle' });
    },
  });

  const pickSlip = (file: File | undefined) => {
    if (!file) return;
    verifyMutation.mutate(file);
  };
  const changeDiscount = (pct: number) => {
    setDiscountPct(pct);
    if (slip.phase !== 'idle') setSlip({ phase: 'idle' });
  };

  const slipResult = slip.phase === 'done' ? slip.result : null;
  const slipMatched = !!slipResult?.matched && !!slipResult.ticket;
  // แถบขั้นตอน: 1 แนบสลิป · 2 ตรวจ · 3 ปิดสัญญา
  const step = slip.phase === 'idle' ? 1 : slip.phase === 'checking' ? 2 : slipMatched ? 3 : 2;

  const inputClass =
    'w-full px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 outline-hidden';

  const canSubmit = !!quote;

  return (
    <WizardStackedOverlay maxWidthClass="max-w-2xl">
      <PaymentApprovalRequestDialog
        open={approvalOpen}
        onOpenChange={setApprovalOpen}
        action="EARLY_PAYOFF"
        targetId={contractId}
        contractNumber={contractNumber}
        requiredPermissions={['EARLY_PAYOFF']}
        initialReason={notes}
        payload={{
          paymentMethod: 'BANK_TRANSFER',
          discountPct,
          depositAccountCode,
          collectedByShop,
          paymentDate: paymentDate || undefined,
          notes: notes || undefined,
          // สลิปที่ยอดไม่ตรง/อ่านไม่ได้ แนบไปกับคำขอ ให้ผู้อนุมัติเปิดดูได้ (PaymentApprovalSummary)
          ...(slipResult?.slipUrl && !collectedByShop ? { slipUrl: slipResult.slipUrl } : {}),
        }}
        onRequested={onClose}
      />
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-xs border-b px-6 py-4 flex items-center justify-between">
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          ← กลับ
        </button>
        <h2 className="text-lg font-semibold text-foreground">ปิดสัญญาก่อนกำหนด</h2>
        <div className="w-16" />
      </div>

      <div className="p-6 space-y-5">
        {/* Section 1: ข้อมูลสัญญา */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="flex items-center justify-center size-8 rounded-lg bg-primary/10 text-primary">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="size-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15"
                />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">ข้อมูลสัญญา</h3>
              <p className="text-xs text-muted-foreground">เลขที่, ลูกค้า, สินค้า</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <div>
              <span className="text-muted-foreground">สัญญา: </span>
              <span className="font-mono font-semibold">{contractNumber}</span>
            </div>
            <div>
              <span className="text-muted-foreground">ลูกค้า: </span>
              <span className="font-medium">{customerName}</span>
            </div>
            {productName && (
              <div>
                <span className="text-muted-foreground">สินค้า: </span>
                <span className="font-medium">{productName}</span>
              </div>
            )}
            {branchName && (
              <div>
                <span className="text-muted-foreground">สาขา: </span>
                <span className="font-medium">{branchName}</span>
              </div>
            )}
          </div>
        </div>

        {/* Section 2: คำนวณยอดปิดสัญญา */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="flex items-center justify-center size-8 rounded-lg bg-primary/10 text-primary">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="size-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25"
                />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">คำนวณยอดปิดสัญญา</h3>
              <p className="text-xs text-muted-foreground">เลือก % ส่วนลดเพื่อ recalc</p>
            </div>
          </div>

          {/* Discount selector */}
          <div className="mb-4">
            <label className="block text-xs font-medium text-foreground mb-1.5">
              ส่วนลดบนกำไรขั้นต้น
            </label>
            <div className="flex flex-wrap gap-2">
              {DISCOUNT_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => changeDiscount(p)}
                  className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                    discountPct === p
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background border-input hover:bg-muted'
                  }`}
                >
                  {p}%
                </button>
              ))}
              <input
                type="number"
                min={0}
                max={MAX_DISCOUNT}
                value={discountPct}
                onChange={(e) =>
                  changeDiscount(Math.max(0, Math.min(MAX_DISCOUNT, Number(e.target.value))))
                }
                className="w-20 px-2 py-1.5 border border-input rounded-lg text-sm"
              />
              <span className="text-sm text-muted-foreground self-center">%</span>
            </div>
          </div>

          {/* Breakdown table */}
          {isLoading || !quote ? (
            <div className="py-8 text-center text-sm text-muted-foreground">กำลังคำนวณ...</div>
          ) : (
            <div className="space-y-1.5 text-sm">
              <Row label="ค่างวด" value={`${formatNumber(quote.monthlyPayment)} บาท`} />
              <Row label="จำนวนงวด" value={`${quote.remainingMonths} งวด`} />
              <Row label="รวมค้างชำระ" value={`${formatNumber(quote.totalRemaining)} บาท`} bold />
              {quote.advancePayment > 0 && (
                <Row
                  label="ยอดชำระล่วงหน้า"
                  value={`-${formatNumber(quote.advancePayment)} บาท`}
                  muted
                />
              )}
              {/* ค่าปรับดิวที่พักไว้หักออกจากยอดค้าง "ก่อน" คิดฐานส่วนลด
                  (คำสั่งเจ้าของ 2026-09-23) — บรรทัดนี้จึงอยู่เหนือ "คงเหลือยอดค้าง" */}
              {quote.rescheduleAdvanceApplied > 0 && (
                <Row
                  label="หักค่าปรับดิวที่จ่ายล่วงหน้าไว้"
                  value={`-${formatNumber(quote.rescheduleAdvanceApplied)} บาท`}
                  success
                />
              )}
              <Row
                label="คงเหลือยอดค้าง"
                value={`${formatNumber(quote.remainingBalance)} บาท`}
                bold
              />
              <div className="border-t border-border my-2" />
              <Row
                label="ค่างวดไม่รวม VAT (1)"
                value={`${formatNumber(quote.remainingExVat)} บาท`}
              />
              <Row
                label="ต้นทุนยอดค้างชำระ (2)"
                value={`${formatNumber(quote.remainingCost)} บาท`}
              />
              <Row label="(1) − (2)" value={`${formatNumber(quote.grossProfit)} บาท`} />
              <Row
                label={`ส่วนลดลูกค้า ${discountPct}%`}
                value={`-${formatNumber(quote.discountAmount)} บาท`}
                success
              />
              {quote.unpaidLateFees > 0 && (
                <Row
                  label="ค่าปรับค้างชำระ"
                  value={`+${formatNumber(quote.unpaidLateFees)} บาท`}
                  destructive
                />
              )}
              <div className="border-t border-primary/30 my-2" />
              <div className="flex justify-between items-center bg-primary/5 rounded-lg px-3 py-3">
                <span className="text-base font-semibold text-primary">ยอดชำระปิดยอด</span>
                <span className="text-2xl font-bold text-primary">
                  {formatNumber(quote.totalPayoff)} บาท
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Section 3: รับชำระ — วิธีรับเงิน + สลิป (mockup 69ezDjY8 · เจ้าของ 2026-09-24 "ยอดตรงกับสลิป ปิดยอดได้เลย") */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="flex items-center justify-center size-8 rounded-lg bg-warning/10 text-warning-strong">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="size-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z"
                />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">รับชำระ</h3>
              <p className="text-xs text-muted-foreground">วิธีรับเงิน · สลิป · วันที่ลงบัญชี</p>
            </div>
          </div>

          {/* วิธีรับเงิน — segmented control */}
          <div
            role="radiogroup"
            aria-label="วิธีรับเงิน"
            className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-muted/40 p-1 mb-4"
          >
            {(
              [
                ['TRANSFER', 'โอนเข้าบัญชีบริษัท · แนบสลิป'],
                ['SHOP', 'เก็บที่หน้าร้าน'],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={receiveMode === mode}
                onClick={() => {
                  setReceiveMode(mode);
                  if (mode === 'SHOP') setSlip({ phase: 'idle' });
                }}
                className={`min-h-11 rounded-lg text-sm font-medium transition-colors ${
                  receiveMode === mode
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-accent'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {collectedByShop ? (
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground leading-snug">
                หน้าร้านรับเงินแล้วโอนเข้า FINANCE ภายหลัง (บันทึก Dr 11-2107 ลูกหนี้-หน้าร้าน) —
                ทางนี้ต้องส่งขออนุมัติปิดสัญญาเสมอ
              </p>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">
                  วันที่รับเงิน{' '}
                  <span className="text-muted-foreground font-normal">
                    (ย้อนหลังได้ถ้างวดบัญชียังเปิด)
                  </span>
                </label>
                <input
                  type="date"
                  value={paymentDate}
                  max={bkkToday()}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className={`${inputClass} font-mono`}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">
                  บัญชีรับเงิน <span className="text-destructive">*</span>
                </label>
                <CashAccountSelect
                  value={depositAccountCode}
                  onChange={setDepositAccountCode}
                  disabled
                  codes={KBANK_ONLY_CODES}
                />
                <p className="mt-1 text-xs text-muted-foreground leading-snug">
                  บัญชีถูกกำหนดเป็น 11-2107 อัตโนมัติโดยระบบ — กรอกบัญชีรับโอนจากหน้าร้านตอน
                  settlement
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* แถบ 3 ขั้น */}
              <ol aria-label="ขั้นตอน" className="grid grid-cols-3 gap-2">
                {(['แนบสลิป', 'อ่านสลิป', 'ปิดสัญญา'] as const).map((label, i) => {
                  const n = i + 1;
                  const state = n < step ? 'done' : n === step ? 'current' : 'todo';
                  return (
                    <li
                      key={label}
                      aria-current={state === 'current' ? 'step' : undefined}
                      className={`flex items-center gap-2 pt-2 text-xs border-t-[3px] leading-snug ${
                        state === 'todo'
                          ? 'border-border text-muted-foreground'
                          : 'border-primary text-foreground font-medium'
                      }`}
                    >
                      <span
                        className={`inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] ${
                          state === 'todo'
                            ? 'border border-border'
                            : 'bg-primary text-primary-foreground'
                        }`}
                      >
                        {state === 'done' ? <Check className="size-3" /> : n}
                      </span>
                      {label}
                    </li>
                  );
                })}
              </ol>

              {/* การ์ดสลิป */}
              <div
                data-testid="slip-card"
                className={`rounded-xl border p-4 space-y-3 ${
                  slipMatched
                    ? 'border-primary/40'
                    : slipResult || slip.phase === 'error'
                      ? 'border-warning/50'
                      : 'border-border'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="leading-snug">
                    <h4 className="text-sm font-semibold text-foreground">สลิปโอนเงินจากลูกค้า</h4>
                    <p className="text-xs text-muted-foreground" role="status">
                      {slip.phase === 'idle' &&
                        `โอนเข้ากสิกร (11-1201) — ยอดตรงกับ ${quote ? `${formatNumber(quote.totalPayoff)} บาท` : 'ยอดปิด'} ปิดสัญญาได้ทันที`}
                      {slip.phase === 'checking' && 'กำลังอ่านสลิป… ปกติใช้เวลา 2–6 วินาที'}
                      {slip.phase === 'error' && slip.message}
                      {slipResult &&
                        (slipMatched
                          ? 'อ่านสลิปแล้ว — ผ่านเงื่อนไขครบ 5 ข้อ'
                          : slipResult.available
                            ? 'อ่านสลิปแล้ว — ไม่ผ่านเงื่อนไข ปิดเลยไม่ได้'
                            : 'ระบบอ่านสลิปไม่ได้ในตอนนี้')}
                    </p>
                  </div>
                  {slip.phase !== 'idle' && slip.phase !== 'checking' && (
                    <button
                      type="button"
                      onClick={() => setSlip({ phase: 'idle' })}
                      className="min-h-11 px-3 text-xs border border-input rounded-lg hover:bg-muted"
                    >
                      เปลี่ยนสลิป
                    </button>
                  )}
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  aria-label="เลือกไฟล์สลิป"
                  onChange={(e) => {
                    pickSlip(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  aria-label="ถ่ายรูปสลิป"
                  onChange={(e) => {
                    pickSlip(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />

                {slip.phase === 'idle' && (
                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      pickSlip(e.dataTransfer.files?.[0]);
                    }}
                    className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-input bg-muted/20 px-4 py-8 text-center"
                  >
                    <FileText className="size-7 text-muted-foreground" aria-hidden="true" />
                    <p className="text-sm font-medium text-foreground leading-snug">
                      ลากรูปสลิปมาวางที่นี่
                    </p>
                    <div className="flex flex-wrap justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="inline-flex items-center gap-2 min-h-11 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90"
                      >
                        <Upload className="size-4" aria-hidden="true" />
                        เลือกไฟล์
                      </button>
                      <button
                        type="button"
                        onClick={() => cameraInputRef.current?.click()}
                        className="inline-flex items-center gap-2 min-h-11 px-4 rounded-lg border border-input text-sm font-medium hover:bg-muted"
                      >
                        <Camera className="size-4" aria-hidden="true" />
                        ถ่ายรูป
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground leading-snug">
                      JPG / PNG / WEBP ไม่เกิน 5 MB
                    </p>
                  </div>
                )}

                {slip.phase === 'checking' && (
                  <div
                    aria-busy="true"
                    className="flex items-center gap-3 rounded-xl border border-border px-4 py-6"
                  >
                    <Loader2 className="size-5 animate-spin text-primary" aria-hidden="true" />
                    <div className="leading-snug">
                      <p className="text-sm font-medium text-foreground">{slip.fileName}</p>
                      <p className="text-xs text-muted-foreground">
                        กำลังอ่านยอด เลขอ้างอิง และบัญชีปลายทาง…
                      </p>
                    </div>
                  </div>
                )}

                {slip.phase === 'error' && (
                  <div
                    role="alert"
                    className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive leading-snug"
                  >
                    อัปโหลด/อ่านสลิปไม่สำเร็จ: {slip.message}
                  </div>
                )}

                {slipResult && (
                  <>
                    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">ยอดโอน</dt>
                        <dd
                          className={`font-semibold tabular-nums ${slipMatched ? 'text-primary' : 'text-foreground'}`}
                        >
                          {typeof slipResult.reading?.amount === 'number'
                            ? `${formatNumberDecimal(slipResult.reading.amount)} บาท`
                            : '—'}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">ยอดปิดที่ต้องรับ</dt>
                        <dd className="tabular-nums">
                          {formatNumberDecimal(slipResult.expectedAmount)} บาท
                        </dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">เข้าบัญชี</dt>
                        <dd>
                          {[slipResult.reading?.bankName, slipResult.reading?.toAccount]
                            .filter(Boolean)
                            .join(' ') || '—'}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">เลขอ้างอิง</dt>
                        <dd className="font-mono">{slipResult.reading?.refNo ?? '—'}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">โอนเมื่อ</dt>
                        <dd>
                          {[slipResult.reading?.date, slipResult.reading?.time]
                            .filter(Boolean)
                            .join(' ') || '—'}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">ความมั่นใจของระบบอ่าน</dt>
                        <dd>
                          {slipResult.reading
                            ? `${Math.round(slipResult.reading.confidence * 100)}%`
                            : '—'}
                        </dd>
                      </div>
                    </dl>

                    <ul className="space-y-1 text-xs leading-snug" aria-label="ผลตรวจสลิป">
                      {slipResult.checks.map((c) => (
                        <li key={c.code} className="flex items-start gap-2">
                          {c.ok ? (
                            <CheckCircle2
                              className="size-4 shrink-0 text-primary"
                              aria-label="ผ่าน"
                            />
                          ) : (
                            <XCircle
                              className="size-4 shrink-0 text-destructive"
                              aria-label="ไม่ผ่าน"
                            />
                          )}
                          <span className={c.ok ? 'text-foreground' : 'text-destructive'}>
                            {c.label}
                            {c.detail ? (
                              <span className="text-muted-foreground"> — {c.detail}</span>
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ul>

                    {slipMatched ? (
                      <div className="flex items-start gap-2.5 rounded-lg bg-primary/10 border border-primary/30 px-3 py-2.5 leading-snug">
                        <CheckCircle2 className="size-5 shrink-0 text-primary" aria-hidden="true" />
                        <div>
                          <p className="text-sm font-semibold text-primary">
                            ยอดตรง — ปิดสัญญาได้เลย ไม่ต้องรอผู้อนุมัติ
                          </p>
                          <p className="text-xs text-muted-foreground">
                            วันที่รับเงิน/ลงบัญชี {formatDateShort(slipResult.paymentDate)} · บัญชี
                            11-1201 ธนาคารกสิกร (ตามสลิป)
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-2.5 rounded-lg bg-warning/10 border border-warning/40 px-3 py-2.5 leading-snug">
                        <AlertTriangle
                          className="size-5 shrink-0 text-warning-strong"
                          aria-hidden="true"
                        />
                        <div>
                          <p className="text-sm font-semibold text-warning-strong">
                            ต้องให้ผู้มีสิทธิ์อนุมัติก่อน
                          </p>
                          <p className="text-xs text-muted-foreground">
                            สลิปนี้จะแนบไปกับคำขอให้ผู้อนุมัติดู · หรือกด "เปลี่ยนสลิป"
                            แนบใบที่ยอดถูกต้อง
                          </p>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Section: หมายเหตุ (card แยก — mirror จอคืนเครื่อง) */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="flex items-center justify-center size-8 rounded-lg bg-primary/10 text-primary">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="size-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">หมายเหตุ</h3>
              <p className="text-xs text-muted-foreground">บันทึกเพิ่มเติม (ถ้ามี)</p>
            </div>
          </div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className={inputClass}
            placeholder="หมายเหตุเพิ่มเติม (ถ้ามี)"
          />
        </div>

        {/* Section JOURNAL AUTO */}
        {quote?.journalPreview && (
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <div className="flex items-center justify-center size-8 rounded-lg bg-primary/10 text-primary">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="size-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z"
                    />
                  </svg>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    JOURNAL AUTO — บันทึกทางบัญชี
                  </h3>
                  <p className="text-xs text-muted-foreground">JP4 — ปิดยอดก่อนกำหนด (Policy A)</p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium leading-snug">
                AUTO
              </span>
            </div>
            <div className="space-y-1">
              <div className="grid grid-cols-[80px_1fr_90px_90px] gap-1 text-xs text-muted-foreground font-medium pb-1 border-b border-border">
                <span>รหัส</span>
                <span>บัญชี</span>
                <span className="text-right">Dr</span>
                <span className="text-right">Cr</span>
              </div>
              {quote.journalPreview.lines.map((line, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-[80px_1fr_90px_90px] gap-1 text-xs leading-snug"
                >
                  <span className="font-mono text-muted-foreground">{line.accountCode}</span>
                  <div className="min-w-0">
                    <span className="text-foreground truncate block">{line.accountName}</span>
                    <span className="text-muted-foreground/70 text-[10px]">{line.description}</span>
                  </div>
                  <span className="text-right font-mono text-foreground">
                    {parseFloat(line.debit) > 0 ? formatNumberDecimal(line.debit) : ''}
                  </span>
                  <span className="text-right font-mono text-foreground">
                    {parseFloat(line.credit) > 0 ? formatNumberDecimal(line.credit) : ''}
                  </span>
                </div>
              ))}
            </div>
            <div
              className={`flex items-center justify-between mt-3 pt-2 border-t text-xs font-medium ${
                quote.journalPreview.isBalanced
                  ? 'border-success/30 text-success'
                  : 'border-destructive/30 text-destructive'
              }`}
            >
              <span>Dr รวม = Cr รวม</span>
              <span className="font-mono">
                {formatNumberDecimal(quote.journalPreview.totalDebit)} ={' '}
                {formatNumberDecimal(quote.journalPreview.totalCredit)}{' '}
                {quote.journalPreview.isBalanced ? 'BALANCED' : 'UNBALANCED'}
              </span>
            </div>
          </div>
        )}

        {/* Section 4: สิ่งที่จะเกิดขึ้น */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="flex items-center justify-center size-8 rounded-lg bg-success/10 text-success">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="size-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                สิ่งที่จะเกิดขึ้นเมื่อยืนยัน
              </h3>
              <p className="text-xs text-muted-foreground">ตรวจสอบก่อนปิดสัญญา</p>
            </div>
          </div>
          <ul className="space-y-1.5 text-sm">
            <Effect text="โอนกรรมสิทธิ์สินค้าจาก FINANCE → ลูกค้า" />
            <Effect text="ออกใบเสร็จและหนังสือปิดสัญญา" />
            <Effect text="บันทึก JournalEntry (ตัด HP Receivable, รับรู้ดอกเบี้ย, VAT)" />
            <Effect text="แจ้งลูกค้าผ่าน LINE OA (ถ้าอนุญาต PDPA)" />
            <Effect text="ปลดล็อค MDM (PJ-Soft) — ต้องทำ manual" warning />
          </ul>
        </div>
      </div>

      {/* Footer */}
      <div className="sticky bottom-0 bg-background/95 backdrop-blur-xs border-t px-6 py-4 flex items-center justify-between gap-3">
        {/* Settlement button — visible to OWNER / FINANCE_MANAGER / ACCOUNTANT */}
        {canSettlement ? (
          <button
            type="button"
            onClick={() => {
              setSettlementRequestId(crypto.randomUUID());
              setSettlementOpen(true);
            }}
            className="flex items-center gap-1.5 px-4 py-2.5 text-sm border border-input rounded-lg hover:bg-muted transition-colors text-muted-foreground"
          >
            <Store className="size-4" />
            บันทึกรับโอนจากหน้าร้าน
          </button>
        ) : (
          <div />
        )}
        <div className="flex flex-wrap justify-end gap-3">
          <button
            onClick={onClose}
            className="min-h-11 px-6 text-sm border border-input rounded-lg hover:bg-muted transition-colors"
          >
            ยกเลิก
          </button>
          {collectedByShop || !slipMatched ? (
            <button
              onClick={() => setApprovalOpen(true)}
              disabled={!canSubmit}
              className={`min-h-11 px-6 text-sm rounded-lg font-semibold transition-colors shadow-sm disabled:opacity-50 ${
                slipResult && !collectedByShop
                  ? 'bg-warning text-warning-foreground hover:bg-warning/90'
                  : collectedByShop
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                    : 'border border-primary text-primary hover:bg-primary/10'
              }`}
            >
              {slipResult && !collectedByShop
                ? 'ส่งขออนุมัติ (แนบสลิปนี้)'
                : 'ส่งขออนุมัติปิดสัญญา'}
            </button>
          ) : null}
          {!collectedByShop && (
            <button
              onClick={() => {
                setConfirmChecked(false);
                setConfirmOpen(true);
              }}
              disabled={!slipMatched || !quote}
              title={slipMatched ? undefined : 'แนบสลิปที่ยอดตรงก่อน'}
              className="min-h-11 px-6 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-40 font-semibold transition-colors shadow-sm"
            >
              {slipMatched && quote
                ? `ปิดยอด ${formatNumber(quote.totalPayoff)} บาท`
                : 'ปิดยอดด้วยสลิป'}
            </button>
          )}
        </div>
      </div>

      {/* Settlement dialog — Dr cash / Cr 11-2107 when shop remits to FINANCE.
          Own trapped FocusScope: keeps Tab inside the popup (the payoff panel
          underneath stays mounted and tabbable otherwise); nested scopes pause
          the outer overlay's via Radix's scope stack. */}
      {/* ยืนยันก่อนลงบัญชี (mockup กระดาน 4) — ปิดสัญญา = ลงบัญชี ออกใบเสร็จ ปลดล็อกเครื่อง ย้อนได้ด้วยการยกเลิกใบเสร็จเท่านั้น */}
      {confirmOpen && slipResult && quote && (
        <div className="fixed inset-0 z-60 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <FocusScope asChild loop trapped>
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="payoff-confirm-title"
              className="w-full max-w-lg bg-background rounded-xl shadow-2xl p-6 space-y-4"
            >
              <div className="flex items-start gap-3">
                <div className="flex items-center justify-center size-10 rounded-lg bg-primary/10 text-primary shrink-0">
                  <Lock className="size-5" aria-hidden="true" />
                </div>
                <div className="leading-snug">
                  <h3 id="payoff-confirm-title" className="text-base font-semibold text-foreground">
                    ยืนยันปิดสัญญาก่อนกำหนด
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    ระบบจะลงบัญชี ออกใบเสร็จ และปลดล็อกเครื่องทันที —
                    ย้อนกลับได้ด้วยการยกเลิกใบเสร็จ (ต้องขออนุมัติ)
                  </p>
                </div>
              </div>
              <dl className="rounded-lg border border-border divide-y divide-border text-sm">
                <div className="flex justify-between gap-3 px-3 py-2">
                  <dt className="text-muted-foreground">สัญญา</dt>
                  <dd className="font-mono">{contractNumber}</dd>
                </div>
                <div className="flex justify-between gap-3 px-3 py-2">
                  <dt className="text-muted-foreground">ลูกค้า</dt>
                  <dd>{customerName}</dd>
                </div>
                <div className="flex justify-between gap-3 px-3 py-2">
                  <dt className="text-muted-foreground">
                    ยอดปิด ({quote.remainingMonths} งวด · ลด {discountPct}%)
                  </dt>
                  <dd className="font-semibold text-primary tabular-nums">
                    {formatNumber(quote.totalPayoff)} บาท
                  </dd>
                </div>
                <div className="flex justify-between gap-3 px-3 py-2">
                  <dt className="text-muted-foreground">รับเงินเข้า</dt>
                  <dd>11-1201 กสิกร · {formatDateShort(slipResult.paymentDate)}</dd>
                </div>
                <div className="flex justify-between gap-3 px-3 py-2">
                  <dt className="text-muted-foreground">หลักฐาน</dt>
                  <dd>สลิปตรวจแล้ว · อ้างอิง {slipResult.reading?.refNo ?? '—'}</dd>
                </div>
              </dl>
              <label className="flex items-start gap-2.5 text-sm leading-snug cursor-pointer">
                <input
                  type="checkbox"
                  checked={confirmChecked}
                  onChange={(e) => setConfirmChecked(e.target.checked)}
                  className="mt-0.5 size-4 accent-primary"
                />
                <span>ตรวจแล้วว่าสลิปเป็นของสัญญานี้และลูกค้ารายนี้จริง</span>
              </label>
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setConfirmOpen(false)}
                  disabled={confirmMutation.isPending}
                  className="min-h-11 px-5 text-sm border border-input rounded-lg hover:bg-muted"
                >
                  กลับไปแก้
                </button>
                <button
                  type="button"
                  onClick={() => slipResult.ticket && confirmMutation.mutate(slipResult.ticket)}
                  disabled={!confirmChecked || confirmMutation.isPending || !slipResult.ticket}
                  className="min-h-11 px-5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 font-semibold"
                >
                  {confirmMutation.isPending ? 'กำลังปิดสัญญา…' : 'ยืนยันปิดสัญญา'}
                </button>
              </div>
            </div>
          </FocusScope>
        </div>
      )}

      {/* ปิดสัญญาแล้ว (mockup กระดาน 6) */}
      {done && (
        <div className="fixed inset-0 z-60 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <FocusScope asChild loop trapped>
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="payoff-done-title"
              className="w-full max-w-md bg-background rounded-xl shadow-2xl p-6 flex flex-col items-center gap-4 text-center"
            >
              <div className="flex items-center justify-center size-16 rounded-full bg-primary/10 text-primary">
                <Check className="size-8" aria-hidden="true" />
              </div>
              <div className="leading-snug">
                <h3 id="payoff-done-title" className="text-lg font-semibold text-foreground">
                  ปิดสัญญาแล้ว
                </h3>
                <p className="text-sm text-muted-foreground">
                  ลงบัญชี ออกใบเสร็จ และปลดล็อกเครื่องเรียบร้อย · {formatDateShort(done.paidDate)}
                </p>
              </div>
              <dl className="w-full rounded-lg border border-border divide-y divide-border text-sm text-left">
                <div className="flex justify-between gap-3 px-3 py-2">
                  <dt className="text-muted-foreground">สัญญา</dt>
                  <dd className="font-mono">{contractNumber}</dd>
                </div>
                <div className="flex justify-between gap-3 px-3 py-2">
                  <dt className="text-muted-foreground">ยอดรับ</dt>
                  <dd className="font-semibold text-primary tabular-nums">
                    {formatNumber(done.totalPayoff)} บาท
                  </dd>
                </div>
                <div className="flex justify-between gap-3 px-3 py-2">
                  <dt className="text-muted-foreground">ผู้ทำรายการ</dt>
                  <dd>{user?.name ?? '—'} · ไม่ผ่านคิวอนุมัติ (สลิปตรง)</dd>
                </div>
              </dl>
              <p className="text-xs text-muted-foreground leading-snug">
                ใบเสร็จอยู่ในประวัติการชำระ — ส่ง/พิมพ์ได้จากที่นั่น
              </p>
              <button
                type="button"
                onClick={onClose}
                className="min-h-11 w-full px-5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 font-semibold"
              >
                กลับไปหน้าสัญญา
              </button>
            </div>
          </FocusScope>
        </div>
      )}

      {settlementOpen && (
        <div className="fixed inset-0 z-60 bg-black/50 backdrop-blur-xs flex items-center justify-center">
          <FocusScope asChild loop trapped>
            <div className="w-full max-w-sm bg-background rounded-xl shadow-2xl p-6 space-y-4">
              <div className="flex items-center gap-2.5">
                <div className="flex items-center justify-center size-8 rounded-lg bg-primary/10 text-primary">
                  <Store className="size-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground leading-snug">
                    บันทึกรับโอนจากหน้าร้าน
                  </h3>
                  <p className="text-xs text-muted-foreground leading-snug">
                    Dr บัญชีรับเงิน / Cr 11-2107 ลูกหนี้-หน้าร้าน
                  </p>
                </div>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">
                    บัญชีรับเงิน (FINANCE) <span className="text-destructive">*</span>
                  </label>
                  <CashAccountSelect
                    value={settlementAccountCode}
                    onChange={setSettlementAccountCode}
                    codes={KBANK_ONLY_CODES}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">
                    จำนวนเงินที่รับโอน <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="number"
                    min={0.01}
                    step={0.01}
                    value={settlementAmount}
                    onChange={(e) => setSettlementAmount(e.target.value)}
                    className="w-full px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 outline-hidden"
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setSettlementOpen(false)}
                  disabled={settlementMutation.isPending}
                  className="px-4 py-2 text-sm border border-input rounded-lg hover:bg-muted transition-colors"
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  onClick={() => settlementMutation.mutate()}
                  disabled={
                    settlementMutation.isPending ||
                    !settlementAccountCode ||
                    !settlementAmount ||
                    Number(settlementAmount) <= 0
                  }
                  className="px-5 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 font-semibold transition-colors"
                >
                  {settlementMutation.isPending ? 'กำลังบันทึก...' : 'ยืนยัน'}
                </button>
              </div>
            </div>
          </FocusScope>
        </div>
      )}
    </WizardStackedOverlay>
  );
}

/* ─── Helpers ─────────────────────────────────────── */
function Row({
  label,
  value,
  bold,
  muted,
  success,
  destructive,
}: {
  label: string;
  value: string;
  bold?: boolean;
  muted?: boolean;
  success?: boolean;
  destructive?: boolean;
}) {
  const valueClass = [
    bold ? 'font-semibold text-foreground' : '',
    muted ? 'text-muted-foreground' : '',
    success ? 'text-success font-medium' : '',
    destructive ? 'text-destructive font-medium' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="flex justify-between items-baseline">
      <span className={muted ? 'text-muted-foreground' : 'text-muted-foreground'}>{label}</span>
      <span className={valueClass || 'text-foreground'}>{value}</span>
    </div>
  );
}

function Effect({ text, warning }: { text: string; warning?: boolean }) {
  return (
    <li className="flex items-start gap-2">
      <span className={warning ? 'text-warning-strong' : 'text-success'}>
        {warning ? (
          <AlertTriangle className="size-4 inline" />
        ) : (
          <Check className="size-4 inline" />
        )}
      </span>
      <span className={warning ? 'text-warning-strong' : 'text-foreground'}>{text}</span>
    </li>
  );
}
