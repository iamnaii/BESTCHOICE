import { useMemo } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface Props {
  open: boolean;
  onClose: () => void;
  status: string;
  onStatusChange: (v: string) => void;
  reasonCategory: string;
  onReasonCategoryChange: (v: string) => void;
  notes: string;
  onNotesChange: (v: string) => void;
  isPending: boolean;
  onConfirm: () => void;
}

interface ReasonOption {
  value: string;
  label: string;
  detailLabel: string;
  detailPlaceholder: string;
}

const REASON_OPTIONS: ReasonOption[] = [
  {
    value: 'EXISTING_CUSTOMER',
    label: 'ลูกค้าเก่าผ่อนจบแล้ว',
    detailLabel: 'ระบุสัญญาเก่า',
    detailPlaceholder: 'เช่น สัญญาเลขที่ BC-2024-00123 ผ่อน 12 งวดจบเมื่อ ธ.ค. 2568',
  },
  {
    value: 'PERSONAL_VOUCH',
    label: 'พนักงาน/คนรู้จัก/ลูกหลาน',
    detailLabel: 'ระบุชื่อ+ความสัมพันธ์',
    detailPlaceholder: 'เช่น น้องสาวของ คุณสมชาย (พนักงานสาขาลาดพร้าว)',
  },
  {
    value: 'GUARANTOR',
    label: 'มีผู้ค้ำประกัน',
    detailLabel: 'ระบุชื่อผู้ค้ำ+เอกสาร',
    detailPlaceholder: 'เช่น บิดาค้ำ (นายสมบัติ ฯลฯ) แนบสำเนาบัตร+สลิปเงินเดือน',
  },
  {
    value: 'HIGH_DOWN',
    label: 'ดาวน์สูง/จ่ายสดมาก (≥ 50%)',
    detailLabel: 'ระบุยอดดาวน์',
    detailPlaceholder: 'เช่น ดาวน์ 15,000 จากราคา 25,000 (60%)',
  },
  {
    value: 'CASH_INCOME',
    label: 'รายได้เป็นเงินสด/ไม่เข้าบัญชี',
    detailLabel: 'ระบุอาชีพ+รายได้ประมาณ',
    detailPlaceholder: 'เช่น ค้าขายในตลาด รายได้ประมาณ 25,000/เดือน',
  },
  {
    value: 'EXTRA_EVIDENCE',
    label: 'เอกสารรายได้เพิ่มเติม',
    detailLabel: 'ระบุเอกสารที่ได้รับ',
    detailPlaceholder: 'เช่น สลิปเงินเดือน 3 เดือน + หนังสือรับรองเงินเดือน',
  },
  {
    value: 'MGR_RISK',
    label: 'Manager/Owner รับความเสี่ยง',
    detailLabel: 'เหตุผล + ผู้อนุมัติ',
    detailPlaceholder: 'เช่น approve by exception โดยคุณ... (ความสัมพันธ์กับลูกค้า)',
  },
  {
    value: 'OTHER',
    label: 'อื่นๆ',
    detailLabel: 'เหตุผล',
    detailPlaceholder: 'กรุณาระบุเหตุผลให้ชัดเจน อย่างน้อย 20 ตัวอักษร',
  },
];

function compileReason(categoryValue: string, detail: string): string {
  const opt = REASON_OPTIONS.find((o) => o.value === categoryValue);
  const trimmed = detail.trim();
  if (!opt) return trimmed;
  if (opt.value === 'OTHER') return trimmed;
  return trimmed ? `${opt.label}: ${trimmed}` : opt.label;
}

export default function CreditCheckOverrideDialog({
  open,
  onClose,
  status,
  onStatusChange,
  reasonCategory,
  onReasonCategoryChange,
  notes,
  onNotesChange,
  isPending,
  onConfirm,
}: Props) {
  const currentOption = REASON_OPTIONS.find((o) => o.value === reasonCategory);
  const compiled = useMemo(() => compileReason(reasonCategory, notes), [reasonCategory, notes]);
  const tooShort = compiled.trim().length < 20;
  const tooLong = compiled.length > 2000;
  const disabled = !status || !reasonCategory || tooShort || tooLong || isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>ปรับแก้สถานะเครดิตเช็ค</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-foreground mb-1.5">
              สถานะใหม่ <span className="text-destructive">*</span>
            </label>
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
            <select
              value={reasonCategory}
              onChange={(e) => onReasonCategoryChange(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm"
            >
              <option value="">-- เลือกเหตุผล --</option>
              {REASON_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          {currentOption && (
            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">
                {currentOption.detailLabel} <span className="text-destructive">*</span>
              </label>
              <textarea
                value={notes}
                onChange={(e) => onNotesChange(e.target.value)}
                rows={3}
                placeholder={currentOption.detailPlaceholder}
                className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm"
              />
              <div className="flex justify-between text-[11px] mt-1">
                <span className={tooShort ? 'text-destructive' : 'text-muted-foreground'}>
                  {tooShort
                    ? `รวมต้อง ≥ 20 ตัวอักษร (ตอนนี้ ${compiled.trim().length})`
                    : 'พอดีแล้ว'}
                </span>
                <span className="text-muted-foreground">{compiled.length}/2000</span>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button variant="primary" onClick={onConfirm} disabled={disabled}>
            {isPending ? 'กำลังบันทึก...' : 'ยืนยัน'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { compileReason, REASON_OPTIONS };
