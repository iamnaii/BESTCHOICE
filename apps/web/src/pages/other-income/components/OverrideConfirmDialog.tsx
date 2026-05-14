import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { AlertTriangle, Pencil } from 'lucide-react';

type Props = {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function OverrideConfirmDialog({ open, onConfirm, onCancel }: Props) {
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    if (!open) setAcknowledged(false); // reset on close
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="w-5 h-5" />
            คุณกำลังจะแก้ไข Auto Journal ด้วยตนเอง
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <ul className="space-y-1 list-disc list-inside text-muted-foreground">
            <li>ระบบจะตรวจสอบ V1/V2/V5 ก่อน POST</li>
            <li>การกระทำนี้จะถูกบันทึกใน Audit Log</li>
            <li>เอกสารจะมีเครื่องหมาย <Pencil className="size-3.5 inline" /> Modified ในรายการ</li>
          </ul>

          <div className="flex items-start gap-2 pt-2">
            <Checkbox
              id="override-ack-checkbox"
              checked={acknowledged}
              onCheckedChange={(v) => setAcknowledged(Boolean(v))}
            />
            <label htmlFor="override-ack-checkbox" className="text-sm cursor-pointer">
              ฉันเข้าใจและรับผิดชอบความถูกต้อง
            </label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>ยกเลิก</Button>
          <Button onClick={onConfirm} disabled={!acknowledged}>เปิดโหมดแก้ไข</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
