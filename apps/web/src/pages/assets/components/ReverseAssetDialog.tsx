// Asset module — Reverse confirmation dialog (Phase 1)
// Shows warning + reason textarea (min 5 chars). Creates JE สวนทาง on confirm.

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';

interface ReverseAssetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void;
  isPending: boolean;
}

export function ReverseAssetDialog({
  open,
  onOpenChange,
  onConfirm,
  isPending,
}: ReverseAssetDialogProps) {
  const [reason, setReason] = useState('');
  const valid = reason.trim().length >= 5;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>กลับรายการสินทรัพย์</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            การกลับรายการจะสร้าง JE สวนทาง สถานะเปลี่ยนเป็น REVERSED ไม่สามารถกู้คืนได้
          </p>
          <div>
            <Label>เหตุผล (ขั้นต่ำ 5 ตัวอักษร) *</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            ยกเลิก
          </Button>
          <Button
            variant="destructive"
            disabled={!valid || isPending}
            onClick={() => onConfirm(reason)}
          >
            {isPending ? 'กำลังกลับรายการ…' : 'ยืนยันกลับรายการ'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
