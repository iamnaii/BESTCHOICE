import { cn } from '@/lib/utils';
import { formatDateShort } from '@/utils/formatters';
import { Check, Clock, AlertTriangle, CircleDot } from 'lucide-react';

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

interface PaymentTimelineProps {
  payments: Payment[];
}

const statusConfig: Record<string, { icon: typeof Check; color: string; bgColor: string; lineColor: string }> = {
  PAID: { icon: Check, color: 'text-success', bgColor: 'bg-success', lineColor: 'bg-success' },
  OVERDUE: { icon: AlertTriangle, color: 'text-destructive', bgColor: 'bg-destructive', lineColor: 'bg-destructive' },
  PARTIALLY_PAID: { icon: CircleDot, color: 'text-warning', bgColor: 'bg-warning', lineColor: 'bg-warning' },
  PENDING: { icon: Clock, color: 'text-muted-foreground', bgColor: 'bg-muted-foreground/30', lineColor: 'bg-border' },
};

/**
 * Visual payment timeline — แสดง progress ผ่อนแต่ละงวด
 * แถบด้านบนแสดง overview, ด้านล่างแสดง timeline detail
 */
export default function PaymentTimeline({ payments }: PaymentTimelineProps) {
  if (payments.length === 0) return null;

  const paid = payments.filter((p) => p.status === 'PAID').length;
  const overdue = payments.filter((p) => p.status === 'OVERDUE').length;
  const partial = payments.filter((p) => p.status === 'PARTIALLY_PAID').length;
  const total = payments.length;
  const progressPct = total > 0 ? (paid / total) * 100 : 0;

  return (
    <div className="mb-5">
      {/* Progress overview */}
      <div className="bg-card rounded-xl border border-border p-5 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-semibold text-foreground">ความคืบหน้าการผ่อน</h4>
          <span className="text-2sm text-muted-foreground">
            {paid}/{total} งวด ({progressPct.toFixed(0)}%)
          </span>
        </div>

        {/* Progress bar */}
        <div className="h-3 bg-muted rounded-full overflow-hidden mb-3">
          <div
            className="h-full bg-success rounded-full transition-all duration-700 ease-out"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        {/* Stats row */}
        <div className="flex gap-4 text-xs">
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

      {/* Timeline */}
      <div className="bg-card rounded-xl border border-border p-5">
        <h4 className="text-sm font-semibold text-foreground mb-4">ไทม์ไลน์งวดผ่อน</h4>
        <div className="relative">
          {payments.map((p, i) => {
            const config = statusConfig[p.status] || statusConfig.PENDING;
            const Icon = config.icon;
            const isLast = i === payments.length - 1;

            return (
              <div key={p.id} className="flex gap-3 relative">
                {/* Timeline line + dot */}
                <div className="flex flex-col items-center">
                  <div className={cn(
                    'size-7 rounded-full flex items-center justify-center shrink-0 z-10',
                    p.status === 'PAID' ? config.bgColor : 'bg-card border-2 border-current',
                    config.color,
                  )}>
                    <Icon className={cn('size-3.5', p.status === 'PAID' && 'text-white')} strokeWidth={2.5} />
                  </div>
                  {!isLast && (
                    <div className={cn('w-0.5 flex-1 min-h-[24px]', i < paid ? 'bg-success' : 'bg-border')} />
                  )}
                </div>

                {/* Content */}
                <div className={cn('pb-4 flex-1 min-w-0', isLast && 'pb-0')}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-foreground">
                      งวดที่ {p.installmentNo}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDateShort(p.dueDate)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-2sm text-muted-foreground">
                      {parseFloat(p.amountDue).toLocaleString()} ฿
                    </span>
                    {p.amountPaid && (
                      <span className="text-2sm text-success font-medium">
                        ชำระ {parseFloat(p.amountPaid).toLocaleString()} ฿
                      </span>
                    )}
                    {parseFloat(p.lateFee) > 0 && (
                      <span className="text-2sm text-destructive">
                        ปรับ {parseFloat(p.lateFee).toLocaleString()} ฿
                      </span>
                    )}
                  </div>
                  {p.paidDate && (
                    <div className="text-2xs text-muted-foreground mt-0.5">
                      ชำระเมื่อ {formatDateShort(p.paidDate)}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
