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
}

/**
 * Shown when contract.advanceBalance > 0. The checkbox controls whether the
 * parked advance (21-1103) is auto-deducted on save: checked → collect only the
 * net; unchecked → collect the full owed and keep the credit for next time.
 */
export function AdvanceBalanceBanner({ amountDue, advanceBalance, consumeAdvance, onToggle }: Props) {
  if (advanceBalance.lte(0)) return null;
  const netDue = Decimal.max(new Decimal(0), amountDue.minus(advanceBalance));

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
          มีเครดิตคงเหลือ {advanceBalance.toFixed(2)} ฿
        </div>
        <div className="text-xs text-muted-foreground leading-snug">
          จากชำระงวดก่อนเกิน · พักใน 21-1103 ·{' '}
          {consumeAdvance ? 'ระบบจะหักอัตโนมัติ' : 'ไม่หัก — เก็บไว้งวดถัดไป'}
        </div>
        <div className="text-xs leading-snug">
          {consumeAdvance ? (
            <span className="text-primary font-medium">
              หักแล้ว เหลือเก็บ {netDue.toFixed(2)} ฿
            </span>
          ) : (
            <span className="text-muted-foreground">
              เก็บเต็ม {amountDue.toFixed(2)} ฿
            </span>
          )}
        </div>
      </div>
    </label>
  );
}
