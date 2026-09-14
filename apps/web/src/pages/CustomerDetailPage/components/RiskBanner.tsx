import { AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatDateShort } from '@/utils/formatters';
import type { ContractProgress } from '../types';

// ป้ายเดียวกับ CALL_RESULT_LABELS ของ apps/api/src/modules/overdue/timeline.service.ts
const CALL_RESULT_LABELS: Record<string, string> = {
  NO_ANSWER: 'ไม่รับสาย', ANSWERED: 'รับสาย', PROMISED: 'นัดชำระ', REFUSED: 'ปฏิเสธ', WRONG_NUMBER: 'เบอร์ผิด', OTHER: 'อื่น ๆ',
};
const baht = (n: number) => `${n.toLocaleString('th-TH', { maximumFractionDigits: 2 })} ฿`;

export default function RiskBanner({ contracts }: { contracts: ContractProgress[] }) {
  const navigate = useNavigate();
  const late = contracts.filter((k) => k.overdueInstallments > 0);
  if (late.length === 0) return null;
  const first = late[0];
  const count = late.reduce((sum, k) => sum + k.overdueInstallments, 0);
  const amount = late.reduce((sum, k) => sum + k.overdueAmount, 0);
  const days = first.firstOverdueDueDate
    ? Math.max(0, Math.floor((Date.now() - new Date(first.firstOverdueDueDate).getTime()) / 86_400_000))
    : null;
  const severe = late.some((k) => k.status === 'DEFAULT');
  const call = first.lastCall;

  return (
    <div
      data-testid="risk-banner"
      className={cn(
        'relative mb-5 flex flex-wrap items-center justify-between gap-3 overflow-hidden rounded-xl border py-3 pl-5 pr-4',
        severe ? 'border-destructive/20 bg-destructive/5' : 'border-warning/20 bg-warning/5',
      )}
    >
      <div className={cn('absolute bottom-0 left-0 top-0 w-1 rounded-r-full', severe ? 'bg-destructive' : 'bg-warning')} />
      <div className="min-w-0">
        <div className={cn('flex items-center gap-2 text-sm font-semibold leading-snug', severe ? 'text-destructive' : 'text-warning')}>
          <AlertTriangle className="size-4" aria-hidden="true" />
          <span>ค้างชำระ {count} งวด · <span className="tabular-nums">{baht(amount)}</span></span>
        </div>
        <div className="mt-0.5 text-xs leading-snug text-muted-foreground">
          สัญญา <span className="font-mono tabular-nums">{first.contractNumber}</span>
          {first.firstOverdueInstallmentNo !== null && first.firstOverdueDueDate && (
            <> งวด {first.firstOverdueInstallmentNo} ครบกำหนด {formatDateShort(first.firstOverdueDueDate)}{days !== null && ` (ค้าง ${days} วัน)`}</>
          )}
          {call && (
            <> · โทรล่าสุด {formatDateShort(call.calledAt)} {CALL_RESULT_LABELS[call.result] ?? call.result}{call.notes ? ` "${call.notes}"` : ''}</>
          )}
        </div>
      </div>
      <Button variant="primary" size="sm" onClick={() => navigate(`/payments?contractId=${first.id}`)}>
        รับชำระ
      </Button>
    </div>
  );
}
