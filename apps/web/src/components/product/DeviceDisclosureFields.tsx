import { NumberInput } from '@/components/ui/NumberInput';
import { NativeSelect } from '@/components/ui/native-select';
import { formControlClass, formLabelClass, formTextareaClass } from '@/components/ui/form-styles';
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
  return <div className="min-w-0">
    <label htmlFor={id} className={formLabelClass}>เครื่องไทย / เครื่องนอก</label>
    <NativeSelect id={id} className={formControlClass} value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      <option value="">ยังไม่ระบุ</option><option value="THAI">เครื่องไทย</option><option value="IMPORTED">เครื่องนอก</option>
    </NativeSelect>
  </div>;
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
  const cls = formControlClass;
  const preview = partsHistoryText((value || null) as PartsHistoryValue | null, note);
  return <div className="space-y-2">
    <div>
      <label htmlFor={id} className={formLabelClass}>อะไหล่และประวัติซ่อม</label>
      <NativeSelect id={id} className={cls} value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value="">ยังไม่ระบุ</option>
        {PARTS_HISTORY_VALUES.map((v) => <option key={v} value={v}>{PARTS_HISTORY_LABEL[v]}</option>)}
      </NativeSelect>
    </div>
    <p className="text-xs text-muted-foreground leading-snug">ดูจาก ตั้งค่า → ทั่วไป → เกี่ยวกับ → ประวัติชิ้นส่วนและบริการ บนตัวเครื่อง · บันทึกไว้แจ้งลูกค้า ไม่มีผลกับการคำนวณค่างวด</p>
    {value && <div>
      <label htmlFor={`${id}-note`} className={formLabelClass}>รายละเอียดเพิ่ม (ถ้ามี)</label>
      <input id={`${id}-note`} type="text" maxLength={200} className={cls} value={note ?? ''} disabled={disabled}
        placeholder="เช่น เปลี่ยนแบต 26 ก.ย. 2569" onChange={(e) => onNoteChange(e.target.value)} />
    </div>}
    {preview && <p className="rounded-lg bg-muted px-3 py-2 text-xs leading-snug"><span className="text-muted-foreground">ลูกค้าเห็นว่า </span>{preview}</p>}
  </div>;
}

export function DeviceDisclosureFields({ value, onChange, disabled }: {
  value: DeviceDisclosureForm;
  onChange: (key: keyof DeviceDisclosureForm, value: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const cls = formControlClass;
  return <div className="space-y-3 col-span-full">
    <div className="grid gap-3 sm:grid-cols-2">
      <DeviceOriginField value={value.deviceOrigin} onChange={(origin) => onChange('deviceOrigin', origin)} disabled={disabled} />
      <div>
        <label htmlFor={`${id}-days`} className={formLabelClass}>ประกันร้าน (วัน)</label>
        <NumberInput unstyled id={`${id}-days`} min={0} step={1} className={cls} value={value.shopWarrantyDays ?? ''} disabled={disabled} onChange={(e) => onChange('shopWarrantyDays', e.target.value)} />
      </div>
    </div>
    <p className="text-xs text-muted-foreground">ประกัน: เว้นว่างใช้เงื่อนไขมาตรฐานของร้าน · 0 = ไม่มีประกันร้าน · ระบุจำนวนวันเพื่อกำหนดเฉพาะเครื่อง</p>
    <div>
      <label htmlFor={`${id}-terms`} className={formLabelClass}>ผู้รับประกันและเงื่อนไขความคุ้มครอง</label>
      <textarea id={`${id}-terms`} rows={3} maxLength={2000} className={formTextareaClass} value={value.warrantyTerms ?? ''} disabled={disabled} onChange={(e) => onChange('warrantyTerms', e.target.value)} />
    </div>
  </div>;
}
