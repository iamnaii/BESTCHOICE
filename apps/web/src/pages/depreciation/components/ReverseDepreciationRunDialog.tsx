// Depreciation module — reverse-run confirmation dialog (Phase 2)
// Reverses all JE in a period + restores accumulatedDepr per asset.
// Mirrors ReverseDisposalDialog pattern (reason ≥ 5 chars required).

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

interface ReverseDepreciationRunDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  period: string;
  onConfirm: (reason: string) => void;
  isPending: boolean;
}

export function ReverseDepreciationRunDialog({
  open,
  onOpenChange,
  period,
  onConfirm,
  isPending,
}: ReverseDepreciationRunDialogProps) {
  const [reason, setReason] = useState('');
  const valid = reason.trim().length >= 5;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>กลับรายการค่าเสื่อมงวด {period}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            จะกลับรายการ Journal Entry ทั้งหมดในงวดนี้ + คืน accumulatedDepr
            สินทรัพย์แต่ละตัว ไม่สามารถ undo ได้
          </p>
          <div className="space-y-1.5">
            <Label>เหตุผล (ขั้นต่ำ 5 ตัวอักษร) *</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="กรอกเหตุผลในการกลับรายการ"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
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
