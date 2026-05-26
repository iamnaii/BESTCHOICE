import { Printer, Truck, X, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { LetterStatus } from '../types';

interface Props {
  status: LetterStatus;
  count: number;
  canCancel: boolean;
  onBulkPrint: () => void;
  onBulkDispatch: () => void;
  onBulkUndeliverable: () => void;
  onBulkCancel: () => void;
  onClear: () => void;
}

export default function LetterBulkActionsBar({
  status,
  count,
  canCancel,
  onBulkPrint,
  onBulkDispatch,
  onBulkUndeliverable,
  onBulkCancel,
  onClear,
}: Props) {
  if (count === 0) return null;

  return (
    <div className="sticky bottom-0 z-10 -mx-4 px-4 py-3 bg-card border-t border-border shadow-lg flex items-center justify-between">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium">เลือก {count} ฉบับ</span>
        <Button size="sm" variant="ghost" onClick={onClear}>ยกเลิกเลือก</Button>
      </div>
      <div className="flex gap-2">
        {status === 'PENDING_DISPATCH' && (
          <>
            <Button size="sm" onClick={onBulkPrint}>
              <Printer className="size-4 mr-1" /> พิมพ์รวม
            </Button>
            {canCancel && (
              <Button size="sm" variant="outline" onClick={onBulkCancel}>
                <X className="size-4 mr-1" /> ยกเลิก
              </Button>
            )}
          </>
        )}
        {status === 'PDF_GENERATED' && (
          <>
            <Button size="sm" onClick={onBulkDispatch}>
              <Truck className="size-4 mr-1" /> บันทึกการส่ง
            </Button>
            {canCancel && (
              <Button size="sm" variant="outline" onClick={onBulkCancel}>
                <X className="size-4 mr-1" /> ยกเลิก
              </Button>
            )}
          </>
        )}
        {status === 'DISPATCHED' && (
          <Button size="sm" variant="outline" onClick={onBulkUndeliverable}>
            <AlertTriangle className="size-4 mr-1" /> ตีกลับ
          </Button>
        )}
      </div>
    </div>
  );
}
