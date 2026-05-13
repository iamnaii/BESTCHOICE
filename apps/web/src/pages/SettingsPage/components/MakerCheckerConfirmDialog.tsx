import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { AlertTriangle } from 'lucide-react';

type Props = {
  open: boolean;
  nextValue: boolean | null; // true = OFF→ON, false = ON→OFF
  pendingReadyCount: number; // shown when ON→OFF
  onConfirm: () => void;
  onCancel: () => void;
};

export function MakerCheckerConfirmDialog({
  open,
  nextValue,
  pendingReadyCount,
  onConfirm,
  onCancel,
}: Props) {
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    if (!open) setAcknowledged(false);
  }, [open]);

  const isEnabling = nextValue === true;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="w-5 h-5" />
            {isEnabling
              ? 'คุณกำลังจะเปิดระบบ Maker-Checker'
              : 'คุณกำลังจะปิดระบบ Maker-Checker'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <p className="font-semibold">ผลกระทบ:</p>
          {isEnabling ? (
            <ul className="space-y-1 list-disc list-inside text-muted-foreground">
              <li>เอกสารทุกฉบับจะต้องผ่านผู้อนุมัติก่อน POST</li>
              <li>เอกสาร DRAFT ปัจจุบันจะต้องส่งอนุมัติ</li>
              <li>ผู้สร้าง ≠ ผู้อนุมัติ (segregation of duties)</li>
            </ul>
          ) : (
            <>
              <ul className="space-y-1 list-disc list-inside text-muted-foreground">
                <li>เอกสารที่อยู่ในสถานะ READY จะถูก auto-approve</li>
                <li>เอกสารใหม่จะ POST ทันที (ไม่ต้องอนุมัติ)</li>
              </ul>
              <p className="text-warning font-medium">
                จำนวนเอกสาร READY ตอนนี้: {pendingReadyCount} ฉบับ
              </p>
            </>
          )}

          <div className="flex items-start gap-2 pt-2">
            <Checkbox
              id="mc-ack"
              checked={acknowledged}
              onCheckedChange={(v) => setAcknowledged(Boolean(v))}
            />
            <label htmlFor="mc-ack" className="text-sm cursor-pointer">
              {isEnabling
                ? 'ฉันเข้าใจและยืนยันเปิดระบบ'
                : 'ฉันเข้าใจและยืนยันปิดระบบ'}
            </label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            ยกเลิก
          </Button>
          <Button onClick={onConfirm} disabled={!acknowledged}>
            {isEnabling ? 'ยืนยันเปิด' : 'ยืนยันปิด'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
