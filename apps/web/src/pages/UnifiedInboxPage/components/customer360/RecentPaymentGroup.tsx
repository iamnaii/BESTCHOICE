import { useState } from 'react';
import { Banknote, Landmark, QrCode, CreditCard, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import type { PaymentSummaryItem } from './types';

const paymentMethodMeta: Record<
  string,
  { label: string; icon: typeof Banknote; className: string }
> = {
  CASH: { label: 'เงินสด', icon: Banknote, className: 'bg-success/10 text-success' },
  BANK_TRANSFER: { label: 'โอน', icon: Landmark, className: 'bg-info/10 text-info' },
  QR_EWALLET: { label: 'QR', icon: QrCode, className: 'bg-primary/10 text-primary' },
  ONLINE_GATEWAY: {
    label: 'ออนไลน์',
    icon: CreditCard,
    className: 'bg-accent text-accent-foreground',
  },
};

function PaymentMethodChip({ method }: { method: string | null | undefined }) {
  if (!method) return <span className="text-[10px] text-muted-foreground">—</span>;
  const meta = paymentMethodMeta[method];
  if (!meta) {
    return (
      <span className="inline-flex items-center px-1 py-px rounded text-[9px] font-medium bg-muted text-muted-foreground">
        {method}
      </span>
    );
  }
  const Icon = meta.icon;
  return (
    <span
      className={`inline-flex items-center gap-0.5 px-1 py-px rounded text-[9px] font-medium ${meta.className}`}
    >
      <Icon className="w-2.5 h-2.5" />
      {meta.label}
    </span>
  );
}

export default function RecentPaymentGroup({ payment }: { payment: PaymentSummaryItem }) {
  const [open, setOpen] = useState(false);
  const isPartial = payment.status === 'PARTIALLY_PAID';
  const due = Number(payment.amountDue);
  const paid = Number(payment.amountPaid);
  const partialCount = payment.partials.length;
  const expandable = partialCount > 1 || isPartial;

  return (
    <div className="rounded-md bg-muted/30 border border-border/50 overflow-hidden">
      <button
        type="button"
        onClick={() => expandable && setOpen((o) => !o)}
        className={cn(
          'w-full grid grid-cols-[12px_1fr_auto] items-center gap-2 px-2 py-1.5 text-left',
          expandable ? 'cursor-pointer hover:bg-muted/50' : 'cursor-default',
        )}
      >
        {expandable ? (
          <ChevronRight
            className={cn(
              'w-3 h-3 text-muted-foreground transition-transform',
              open && 'rotate-90',
            )}
          />
        ) : (
          <span />
        )}
        <div className="min-w-0">
          <div className="text-[11px] text-foreground/90 truncate">
            <span className="font-mono text-info">{payment.contract?.contractNumber}</span>
            <span className="text-muted-foreground"> · งวด {payment.installmentNo}</span>
          </div>
          <div className="text-[9px] text-muted-foreground flex items-center gap-1.5 mt-0.5">
            {partialCount > 1 && <span>{partialCount} ครั้ง</span>}
            {partialCount > 1 && (isPartial || partialCount === 1) && <span>·</span>}
            <span
              className={cn(
                'inline-flex items-center px-1 py-px rounded text-[9px] font-semibold',
                isPartial ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success',
              )}
            >
              {isPartial ? 'ชำระบางส่วน' : 'ครบ'}
            </span>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-xs font-semibold text-success tabular-nums">
            {paid.toLocaleString()} บ.
          </div>
          {isPartial && (
            <div className="text-[9px] text-warning tabular-nums">/ {due.toLocaleString()}</div>
          )}
        </div>
      </button>

      {open && expandable && (
        <div className="border-t border-border/50 bg-background/40">
          {payment.partials.map((r, idx) => (
            <div
              key={r.id}
              className="grid grid-cols-[16px_1fr_auto] items-center gap-2 pl-6 pr-2 py-1 text-[10px] border-t border-border/30 first:border-t-0"
            >
              <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-muted text-muted-foreground text-[9px] font-semibold tabular-nums">
                {partialCount - idx}
              </span>
              <div className="flex items-center gap-1.5 min-w-0">
                <PaymentMethodChip method={r.paymentMethod} />
                <span className="text-muted-foreground truncate">
                  {format(new Date(r.paidDate), 'dd/MM HH:mm')}
                </span>
              </div>
              <span className="font-medium text-foreground tabular-nums">
                {Number(r.amount).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
