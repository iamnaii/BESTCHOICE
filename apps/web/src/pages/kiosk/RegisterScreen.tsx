import { useState } from 'react';
import { Building2 } from 'lucide-react';

interface Props {
  onRegister: (code: string, deviceName: string) => Promise<void>;
  error: string | null;
  busy: boolean;
}

/** หน้าลงทะเบียนเครื่อง — ครั้งเดียวต่อเครื่อง (mockup บอร์ด 2 ช่อง A) */
export default function RegisterScreen({ onRegister, error, busy }: Props) {
  const [code, setCode] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const normalized = code.replace(/[\s-]/g, '').toUpperCase();
  const canSubmit = normalized.length === 8 && deviceName.trim().length > 0 && !busy;
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5 rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><Building2 className="size-5" aria-hidden="true" /></div>
        <div>
          <h1 className="text-xl font-bold leading-snug">ผูกเครื่องนี้กับสาขา</h1>
          <p className="text-sm text-muted-foreground leading-snug">ขอรหัสลงทะเบียนจากเจ้าของ (ตั้งค่า › บริษัท & สาขา › เครื่องตอกบัตร) ใช้ได้ 10 นาที ครั้งเดียว</p>
        </div>
      </div>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) void onRegister(normalized, deviceName.trim());
        }}
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="kiosk-code" className="text-sm font-medium">รหัสลงทะเบียน 8 ตัว</label>
          <input id="kiosk-code" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" inputMode="text" maxLength={10} className="h-14 rounded-xl border border-input bg-background px-4 text-center text-2xl font-semibold tracking-[0.3em] uppercase outline-hidden focus-visible:ring-2 focus-visible:ring-ring/30" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="kiosk-name" className="text-sm font-medium">ชื่อเครื่อง</label>
          <input id="kiosk-name" value={deviceName} onChange={(e) => setDeviceName(e.target.value)} placeholder="เช่น แท็บเล็ตเคาน์เตอร์" maxLength={60} className="h-12 rounded-xl border border-input bg-background px-4 text-base outline-hidden focus-visible:ring-2 focus-visible:ring-ring/30" />
        </div>
        {error && <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive leading-snug">{error}</div>}
        <button type="submit" disabled={!canSubmit} className="h-14 rounded-xl bg-primary text-base font-semibold text-primary-foreground disabled:opacity-50">
          {busy ? 'กำลังผูกเครื่อง…' : 'ผูกเครื่องกับสาขา'}
        </button>
      </form>
      <p className="text-xs text-muted-foreground leading-snug">หลังผูกแล้ว แนะนำ "เพิ่มไปยังหน้าจอหลัก" เพื่อเปิดเต็มจอ · เครื่องนี้จะเปิดได้เฉพาะหน้าตอกบัตร</p>
    </div>
  );
}
