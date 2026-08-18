import Decimal from 'decimal.js';

interface Props {
  /** Owed this installment = amountDue + lateFee − amountPaid. */
  amountDue: Decimal;
  /** Parked advance (21-1103) available to deduct. */
  advanceBalance: Decimal;
  /** Whether the cashier wants the advance auto-deducted on save. */
  consumeAdvance: boolean;
  /** Toggle the deduction. */
  onToggle: (next: boolean) => void;
  /**
   * พักงวดสุดท้าย — reschedule-fee (6a/6b) prepayment, separate from advanceBalance.
   * Only shown/consumed when `isLastInstallment` is true (owner directive 2026-08-16).
   */
  rescheduleAdvanceBalance?: Decimal;
  /** Whether the installment being paid is the contract's LAST installment. */
  isLastInstallment?: boolean;
}

/**
 * Shown when contract.advanceBalance > 0 (or, on the last installment, when
 * rescheduleAdvanceBalance > 0). The checkbox controls whether the parked
 * advance (21-1103) is auto-deducted on save: checked → collect only the net;
 * unchecked → collect the full owed and keep the credit for next time.
 */
export function AdvanceBalanceBanner({
  amountDue,
  advanceBalance,
  consumeAdvance,
  onToggle,
  rescheduleAdvanceBalance = new Decimal(0),
  isLastInstallment = false,
}: Props) {
  const park = isLastInstallment ? rescheduleAdvanceBalance : new Decimal(0);
  const totalCredit = advanceBalance.plus(park);
  if (totalCredit.lte(0)) return null;
  const netDue = Decimal.max(new Decimal(0), amountDue.minus(totalCredit));

  // Join with ' · ' instead of prefixing each optional fragment — a hard-coded
  // leading '·' rendered a stray dot whenever the generic bucket was empty and
  // only the park bucket had money ("· พักงวดสุดท้าย 354.00 ฿ · พักใน 21-1103").
  const detailParts = [
    advanceBalance.gt(0) ? `จากชำระงวดก่อนเกิน ${advanceBalance.toFixed(2)} ฿` : null,
    park.gt(0) ? `พักงวดสุดท้าย ${park.toFixed(2)} ฿` : null,
    'พักใน 21-1103',
    consumeAdvance ? 'ระบบจะหักอัตโนมัติ' : 'ไม่หัก — เก็บไว้งวดถัดไป',
  ].filter((part): part is string => part !== null);

  return (
    <label className="flex items-start gap-2.5 rounded-lg border border-primary/40 bg-primary/5 p-3 cursor-pointer">
      <input
        type="checkbox"
        checked={consumeAdvance}
        onChange={(e) => onToggle(e.target.checked)}
        className="mt-0.5 size-4 shrink-0 accent-primary"
        aria-label="หักเครดิตคงเหลืออัตโนมัติ"
      />
      <div className="min-w-0 space-y-0.5">
        <div className="text-sm font-medium text-foreground leading-snug">
          มีเครดิตคงเหลือ {totalCredit.toFixed(2)} ฿
        </div>
        <div className="text-xs text-muted-foreground leading-snug">{detailParts.join(' · ')}</div>
        <div className="text-xs leading-snug">
          {consumeAdvance ? (
            <span className="text-primary font-medium">
              หักแล้ว เหลือเก็บ {netDue.toFixed(2)} ฿
            </span>
          ) : (
            <span className="text-muted-foreground">เก็บเต็ม {amountDue.toFixed(2)} ฿</span>
          )}
        </div>
      </div>
    </label>
  );
}
