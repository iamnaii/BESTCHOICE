import { useId } from 'react';
import { PARTS_HISTORY_LABEL, PARTS_HISTORY_VALUES, partsHistoryText, type PartsHistoryValue } from '@installment/shared';

export interface DeviceDisclosureForm {
  deviceOrigin?: string;
  shopWarrantyDays?: string;
  warrantyTerms?: string;
}

export function DeviceOriginField({ value, onChange, disabled }: {
  value?: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return <label htmlFor={id} className="block text-sm">เครื่องไทย / เครื่องนอก
    <select id={id} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm disabled:opacity-50" value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      <option value="">ยังไม่ระบุ</option><option value="THAI">เครื่องไทย</option><option value="IMPORTED">เครื่องนอก</option>
    </select>
  </label>;
}

/**
 * อะไหล่และประวัติซ่อม — บันทึกไว้แจ้งลูกค้าเท่านั้น ไม่มีผลกับการคำนวณค่างวด/OVER (คำตัดสินเจ้าของ 2026-09-26)
 * ค่าว่าง = ยังไม่ระบุ · แสดงตัวอย่างข้อความที่ลูกค้าเห็นบนเอกสาร/แชทใต้ช่อง
 */
export function PartsHistoryField({ value, note, onChange, onNoteChange, disabled }: {
  value?: string;
  note?: string;
  onChange: (value: string) => void;
  onNoteChange: (note: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const cls = 'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm disabled:opacity-50';
  const preview = partsHistoryText((value || null) as PartsHistoryValue | null, note);
  return <div className="space-y-2">
    <label htmlFor={id} className="block text-sm">อะไหล่และประวัติซ่อม
      <select id={id} className={cls} value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value="">ยังไม่ระบุ</option>
        {PARTS_HISTORY_VALUES.map((v) => <option key={v} value={v}>{PARTS_HISTORY_LABEL[v]}</option>)}
      </select>
    </label>
    <p className="text-xs text-muted-foreground leading-snug">ดูจาก ตั้งค่า → ทั่วไป → เกี่ยวกับ → ประวัติชิ้นส่วนและบริการ บนตัวเครื่อง · บันทึกไว้แจ้งลูกค้า ไม่มีผลกับการคำนวณค่างวด</p>
    {value && <label htmlFor={`${id}-note`} className="block text-sm">รายละเอียดเพิ่ม (ถ้ามี)
      <input id={`${id}-note`} type="text" maxLength={200} className={cls} value={note ?? ''} disabled={disabled}
        placeholder="เช่น เปลี่ยนแบต 26 ก.ย. 2569" onChange={(e) => onNoteChange(e.target.value)} />
    </label>}
    {preview && <p className="rounded-lg bg-muted px-3 py-2 text-xs leading-snug"><span className="text-muted-foreground">ลูกค้าเห็นว่า </span>{preview}</p>}
  </div>;
}

export function DeviceDisclosureFields({ value, onChange, disabled }: {
  value: DeviceDisclosureForm;
  onChange: (key: keyof DeviceDisclosureForm, value: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const cls = 'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm disabled:opacity-50';
  return <div className="space-y-3 col-span-full">
    <div className="grid gap-3 sm:grid-cols-2">
      <DeviceOriginField value={value.deviceOrigin} onChange={(origin) => onChange('deviceOrigin', origin)} disabled={disabled} />
      <label htmlFor={`${id}-days`} className="text-sm">ประกันร้าน (วัน)
        <input id={`${id}-days`} type="number" min={0} step={1} className={cls} value={value.shopWarrantyDays ?? ''} disabled={disabled} onChange={(e) => onChange('shopWarrantyDays', e.target.value)} />
      </label>
    </div>
    <p className="text-xs text-muted-foreground">ประกัน: เว้นว่างใช้เงื่อนไขมาตรฐานของร้าน · 0 = ไม่มีประกันร้าน · ระบุจำนวนวันเพื่อกำหนดเฉพาะเครื่อง</p>
    <label htmlFor={`${id}-terms`} className="block text-sm">ผู้รับประกันและเงื่อนไขความคุ้มครอง
      <textarea id={`${id}-terms`} rows={3} maxLength={2000} className={cls} value={value.warrantyTerms ?? ''} disabled={disabled} onChange={(e) => onChange('warrantyTerms', e.target.value)} />
    </label>
  </div>;
}
