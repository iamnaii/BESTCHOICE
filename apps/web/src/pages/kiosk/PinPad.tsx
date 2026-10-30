import { Delete } from 'lucide-react';

interface Props {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}

const KEY = 'h-16 rounded-2xl border border-input bg-background text-2xl font-semibold text-foreground active:bg-muted disabled:opacity-50';
const FN = 'h-16 rounded-2xl border border-input bg-muted text-base font-medium text-muted-foreground active:bg-accent disabled:opacity-50';

/** แป้นรหัส 6 หลักสำหรับยืนกด — ปุ่ม ≥ 64px · ช่องว่าง 10px · จุดแสดงจำนวนที่กรอก (ไม่โชว์ตัวเลข) */
export default function PinPad({ value, onChange, disabled }: Props) {
  const press = (d: string) => {
    if (disabled || value.length >= 6) return;
    onChange(value + d);
  };
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex gap-3.5" aria-hidden="true">
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className={`size-4 rounded-full border-2 ${i < value.length ? 'border-foreground bg-foreground' : 'border-input bg-background'}`} />
        ))}
      </div>
      <span className="sr-only" aria-live="polite">กรอกแล้ว {value.length} จาก 6 หลัก</span>
      <div role="group" aria-label="แป้นรหัส 6 หลัก" className="grid w-full grid-cols-3 gap-2.5">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} type="button" className={KEY} onClick={() => press(d)} disabled={disabled}>{d}</button>
        ))}
        <button type="button" className={FN} onClick={() => onChange('')} disabled={disabled}>ล้าง</button>
        <button type="button" className={KEY} onClick={() => press('0')} disabled={disabled}>0</button>
        <button type="button" className={FN} aria-label="ลบตัวสุดท้าย" onClick={() => onChange(value.slice(0, -1))} disabled={disabled}>
          <Delete className="mx-auto size-6" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
