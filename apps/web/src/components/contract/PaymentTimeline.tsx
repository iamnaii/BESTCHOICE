interface Payment {
  id: string;
  installmentNo: number;
  dueDate: string;
  amountDue: string;
  amountPaid: string | null;
  lateFee: string;
  status: string;
  paidDate: string | null;
}

interface PaymentProgressOverviewProps {
  payments: Payment[];
}

/**
 * Progress overview — summary of payment progress (count + progress bar + status legend)
 */
export default function PaymentProgressOverview({ payments }: PaymentProgressOverviewProps) {
  if (payments.length === 0) return null;

  const paid = payments.filter((p) => p.status === 'PAID').length;
  const overdue = payments.filter((p) => p.status === 'OVERDUE').length;
  const partial = payments.filter((p) => p.status === 'PARTIALLY_PAID').length;
  const total = payments.length;
  const progressPct = total > 0 ? (paid / total) * 100 : 0;

  return (
    <div className="bg-card rounded-xl border border-border p-5 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-foreground">ความคืบหน้าการผ่อน</h4>
        <span className="text-2sm text-muted-foreground">
          {paid}/{total} งวด ({progressPct.toFixed(0)}%)
        </span>
      </div>

      <div className="h-3 bg-muted rounded-full overflow-hidden mb-3">
        <div
          className="h-full bg-success rounded-full transition-all duration-700 ease-out"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      <div className="flex gap-4 text-xs flex-wrap">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-success" />
          ชำระแล้ว {paid}
        </span>
        {overdue > 0 && (
          <span className="flex items-center gap-1.5 text-destructive">
            <span className="size-2 rounded-full bg-destructive" />
            เกินกำหนด {overdue}
          </span>
        )}
        {partial > 0 && (
          <span className="flex items-center gap-1.5 text-warning">
            <span className="size-2 rounded-full bg-warning" />
            ชำระบางส่วน {partial}
          </span>
        )}
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <span className="size-2 rounded-full bg-muted-foreground/30" />
          รอชำระ {total - paid - overdue - partial}
        </span>
      </div>
    </div>
  );
}
