// Depreciation module — manual run confirmation dialog (Phase 2)
// Shows period + asset count + total before posting JE batch.

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { formatNumberDecimal } from '@/utils/formatters';

interface DepreciationRunDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  period: string;
  totalAmount: number;
  assetCount: number;
  onConfirm: () => void;
  isPending: boolean;
}

export function DepreciationRunDialog({
  open,
  onOpenChange,
  period,
  totalAmount,
  assetCount,
  onConfirm,
  isPending,
}: DepreciationRunDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>ยืนยันรันค่าเสื่อมงวด {period}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          <p>
            จำนวนสินทรัพย์: <span className="font-semibold tabular-nums">{assetCount}</span>
          </p>
          <p>
            ยอดรวม:{' '}
            <span className="font-semibold tabular-nums">
              {formatNumberDecimal(totalAmount)} บาท
            </span>
          </p>
          <p className="text-muted-foreground mt-2">
            ระบบจะบันทึกบัญชีและค่าเสื่อมราคาสำหรับสินทรัพย์ทั้งหมด หากต้องการยกเลิกภายหลังให้ใช้การกลับรายการ
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            ยกเลิก
          </Button>
          <Button onClick={onConfirm} disabled={isPending || assetCount === 0}>
            {isPending ? 'กำลังรัน…' : 'ยืนยันรัน'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
