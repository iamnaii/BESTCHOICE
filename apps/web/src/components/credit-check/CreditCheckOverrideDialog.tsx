import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface Props {
  open: boolean;
  onClose: () => void;
  status: string;
  onStatusChange: (v: string) => void;
  notes: string;
  onNotesChange: (v: string) => void;
  isPending: boolean;
  onConfirm: () => void;
}

export default function CreditCheckOverrideDialog({
  open,
  onClose,
  status,
  onStatusChange,
  notes,
  onNotesChange,
  isPending,
  onConfirm,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>ปรับแก้สถานะเครดิตเช็ค</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-foreground mb-1.5">สถานะใหม่</label>
            <select
              value={status}
              onChange={(e) => onStatusChange(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm"
            >
              <option value="">-- เลือกสถานะ --</option>
              <option value="APPROVED">ผ่าน</option>
              <option value="REJECTED">ไม่ผ่าน</option>
              <option value="MANUAL_REVIEW">ต้องตรวจเพิ่ม</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1.5">หมายเหตุ</label>
            <textarea
              value={notes}
              onChange={(e) => onNotesChange(e.target.value)}
              rows={3}
              placeholder="เหตุผลที่ปรับแก้..."
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button variant="primary" onClick={onConfirm} disabled={!status || isPending}>
            {isPending ? 'กำลังบันทึก...' : 'ยืนยัน'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
