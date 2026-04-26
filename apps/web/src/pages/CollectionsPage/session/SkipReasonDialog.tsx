import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { SkipReason } from '../hooks/useSessionActions';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: (reason: SkipReason, note?: string) => void;
}

const REASONS: { value: SkipReason; label: string }[] = [
  { value: 'BUSY', label: 'ลูกค้าไม่ว่าง — โทรซ้ำภายหลัง' },
  { value: 'WRONG_QUEUE', label: 'ไม่ใช่ลูกค้าของฉัน — คืนกลับ pool' },
  { value: 'PERSONAL_CONFLICT', label: 'มีเรื่องส่วนตัว — ขอข้าม' },
  { value: 'OTHER', label: 'อื่นๆ' },
];

export default function SkipReasonDialog({ open, onOpenChange, onSubmit }: Props) {
  const [reason, setReason] = useState<SkipReason>('BUSY');
  const [note, setNote] = useState('');

  const submit = () => {
    onSubmit(reason, note.trim() || undefined);
    setNote('');
    setReason('BUSY');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>ข้ามรายการนี้ — เพราะอะไร?</DialogTitle>
        </DialogHeader>
        <RadioGroup value={reason} onValueChange={(v) => setReason(v as SkipReason)}>
          {REASONS.map((r) => (
            <div key={r.value} className="flex items-center gap-2 py-1.5">
              <RadioGroupItem value={r.value} id={`skip-${r.value}`} />
              <Label htmlFor={`skip-${r.value}`} className="text-sm leading-snug cursor-pointer">
                {r.label}
              </Label>
            </div>
          ))}
        </RadioGroup>
        {reason === 'OTHER' && (
          <Textarea
            placeholder="เหตุผล (สั้นๆ)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            className="mt-2"
          />
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            ยกเลิก
          </Button>
          <Button onClick={submit}>ข้ามและไปต่อ</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
