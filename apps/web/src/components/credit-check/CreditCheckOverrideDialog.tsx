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
            <label className="block text-xs font-medium text-foreground mb-1.5">
              เหตุผล <span className="text-destructive">*</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => onNotesChange(e.target.value)}
              rows={4}
              placeholder="เหตุผลที่ปรับแก้ (อย่างน้อย 20 ตัวอักษร)"
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm"
            />
            <div className="flex justify-between text-[11px] mt-1">
              <span className={notes.trim().length < 20 ? 'text-destructive' : 'text-muted-foreground'}>
                {notes.trim().length < 20
                  ? `ต้องมีอย่างน้อย 20 ตัวอักษร (ตอนนี้ ${notes.trim().length})`
                  : 'พอดีแล้ว'}
              </span>
              <span className="text-muted-foreground">{notes.length}/2000</span>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button
            variant="primary"
            onClick={onConfirm}
            disabled={!status || notes.trim().length < 20 || notes.length > 2000 || isPending}
          >
            {isPending ? 'กำลังบันทึก...' : 'ยืนยัน'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
