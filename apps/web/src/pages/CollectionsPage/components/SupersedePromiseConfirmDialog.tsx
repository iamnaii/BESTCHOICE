import { AlertTriangle } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { formatNumber } from '@/utils/formatters';
import { formatThaiDateShort } from '@/lib/date';

interface OldPromise {
  settlementDate: string; // ISO
  settlementAmount: number;
  rescheduleCount: number;
}

interface Props {
  open: boolean;
  oldPromise: OldPromise | null;
  willCountBroken: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function SupersedePromiseConfirmDialog({
  open,
  oldPromise,
  willCountBroken,
  onConfirm,
  onCancel,
}: Props) {
  if (!oldPromise) return null;

  const dateLabel = formatThaiDateShort(oldPromise.settlementDate);

  return (
    <Modal isOpen={open} onClose={onCancel} title="ยืนยันการเลื่อนนัด" size="sm">
      <div className="space-y-4">
        <div className="rounded-xl bg-muted/40 px-4 py-3 leading-snug">
          <div className="text-sm text-muted-foreground">นัดเดิม</div>
          <div className="text-base font-semibold">
            {dateLabel} · {formatNumber(oldPromise.settlementAmount)} ฿
          </div>
        </div>

        {willCountBroken ? (
          <div className="rounded-xl border-2 border-destructive/40 bg-destructive/5 p-4 flex items-start gap-2">
            <AlertTriangle className="size-5 text-destructive shrink-0 mt-0.5" />
            <div className="text-sm leading-snug">
              <div className="font-semibold text-destructive">นัดนี้จะถูกนับเป็นผิดนัด 1 ครั้ง</div>
              <div className="text-xs text-muted-foreground mt-1">
                {oldPromise.rescheduleCount >= 1
                  ? 'เลื่อนเกิน 1 ครั้งในรอบเดียวกัน'
                  : 'นัดเดิมเลยวันที่นัดผ่านมาแล้ว'}
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-success/30 bg-success/5 p-4 text-sm leading-snug">
            แจ้งล่วงหน้าก่อนถึงวันนัด — <span className="font-semibold">ไม่นับผิดนัด</span>
          </div>
        )}

        <div className="flex gap-2 justify-end pt-2 border-t border-border/40">
          <button
            onClick={onCancel}
            className="px-5 py-2.5 text-base border border-input rounded-lg hover:bg-muted transition-colors"
          >
            ยกเลิก
          </button>
          <button
            onClick={onConfirm}
            className="px-5 py-2.5 text-base bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90 transition-colors"
          >
            ยืนยันเลื่อนนัด
          </button>
        </div>
      </div>
    </Modal>
  );
}
