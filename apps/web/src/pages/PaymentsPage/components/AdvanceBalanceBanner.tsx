import { Wallet } from 'lucide-react';
import Decimal from 'decimal.js';

interface Props {
  amountDue: Decimal;
  advanceBalance: Decimal;
  onApply: (netDue: string) => void;
}

/**
 * Shown when contract.advanceBalance > 0. Displays the auto-FIFO calculation
 * and a one-tap "use this amount" button to set amountReceived = installment - advance.
 */
export function AdvanceBalanceBanner({ amountDue, advanceBalance, onApply }: Props) {
  if (advanceBalance.lte(0)) return null;
  const netDue = Decimal.max(new Decimal(0), amountDue.minus(advanceBalance));

  return (
    <div className="rounded-lg border border-success/40 bg-success/5 p-3 space-y-1">
      <div className="flex items-center gap-2 text-sm font-medium text-success">
        <Wallet className="size-4" />
        <span>ลูกค้ามีเงินล่วงหน้า {advanceBalance.toFixed(2)} ฿</span>
      </div>
      <div className="text-xs text-muted-foreground leading-snug">
        ค่างวด {amountDue.toFixed(2)} − ล่วงหน้า {advanceBalance.toFixed(2)} = ยอดที่ต้องเก็บ{' '}
        {netDue.toFixed(2)} ฿
      </div>
      <button
        type="button"
        onClick={() => onApply(netDue.toFixed(2))}
        className="text-xs underline text-primary hover:no-underline"
      >
        ใช้ยอดนี้
      </button>
    </div>
  );
}
