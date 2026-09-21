import { formatDateShort, formatNumberDecimal } from '@/utils/formatters';
import type { JeReceiptLabel } from './paymentHistoryDerivations';

export interface ContractJeLine {
  accountCode: string;
  accountName: string;
  debit: string;
  credit: string;
  description: string;
}

export interface ContractJe {
  id: string;
  entryNumber: string;
  entryDate: string;
  postedAt: string | null;
  description: string;
  paymentId: string | null;
  tag: string | null;
  flow: string | null;
  deltaApplied: string | null;
  lateFeePortion: string | null;
  /** Original JE that has since been mirrored out by a receipt void. */
  reversed: boolean;
  reversedByEntryNumber: string | null;
  /** Set on receipt-void REVERSAL JEs — points at the original entry id. */
  originalEntryId: string | null;
  lines: ContractJeLine[];
  totalDebit: string;
  totalCredit: string;
  isBalanced: boolean;
}

const money = (n: number | string) => formatNumberDecimal(n, 2);

export type JeLabelTone = 'default' | 'destructive';
export interface JeFlowLabel {
  label: string;
  tone: JeLabelTone;
}

type Rule = [test: (flow: string, tag: string) => boolean, label: string];

/**
 * ป้ายประเภท JE จาก metadata.flow (ดูก่อน) / metadata.tag — ครอบทุก flow ที่ template
 * ในระบบ stamp (spec 2026-09-05 §4.3). ลำดับกฎสำคัญ: `exchange-ecl-reversal` ต้องมาก่อน
 * `exchange-*`; กลับรายการเช็คก่อนทุกกฎ.
 */
const RULES: Rule[] = [
  [(f) => f === 'early-payoff', 'JP4 — ปิดยอดก่อนกำหนด'],
  [(f) => f === 'repossession', 'JP5 — ยึดเครื่อง'],
  [(f) => f === 'refund-payout', 'จ่ายเงินคืนส่วนต่างลูกค้า'],
  [(f) => f === 'refund-waive', 'ไม่คืนเงินส่วนต่าง → รายได้ยึด'],
  [(f) => f === 'shop-repossession-intake', 'SHOP — รับเครื่องยึดเข้าสต็อก'],
  [(f) => f === 'shop-collect-settlement-shop', 'SHOP — โอนให้ FINANCE (ล้าง S21-1104)'],
  [(f) => f === 'interco-recall-cash-shop', 'SHOP — คืนเงินเรียกคืนให้ FINANCE'],
  [(f) => f === 'shop-collect-settlement', 'รับโอนจากหน้าร้าน (ล้าง 11-2107)'],
  [(f, t) => t === '1A' || f === 'exchange-new-contract-1a', 'เปิดสัญญา (1A)'],
  [(f, t) => t === '2A' || f === 'accrual', 'รับรู้รายได้งวด (2A)'],
  [
    (f, t) =>
      t === '2B' || t === 'receipt' || f === 'payment-receipt' || f.startsWith('2b-receipt'),
    'รับชำระ (2B)',
  ],
  [
    (_f, t) =>
      t === 'credit-allocation' ||
      t === 'overpayment-credit' ||
      t === 'paysolutions-surplus-advance',
    'เครดิต/จ่ายเกิน',
  ],
  [(f) => f === 'stage-reverse' || f === 'exchange-ecl-reversal', 'กลับค่าเผื่อหนี้'],
  [
    (f, t) => f === 'provision' || f === 'write-off' || t === 'BAD-DEBT',
    'ค่าเผื่อหนี้ / ตัดหนี้สูญ',
  ],
  [(f, t) => f.startsWith('reschedule') || t === '6a' || t === '6b', 'ปรับดิว (JP6)'],
  [(f, t) => f === 'mandatory' || t.startsWith('VAT60'), 'VAT 60 วัน'],
  [(f) => f.startsWith('shop-inventory-transfer'), 'SHOP — โอนกรรมสิทธิ์/รายได้'],
  [(f) => f.startsWith('shop-down-payment'), 'SHOP — เงินดาวน์'],
  [(f) => f === 'shop-exchange-return', 'SHOP — รับเครื่องคืน'],
  [(f) => f === 'shop-cash-sale', 'SHOP — ขายสด'],
  [(f) => f.startsWith('shop-external-finance'), 'SHOP — ไฟแนนซ์ภายนอก'],
  [(f) => f.startsWith('exchange-'), 'เปลี่ยนเครื่อง'],
];

const REVERSAL_FLOWS = new Set([
  'receipt-void',
  'reversal',
  'refund-reversal',
  'shop-cash-sale-void',
  'exchange-cancel',
  'contract-cancellation',
]);

export function journalFlowLabel(je: Pick<ContractJe, 'flow' | 'tag'>): JeFlowLabel {
  const flow = je.flow ?? '';
  const tag = je.tag ?? '';
  // ใบ void ใบเสร็จ = ป้ายเดิมของ PaymentHistorySheet ทุกไบต์; mirror จาก sweep engine
  // (ยกเลิกสัญญา/เปลี่ยนเครื่อง/รอบจ่าย) stamp tag REVERSAL เหมือนกันแต่ไม่ใช่ VOID
  if (flow === 'receipt-void') return { label: 'กลับรายการ (VOID)', tone: 'destructive' };
  if (tag === 'REVERSAL' || REVERSAL_FLOWS.has(flow) || flow.endsWith('-batch-reverse')) {
    return { label: 'กลับรายการ', tone: 'destructive' };
  }
  for (const [test, label] of RULES) {
    if (test(flow, tag)) return { label, tone: 'default' };
  }
  return { label: tag || flow || 'อื่น ๆ', tone: 'default' };
}

/** One posted JE rendered as a Dr/Cr grid — same layout as the JOURNAL AUTO
 * section in ContractEarlyPayoff (grid-cols-[80px_1fr_90px_90px]). */
export function JeBlock({
  je,
  receiptLabel,
  openedReceiptNumber,
}: {
  je: ContractJe;
  /** ใบเสร็จเจ้าของ JE ใบนี้ (undefined = จับคู่ไม่ได้/งวดใบเดียว — ไม่ติดป้าย) */
  receiptLabel?: JeReceiptLabel;
  openedReceiptNumber?: string;
}) {
  const { label: flowLabel, tone } = journalFlowLabel(je);
  const isVoidReversal = tone === 'destructive';
  // ป้ายเฉพาะงวดแบ่งชำระ (>1 ใบ) — บอกว่า JE นี้เป็นของใบเสร็จใบไหน กันอ่านสับสน
  // ว่าค่าปรับไปลงใบหลัง (คำสั่งเจ้าของ 2026-08-16 — ค่าปรับลง "ใบแรก" เสมอ FEE-FIRST)
  const showReceiptTag = !isVoidReversal && receiptLabel && receiptLabel.total > 1;
  const isOpenedReceipt = showReceiptTag && receiptLabel.receiptNumber === openedReceiptNumber;
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-xs leading-snug flex-wrap">
          <span className="font-mono font-semibold text-foreground">{je.entryNumber}</span>
          {showReceiptTag && (
            <span
              className={`px-1.5 py-0.5 rounded-full font-medium ${
                isOpenedReceipt ? 'bg-info/10 text-info' : 'bg-muted text-muted-foreground'
              }`}
            >
              <span className="font-mono">{receiptLabel.receiptNumber}</span> · ใบที่{' '}
              {receiptLabel.seq}/{receiptLabel.total}
              {isOpenedReceipt ? ' (ใบนี้)' : ''}
            </span>
          )}
          <span className="text-muted-foreground">
            {formatDateShort(je.postedAt ?? je.entryDate)}
          </span>
          <span
            className={`px-1.5 py-0.5 rounded-full font-medium ${
              isVoidReversal ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary'
            }`}
          >
            {flowLabel}
          </span>
          {je.reversed && (
            <span className="px-1.5 py-0.5 rounded-full bg-warning/10 text-warning-strong font-medium">
              ถูกกลับรายการ{je.reversedByEntryNumber ? ` โดย ${je.reversedByEntryNumber}` : ''}
            </span>
          )}
          {je.deltaApplied && (
            <span className="text-muted-foreground">รับจริง {money(je.deltaApplied)} ฿</span>
          )}
          {je.lateFeePortion && Number(je.lateFeePortion) > 0 && (
            <span className="text-warning-strong">ค่าปรับ {money(je.lateFeePortion)} ฿</span>
          )}
        </div>
        <span
          className={`text-xs font-medium leading-snug ${je.isBalanced ? 'text-success' : 'text-destructive'}`}
        >
          {money(je.totalDebit)} = {money(je.totalCredit)}{' '}
          {je.isBalanced ? 'BALANCED' : 'UNBALANCED'}
        </span>
      </div>
      <div className="space-y-1">
        <div className="grid grid-cols-[80px_1fr_90px_90px] gap-1 text-xs text-muted-foreground font-medium pb-1 border-b border-border">
          <span>รหัส</span>
          <span>บัญชี</span>
          <span className="text-right">Dr</span>
          <span className="text-right">Cr</span>
        </div>
        {je.lines.map((line, idx) => (
          <div key={idx} className="grid grid-cols-[80px_1fr_90px_90px] gap-1 text-xs leading-snug">
            <span className="font-mono text-muted-foreground">{line.accountCode}</span>
            <div className="min-w-0">
              <span className="text-foreground truncate block">{line.accountName}</span>
              {line.description && (
                <span className="text-muted-foreground/70 text-[10px]">{line.description}</span>
              )}
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
    </div>
  );
}
