import { useId } from 'react';

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
