import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { BLACKLIST_OVERRIDE_REASON_MIN, isValidBlacklistOverrideReason, type BlacklistReason } from '@installment/shared';
import Modal from '@/components/ui/Modal';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import BlacklistReasonList from '@/components/customer/BlacklistReasonList';

interface Props {
  open: boolean;
  reasons: BlacklistReason[];
  pending: boolean;
  onClose: () => void;
  /** ยิงเปิดใช้ซ้ำพร้อมเหตุผล (trim แล้ว) — API เขียนลง Contract.blacklistOverride* + audit */
  onConfirm: (reason: string) => void;
}

/**
 * ก้อน 5 C3 — ตอนกดเปิดใช้สัญญาแล้ว API ตอบ 409 CUSTOMER_BLACKLIST_REVIEW (SOFT ที่เกิดหลังสร้างร่าง) และผู้กดเป็น OWNER/BM:
 * ร่างที่อนุมัติ/ลงนามแล้วลบไม่ได้ จึงให้ปลดตรงนี้ด้วยเหตุผล ≥10 ตัว (กล่องเดียวกับขั้นเลือกลูกค้า — review I1)
 */
export default function BlacklistOverrideDialog({ open, reasons, pending, onClose, onConfirm }: Props) {
  const [reason, setReason] = useState('');
  if (!open) return null;
  const len = reason.trim().length;
  const valid = isValidBlacklistOverrideReason(reason);
  return (
    <Modal isOpen={open} onClose={onClose} title="ต้องให้ผู้จัดการอนุมัติก่อนเปิดใช้สัญญา">
      <div role="alert" className="rounded-xl border border-warning/40 bg-warning/10 p-4">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-warning-strong" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold leading-snug text-warning-strong">ลูกค้ามีประวัติที่ต้องให้ผู้จัดการอนุมัติ (เกิดหลังสร้างร่าง)</div>
            <BlacklistReasonList reasons={reasons} className="mt-2" />
          </div>
        </div>
      </div>
      <div className="mt-4 space-y-2">
        <Textarea
          aria-label="เหตุผลการอนุมัติ"
          placeholder="เหตุผลที่อนุมัติ เช่น ตรวจแล้วว่าผู้อ้างอิงไม่ใช่คนเดียวกัน (อย่างน้อย 10 ตัวอักษร)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          disabled={pending}
        />
        <div className={`text-xs leading-snug ${len < BLACKLIST_OVERRIDE_REASON_MIN ? 'text-destructive' : 'text-muted-foreground'}`}>
          {len}/{BLACKLIST_OVERRIDE_REASON_MIN}
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>ยกเลิก</Button>
        <Button type="button" disabled={!valid || pending} onClick={() => onConfirm(reason.trim())}>
          {pending ? 'กำลังเปิดใช้…' : 'อนุมัติและเปิดใช้สัญญา'}
        </Button>
      </div>
    </Modal>
  );
}
