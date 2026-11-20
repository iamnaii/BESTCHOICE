import { useState, type FormEvent } from 'react';
import { Button, Input, Label } from '@/components';
import { copy } from '@/lib/copy';
export type SellerDetails = {
  name: string;
  phone: string;
  imei: string;
  visitDate: string;
  notes: string;
};
export function normalizeSellerPhone(phone: string): string {
  return phone.replace(/[\s-]/g, '');
}
export function sellerErrors(value: SellerDetails): Partial<Record<keyof SellerDetails, string>> {
  return {
    ...(!value.name.trim() ? { name: 'กรุณากรอกชื่อ-นามสกุล' } : {}),
    ...(!/^0\d{9}$/.test(normalizeSellerPhone(value.phone))
      ? { phone: 'กรอกเบอร์โทร 10 หลัก เริ่มด้วย 0 โดยใช้ตัวเลขเท่านั้น' }
      : {}),
  };
}
export default function SellerStep({
  value,
  onChange,
  submitting,
  onSubmit,
  flow,
}: {
  value: SellerDetails;
  onChange: (value: SellerDetails) => void;
  submitting: boolean;
  onSubmit: () => void;
  flow: 'BUYBACK' | 'EXCHANGE';
}) {
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const errors = sellerErrors(value);
  const invalid = Object.keys(errors).length > 0;
  function submit(event: FormEvent) {
    event.preventDefault();
    setTouched({ name: true, phone: true });
    if (invalid) {
      document.getElementById(errors.name ? 'sell-name' : 'sell-phone')?.focus();
      return;
    }
    onSubmit();
  }
  function field(key: keyof SellerDetails, label: string, type = 'text') {
    const error = touched[key] ? errors[key] : undefined;
    return (
      <div className="space-y-2">
        <Label htmlFor={`sell-${key}`}>{label}</Label>
        <Input
          id={`sell-${key}`}
          value={value[key]}
          disabled={submitting}
          type={type}
          inputMode={key === 'phone' ? 'tel' : undefined}
          autoComplete={key === 'name' ? 'name' : key === 'phone' ? 'tel' : 'off'}
          aria-invalid={!!error}
          aria-describedby={error ? `sell-${key}-error` : undefined}
          onBlur={() => setTouched((old) => ({ ...old, [key]: true }))}
          onChange={(event) => onChange({ ...value, [key]: event.target.value })}
        />
        {error && (
          <p id={`sell-${key}-error`} className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    );
  }
  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      {field('name', copy.sell.sellerName)}
      {field('phone', copy.sell.sellerPhone, 'tel')}
      <details>
        <summary className="min-h-11 cursor-pointer py-3 text-secondary-foreground">
          ข้อมูลเพิ่มเติม (ไม่บังคับ)
        </summary>
        <div className="space-y-4 pt-2">
          {field('visitDate', 'วันที่สะดวกเข้าร้าน', 'date')}
          {field('imei', 'เลขประจำเครื่อง (ถ้ามี)')}
          {field('notes', 'หมายเหตุ (ถ้ามี)')}
        </div>
      </details>
      <p className="text-sm">
        {copy.contact.address}
        <br />
        {copy.contact.hours}
      </p>
      {flow === 'EXCHANGE' && <p className="text-sm">{copy.sell.exchangeCreditNote}</p>}
      <p className="text-sm">ราคายืนยันจริงตอนตรวจเครื่องที่ร้าน คุณปฏิเสธได้ ไม่มีค่าใช้จ่าย</p>
      {invalid && (
        <p className="text-sm" id="seller-hint">
          {errors.name ? 'กรอกชื่อ-นามสกุลก่อนส่งข้อมูล' : 'กรอกเบอร์โทรให้ครบ 10 หลัก เริ่มด้วย 0'}
        </p>
      )}
      <Button
        type="submit"
        size="lg"
        fullWidth
        disabled={invalid || submitting}
        aria-describedby={invalid ? 'seller-hint' : undefined}
        loading={submitting}
      >
        {flow === 'EXCHANGE' ? 'ส่งข้อมูลเทิร์น' : 'ส่งข้อมูลขายสด'}
      </Button>
    </form>
  );
}
