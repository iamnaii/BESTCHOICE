import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatThaiDate } from '@/lib/date';

export type AccrualMode = '2B_ONLY' | 'CONSOLIDATED_PAYING_AHEAD' | 'CONSOLIDATED_BACKFILL';

export function AccrualModeChip({
  mode,
  dueDate,
}: {
  mode: AccrualMode;
  dueDate?: string;
}) {
  if (mode === '2B_ONLY') return null;

  const dueLabel = dueDate ? formatThaiDate(new Date(dueDate)) : '';
  const isAhead = mode === 'CONSOLIDATED_PAYING_AHEAD';

  return (
    <div
      className={cn(
        'mb-3 rounded-lg border p-2.5 text-xs leading-snug flex gap-2',
        isAhead
          ? 'border-primary/30 bg-primary/5 text-primary'
          : 'border-warning/30 bg-warning/5 text-warning',
      )}
    >
      <Info className="size-3.5 shrink-0 mt-0.5" />
      <div className="space-y-0.5">
        <div className="font-medium">
          {isAhead
            ? `ลูกค้าจ่ายล่วงหน้า · งวดนี้ครบกำหนด ${dueLabel}`
            : 'งวดนี้ยังไม่ได้ accrual (จะรันคืนนี้)'}
        </div>
        <div className="text-[11px] opacity-80">
          ระบบรวม 2A (รับรู้รายได้) + 2B (รับเงิน) เป็น JE เดียวเพื่อให้บัญชีสมดุล —
          ผลทางบัญชีเทียบเท่าการรัน 2A แล้วรับเงินตามขั้นตอนปกติ
        </div>
      </div>
    </div>
  );
}
