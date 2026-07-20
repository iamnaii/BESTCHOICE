import { useState } from 'react';
import { FocusScope } from '@radix-ui/react-focus-scope';
import { WizardStackedOverlay } from '@/components/WizardStackedOverlay';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Check, Store } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import { formatNumber, formatNumberDecimal } from '@/utils/formatters';
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
  // Owner rule 2026-07-08: direct FINANCE receipt = ธนาคารกสิกร (11-1201) only.
  const [depositAccountCode, setDepositAccountCode] = useState('11-1201');
  // BKK-aware today — toISOString() is UTC and yields "yesterday" before 07:00 น. (PR #1327 bug class)
  const [paymentDate, setPaymentDate] = useState(bkkToday);
  const [notes, setNotes] = useState('');
  // Shop-collect toggle — when true, FINANCE books Dr 11-2107 instead of a cash account
  const [collectedByShop, setCollectedByShop] = useState(false);
  // Settlement dialog state
  const [settlementOpen, setSettlementOpen] = useState(false);
  const [settlementAccountCode, setSettlementAccountCode] = useState('11-1201');
  const [settlementAmount, setSettlementAmount] = useState('');

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

  const mutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/contracts/${contractId}/early-payoff`, {
        // วิธีชำระตายตัว — เงินเข้า FINANCE ตรงมีทางเดียวคือโอนเข้ากสิกร (owner
        // rule 2026-07-08); เงินสด/เครื่องอยู่หน้าร้านใช้ collectedByShop แทน
        // (UI ตัด dropdown ออกให้เหมือนจอคืนเครื่อง — owner 2026-07-20)
        paymentMethod: 'BANK_TRANSFER',
        discountPct,
        depositAccountCode,
        collectedByShop,
        // Cleared input = '' → omit so the server defaults to today (an empty
        // string fails @IsDateString with a 400)
        paymentDate: paymentDate || undefined,
        notes: notes || undefined,
      });
      return data;
    },
    onSuccess: () => {
      toast.success('ปิดสัญญาก่อนกำหนดสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['contract', contractId] });
      queryClient.invalidateQueries({ queryKey: ['contract-payoff', contractId] });
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
      // Payoff flips payments to PAID + posts the JP4 JE — refresh the
      // payment-history caches (contract-payments/receipts/journal-entries)
      // so the ประวัติการชำระ modal on ContractDetailPage isn't served stale.
      invalidatePaymentQueries(queryClient);
      onSuccess();
      onClose();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const settlementMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/contracts/${contractId}/shop-collect-settlement`, {
        depositAccountCode: settlementAccountCode,
        amount: Number(settlementAmount),
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

  const inputClass =
    'w-full px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 outline-hidden';

  const canSubmit = !!quote && !mutation.isPending;

  return (
    <WizardStackedOverlay maxWidthClass="max-w-2xl">
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
                  onClick={() => setDiscountPct(p)}
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
                  setDiscountPct(Math.max(0, Math.min(MAX_DISCOUNT, Number(e.target.value))))
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

        {/* Section 3: รับชำระ */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="flex items-center justify-center size-8 rounded-lg bg-warning/10 text-warning">
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
              <p className="text-xs text-muted-foreground">วันที่, บัญชีรับเงิน</p>
            </div>
          </div>
          <div className="space-y-4">
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
            {/* Shop-collect toggle */}
            <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 px-3 py-3">
              <input
                id="collected-by-shop"
                type="checkbox"
                checked={collectedByShop}
                onChange={(e) => setCollectedByShop(e.target.checked)}
                className="mt-0.5 size-4 accent-primary cursor-pointer"
              />
              <label htmlFor="collected-by-shop" className="cursor-pointer select-none">
                <span className="flex items-center gap-1.5 text-sm font-medium text-foreground leading-snug">
                  <Store className="size-3.5 shrink-0 text-primary" />
                  เก็บที่หน้าร้าน
                </span>
                <span className="text-xs text-muted-foreground leading-snug">
                  หน้าร้านรับเงินแล้วโอนเข้า FINANCE ภายหลัง (บันทึก Dr 11-2107 ลูกหนี้-หน้าร้าน)
                </span>
              </label>
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">
                บัญชีรับเงิน <span className="text-destructive">*</span>
              </label>
              <CashAccountSelect
                value={depositAccountCode}
                onChange={setDepositAccountCode}
                disabled={collectedByShop}
                codes={KBANK_ONLY_CODES}
              />
              {collectedByShop && (
                <p className="mt-1 text-xs text-muted-foreground leading-snug">
                  บัญชีถูกกำหนดเป็น 11-2107 อัตโนมัติโดยระบบ — กรอกบัญชีรับโอนจากหน้าร้านตอน
                  settlement
                </p>
              )}
            </div>
          </div>
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
            onClick={() => setSettlementOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2.5 text-sm border border-input rounded-lg hover:bg-muted transition-colors text-muted-foreground"
          >
            <Store className="size-4" />
            บันทึกรับโอนจากหน้าร้าน
          </button>
        ) : (
          <div />
        )}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="px-6 py-2.5 text-sm border border-input rounded-lg hover:bg-muted transition-colors"
          >
            ยกเลิก
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!canSubmit}
            className="px-6 py-2.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 font-semibold transition-colors shadow-sm"
          >
            {mutation.isPending ? 'กำลังปิด...' : 'ยืนยันปิดสัญญา'}
          </button>
        </div>
      </div>

      {/* Settlement dialog — Dr cash / Cr 11-2107 when shop remits to FINANCE.
          Own trapped FocusScope: keeps Tab inside the popup (the payoff panel
          underneath stays mounted and tabbable otherwise); nested scopes pause
          the outer overlay's via Radix's scope stack. */}
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
      <span className={warning ? 'text-warning' : 'text-success'}>
        {warning ? (
          <AlertTriangle className="size-4 inline" />
        ) : (
          <Check className="size-4 inline" />
        )}
      </span>
      <span className={warning ? 'text-warning' : 'text-foreground'}>{text}</span>
    </li>
  );
}
