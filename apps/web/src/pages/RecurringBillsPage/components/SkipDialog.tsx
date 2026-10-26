import { useEffect, useState } from 'react';
import { RECURRING_BILL_SKIP_REASON } from '@installment/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { RecurringBillRow } from '@/hooks/useRecurringBills';

interface SkipDialogProps {
  row: RecurringBillRow | null;
  pending: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}

/** "ข้าม" งวด — ต้องมีเหตุผล 5–200 ตัวอักษร (สเปก §6 ข้อ 4) · ร่างที่ระบบสร้างถูกลบ งานปิด เปิดใหม่ได้ภายหลัง */
export function SkipDialog({ row, pending, onClose, onConfirm }: SkipDialogProps) {
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (row) setReason('');
  }, [row]);
  const trimmed = reason.trim();
  const valid = trimmed.length >= RECURRING_BILL_SKIP_REASON.min && trimmed.length <= RECURRING_BILL_SKIP_REASON.max;
  return (
    <Dialog open={!!row} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>ข้ามงวดนี้ — {row?.templateName}</DialogTitle>
          <DialogDescription>
            งวด {row?.periodLabel} จะถูกบันทึกว่าไม่ต้องจ่าย ร่างที่ระบบสร้างไว้จะถูกลบและงานใน /todos จะปิด — เปิดใหม่ได้ภายหลัง
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="skip-reason">เหตุผล</Label>
          <Textarea id="skip-reason" rows={3} maxLength={RECURRING_BILL_SKIP_REASON.max} placeholder="เช่น จ่ายล่วงหน้าทั้งปีไปแล้วเมื่อ ก.ค." value={reason} onChange={(e) => setReason(e.target.value)} />
          <p className="text-xs text-muted-foreground">
            {trimmed.length}/{RECURRING_BILL_SKIP_REASON.max} · อย่างน้อย {RECURRING_BILL_SKIP_REASON.min} ตัวอักษร
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>ยกเลิก</Button>
          <Button variant="destructive" disabled={!valid || pending} onClick={() => onConfirm(trimmed)}>ยืนยันข้าม</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
