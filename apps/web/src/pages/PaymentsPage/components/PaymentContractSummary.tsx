import Decimal from 'decimal.js';
import { AlertCircle, CheckCircle2, Info, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatThaiDate } from '@/lib/date';
import type { PendingPayment } from '../types';

/**
 * Auto-detected payment case (computed from amount diff client-side).
 * RESCHEDULE / EARLY_PAYOFF are handled in separate contract-detail pages, not here.
 */
export type DetectedCase =
  | 'NORMAL'
  | 'OVERPAY'
  | 'UNDERPAY'
  | 'OVERPAY_ADVANCE'
  | 'PARTIAL'
  | 'OUT_OF_RANGE';

// ─── Contract info panel ──────────────────────────────────────────────────────

export function ContractInfoPanel({
  payment,
  lateFee,
  lateFeePaid,
  netExposure,
  onOpenPayoff,
}: {
  payment: PendingPayment;
  lateFee: Decimal;
  lateFeePaid: Decimal;
  netExposure: Decimal;
  onOpenPayoff: () => void;
}) {
  const amountDue = new Decimal(payment.amountDue);
  const amountPaid = new Decimal(payment.amountPaid);
  const totalDue = amountDue.add(lateFee).sub(amountPaid).toDecimalPlaces(2);
  const receiptLateFee = Decimal.max(lateFee.minus(lateFeePaid), 0);
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
      {row(
        'เลขสัญญา',
        <span className="font-mono text-xs">{payment.contract.contractNumber}</span>,
      )}
      {row('ชื่อลูกค้า', payment.contract.customer.name)}
      {row('งวดที่', `งวดที่ ${payment.installmentNo}`)}
      {row('วันครบกำหนด', formatThaiDate(payment.dueDate), isOverdue)}
      {row(
        'ค่างวด',
        `${amountDue.toNumber().toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿`,
      )}
      {row(
        'ค่าปรับที่รับครั้งนี้',
        `${receiptLateFee.toNumber().toLocaleString('th-TH', { minimumFractionDigits: 2 })} ฿`,
        receiptLateFee.gt(0),
      )}
      {lateFeePaid.gt(0) && row('ค่าปรับที่รับแล้ว', `${lateFeePaid.toFixed(2)} ฿`)}
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
              isOverdue ? 'bg-destructive/10 text-destructive' : 'bg-success/10 text-success',
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

export function CaseBadge({
  detectedCase,
  diff,
  received,
}: {
  detectedCase: DetectedCase;
  diff: number;
  received: number;
}) {
  const absDiff = Math.abs(diff).toLocaleString('th-TH', { minimumFractionDigits: 2 });

  // Important-1 (re-review 2026-08-18): เครดิต/เงินพักคลุมยอดงวดทั้งงวด → ไม่มีเงินสด
  // ต้องรับจริง. ระบบหลังบ้าน **ไม่รับ** ใบเสร็จยอด 0 (RecordPaymentDto @Min(0.01)
  // + ด่านใน orchestrator) ซึ่งเป็นกติกาเดิมที่คุ้มครองทุกเส้นทางการชำระ — จึงบอกตรงๆ
  // ตรงนี้แทนที่จะปล่อยให้กดแล้วเด้ง 400. งวดนี้จะถูกตัดด้วยเครดิตเองตอนตั้งค้างรับ (2A).
  if (received <= 0 && detectedCase === 'NORMAL') {
    return (
      <div className="flex items-start gap-1.5 rounded-lg border border-info/40 bg-info/5 px-3 py-2 text-sm">
        <Info className="size-4 text-info shrink-0 mt-0.5" />
        <span className="text-info font-medium leading-snug">
          เครดิตคงเหลือคลุมยอดงวดนี้ทั้งงวด — ไม่ต้องเก็บเงินสด ระบบจะตัดเครดิตให้อัตโนมัติ
          เมื่อถึงกำหนดงวด (ไม่ต้องบันทึกรับชำระยอด 0 บาท)
        </span>
      </div>
    );
  }

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
