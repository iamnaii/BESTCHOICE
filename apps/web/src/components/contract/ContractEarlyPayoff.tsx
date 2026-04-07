import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { formatNumber } from '@/utils/formatters';

/* ─── Types ───────────────────────────────────────── */
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
          <div className="text-xl font-bold text-primary">{formatNumber(payoffQuote.totalPayoff)} บาท</div>
        </div>
      </div>
    </div>
  );
}

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
  const [discountPct, setDiscountPct] = useState(50);
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [referenceNo, setReferenceNo] = useState('');
  const [notes, setNotes] = useState('');

  const { data: quote, isLoading } = useQuery<EarlyPayoffQuote>({
    queryKey: ['contract-payoff', contractId, discountPct],
    queryFn: async () => {
      const { data } = await api.get(`/contracts/${contractId}/early-payoff-quote?discountPct=${discountPct}`);
      return data;
    },
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/contracts/${contractId}/early-payoff`, {
        paymentMethod,
        discountPct,
        paymentDate,
        referenceNo: referenceNo || undefined,
        notes: notes || undefined,
      });
      return data;
    },
    onSuccess: () => {
      toast.success('ปิดสัญญาก่อนกำหนดสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['contract', contractId] });
      queryClient.invalidateQueries({ queryKey: ['contract-payoff', contractId] });
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
      onSuccess();
      onClose();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const inputClass =
    'w-full px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 outline-none';

  const needsReference = paymentMethod !== 'CASH';
  const canSubmit = !!quote && !mutation.isPending && (!needsReference || referenceNo.trim().length > 0);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-start justify-center pt-8 pb-8">
      <div className="w-full max-w-2xl bg-background rounded-xl shadow-2xl overflow-y-auto max-h-[calc(100vh-4rem)]">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b px-6 py-4 flex items-center justify-between">
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
                <svg xmlns="http://www.w3.org/2000/svg" className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">ข้อมูลสัญญา</h3>
                <p className="text-xs text-muted-foreground">เลขที่, ลูกค้า, สินค้า</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <div><span className="text-muted-foreground">สัญญา: </span><span className="font-mono font-semibold">{contractNumber}</span></div>
              <div><span className="text-muted-foreground">ลูกค้า: </span><span className="font-medium">{customerName}</span></div>
              {productName && <div><span className="text-muted-foreground">สินค้า: </span><span className="font-medium">{productName}</span></div>}
              {branchName && <div><span className="text-muted-foreground">สาขา: </span><span className="font-medium">{branchName}</span></div>}
            </div>
          </div>

          {/* Section 2: คำนวณยอดปิดสัญญา */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="flex items-center justify-center size-8 rounded-lg bg-violet-500/10 text-violet-500">
                <svg xmlns="http://www.w3.org/2000/svg" className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">คำนวณยอดปิดสัญญา</h3>
                <p className="text-xs text-muted-foreground">เลือก % ส่วนลดเพื่อ recalc</p>
              </div>
            </div>

            {/* Discount selector */}
            <div className="mb-4">
              <label className="block text-xs font-medium text-foreground mb-1.5">ส่วนลดบนกำไรขั้นต้น</label>
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
                  onChange={(e) => setDiscountPct(Math.max(0, Math.min(MAX_DISCOUNT, Number(e.target.value))))}
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
                  <Row label="ยอดชำระล่วงหน้า" value={`-${formatNumber(quote.advancePayment)} บาท`} muted />
                )}
                <Row label="คงเหลือยอดค้าง" value={`${formatNumber(quote.remainingBalance)} บาท`} bold />
                <div className="border-t border-border my-2" />
                <Row label="ค่างวดไม่รวม VAT (1)" value={`${formatNumber(quote.remainingExVat)} บาท`} />
                <Row label="ต้นทุนยอดค้างชำระ (2)" value={`${formatNumber(quote.remainingCost)} บาท`} />
                <Row label="(1) − (2)" value={`${formatNumber(quote.grossProfit)} บาท`} />
                <Row label={`ส่วนลดลูกค้า ${discountPct}%`} value={`-${formatNumber(quote.discountAmount)} บาท`} success />
                {quote.unpaidLateFees > 0 && (
                  <Row label="ค่าปรับค้างชำระ" value={`+${formatNumber(quote.unpaidLateFees)} บาท`} destructive />
                )}
                <div className="border-t border-primary/30 my-2" />
                <div className="flex justify-between items-center bg-primary/5 rounded-lg px-3 py-3">
                  <span className="text-base font-semibold text-primary">ยอดชำระปิดยอด</span>
                  <span className="text-2xl font-bold text-primary">{formatNumber(quote.totalPayoff)} บาท</span>
                </div>
              </div>
            )}
          </div>

          {/* Section 3: รับชำระ */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="flex items-center justify-center size-8 rounded-lg bg-orange-500/10 text-orange-500">
                <svg xmlns="http://www.w3.org/2000/svg" className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">รับชำระ</h3>
                <p className="text-xs text-muted-foreground">วิธีชำระ, วันที่, อ้างอิง</p>
              </div>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">วิธีชำระ <span className="text-destructive">*</span></label>
                  <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className={inputClass}>
                    <option value="CASH">เงินสด</option>
                    <option value="BANK_TRANSFER">โอนเงิน</option>
                    <option value="QR_EWALLET">QR/E-Wallet</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">วันที่ชำระ</label>
                  <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className={inputClass} />
                </div>
              </div>
              {needsReference && (
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">
                    เลขที่อ้างอิง / Ref <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="text"
                    value={referenceNo}
                    onChange={(e) => setReferenceNo(e.target.value)}
                    className={inputClass}
                    placeholder="เลขที่อ้างอิงจากสลิป"
                  />
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">หมายเหตุ</label>
                <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} placeholder="หมายเหตุเพิ่มเติม (ถ้ามี)" />
              </div>
            </div>
          </div>

          {/* Section 4: สิ่งที่จะเกิดขึ้น */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="flex items-center justify-center size-8 rounded-lg bg-emerald-500/10 text-emerald-500">
                <svg xmlns="http://www.w3.org/2000/svg" className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">สิ่งที่จะเกิดขึ้นเมื่อยืนยัน</h3>
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
        <div className="sticky bottom-0 bg-background/95 backdrop-blur-sm border-t px-6 py-4 flex justify-end gap-3">
          <button onClick={onClose} className="px-6 py-2.5 text-sm border border-input rounded-lg hover:bg-muted transition-colors">
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
    </div>
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
      <span className={warning ? 'text-warning' : 'text-emerald-500'}>{warning ? '⚠' : '✓'}</span>
      <span className={warning ? 'text-warning' : 'text-foreground'}>{text}</span>
    </li>
  );
}
