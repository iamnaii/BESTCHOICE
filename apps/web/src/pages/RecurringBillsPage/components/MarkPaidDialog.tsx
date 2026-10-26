import { useEffect, useState } from 'react';
import { RECURRING_BILL_PAID_NOTE_MAX } from '@installment/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { RecurringBillRow } from '@/hooks/useRecurringBills';
import { todayKey } from './labels';

interface MarkPaidDialogProps {
  row: RecurringBillRow | null;
  pending: boolean;
  onClose: () => void;
  onConfirm: (value: { note?: string; paidAt: string }) => void;
}

/** "จ่ายแล้ว" ด้วยมือ — ใช้เมื่อจ่ายนอกระบบ ใบรายจ่ายยังต้องลงบัญชีต่อ (สเปก §6 ข้อ 3) */
export function MarkPaidDialog({ row, pending, onClose, onConfirm }: MarkPaidDialogProps) {
  const [note, setNote] = useState('');
  const [paidAt, setPaidAt] = useState(todayKey());
  useEffect(() => {
    if (row) {
      setNote('');
      setPaidAt(todayKey());
    }
  }, [row]);
  const today = todayKey();
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(paidAt) && paidAt <= today && note.length <= RECURRING_BILL_PAID_NOTE_MAX;
  return (
    <Dialog open={!!row} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>บันทึกว่าจ่ายแล้ว — {row?.templateName}</DialogTitle>
          <DialogDescription>
            ใช้เมื่อจ่ายนอกระบบ (ตัดบัตร/โอนเอง) — ใบรายจ่ายยังต้องลงบัญชีต่อ งานใน /todos จะเปลี่ยนเป็น "ลงบัญชีใบ …" จนกว่าจะโพสต์
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="mark-paid-date">วันที่จ่าย</Label>
            <Input id="mark-paid-date" type="date" max={today} value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
            {paidAt > today && <p className="text-xs text-destructive">วันที่จ่ายต้องไม่เกินวันนี้</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="mark-paid-note">หมายเหตุ</Label>
            <Textarea id="mark-paid-note" rows={2} maxLength={RECURRING_BILL_PAID_NOTE_MAX} placeholder="เช่น ตัดบัตรอัตโนมัติ" value={note} onChange={(e) => setNote(e.target.value)} />
            <p className="text-xs text-muted-foreground">{note.length}/{RECURRING_BILL_PAID_NOTE_MAX}</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>ยกเลิก</Button>
          <Button variant="primary" disabled={!valid || pending} onClick={() => onConfirm({ note: note.trim() || undefined, paidAt })}>บันทึกจ่ายแล้ว</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
