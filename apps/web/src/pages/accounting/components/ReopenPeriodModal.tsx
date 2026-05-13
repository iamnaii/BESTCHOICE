import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { AlertTriangle } from 'lucide-react';

type ReasonType = 'WRONG_ENTRY' | 'MISSED_RECORD' | 'AUDITOR_REQUEST' | 'OTHER';

type Props = {
  open: boolean;
  period: string;
  onConfirm: (payload: { reasonType: ReasonType; reason: string; taxFiled: boolean }) => void;
  onCancel: () => void;
};

const REASON_OPTIONS: Array<{ value: ReasonType; label: string }> = [
  { value: 'WRONG_ENTRY', label: 'พบเอกสารผิดต้อง reverse' },
  { value: 'MISSED_RECORD', label: 'ลืมบันทึกรายการสำคัญ' },
  { value: 'AUDITOR_REQUEST', label: 'แก้ไขตามคำขอ auditor' },
  { value: 'OTHER', label: 'อื่นๆ (ระบุในบันทึก)' },
];

export function ReopenPeriodModal({ open, period, onConfirm, onCancel }: Props) {
  const [reasonType, setReasonType] = useState<ReasonType | null>(null);
  const [reason, setReason] = useState('');
  const [taxFiled, setTaxFiled] = useState<boolean | null>(null);

  useEffect(() => {
    if (!open) {
      setReasonType(null);
      setReason('');
      setTaxFiled(null);
    }
  }, [open]);

  const canSubmit = reasonType !== null && reason.trim().length >= 10 && taxFiled !== null;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onConfirm({ reasonType: reasonType!, reason: reason.trim(), taxFiled: taxFiled! });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-warning">
            <AlertTriangle className="w-5 h-5" />
            คุณกำลังเปิดงวด {period} ที่ปิดไปแล้ว
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <fieldset className="space-y-2">
            <legend className="font-semibold">เหตุผล (บังคับ):</legend>
            {REASON_OPTIONS.map((opt) => (
              <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="reasonType"
                  value={opt.value}
                  checked={reasonType === opt.value}
                  onChange={() => setReasonType(opt.value)}
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </fieldset>

          <div>
            <label htmlFor="reopen-reason-note" className="block font-semibold mb-1">
              บันทึกรายละเอียด (≥ 10 ตัวอักษร):
            </label>
            <Textarea
              id="reopen-reason-note"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="ระบุเอกสารหรือเหตุการณ์ที่ต้องการแก้ไข"
            />
          </div>

          <fieldset className="space-y-2">
            <legend className="font-semibold">ภ.พ.30 งวดนี้ยื่นแล้วใช่ไหม?</legend>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="taxFiled"
                checked={taxFiled === true}
                onChange={() => setTaxFiled(true)}
              />
              <span>ใช่ — ต้องยื่นแก้ไขด้วย</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="taxFiled"
                checked={taxFiled === false}
                onChange={() => setTaxFiled(false)}
              />
              <span>ยังไม่ได้ยื่น</span>
            </label>
          </fieldset>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            ยกเลิก
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            ยืนยันเปิดงวด
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
