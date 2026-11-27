import { useEffect, useState } from 'react';
import { copy } from '@/lib/copy';
import { cn } from '@/lib/utils';

/** เพดานของช่องเงินดาวน์ — ตรงกับ `@Max` ของ `ListProductsDto.downAmount` ฝั่ง API */
export const MAX_DOWN_BAHT = 9_999_999;

/** ข้อความในช่อง → จำนวนเต็มบาท · ว่าง / ไม่มีตัวเลข = null (ไม่ได้ใส่เงินดาวน์) */
export function parseDownInput(raw: string): number | null {
  // ตัดที่จุดทศนิยมตัวแรกก่อน — "5,000.00" ต้องได้ 5000 ไม่ใช่ 500000
  const [intPart, ...rest] = raw.split('.');
  const digits = intPart.replace(/[^\d]/g, '');
  if (digits === '') return null;
  // "0.5" ไม่ใช่ฟรีดาวน์ — มีเศษที่ไม่ใช่ศูนย์แต่ส่วนจำนวนเต็มเป็นศูนย์ = ไม่ได้ใส่เงินดาวน์
  if (/^0+$/.test(digits) && /[1-9]/.test(rest.join('').replace(/[^\d]/g, ''))) return null;
  return Math.min(MAX_DOWN_BAHT, Number(digits));
}

interface Props {
  id: string;
  /** เงินดาวน์ที่ใช้อยู่ (บาท) — null = ไม่ได้ใส่ */
  value: number | null;
  /** เรียกเมื่อออกจากช่อง / กด Enter และค่าเปลี่ยนจริง · 0 = ไม่มีเงินดาวน์ (ผู้เรียกแปลงเป็นฟรีดาวน์) */
  onCommit: (next: number | null) => void;
  /** ติ๊กฟรีดาวน์อยู่: ช่องใช้ไม่ได้ และแสดง 0 */
  disabled?: boolean;
  /** 'panel' = ในกล่องเงินดาวน์ของตัวกรอง · 'pill' = แถวบนของมือถือ */
  variant?: 'panel' | 'pill';
  /** id ของข้อความอธิบายใต้ช่อง (ถ้ามี) */
  hintId?: string;
}

/** "เงินดาวน์ [____] บาท" — ช่องพิมพ์จำนวนเงินที่ลูกค้ามี (สเปค 2026-11-25 หัวข้อ 5–6) */
export function DownAmountField({
  id,
  value,
  onCommit,
  disabled = false,
  variant = 'panel',
  hintId,
}: Props) {
  const shown = disabled ? '0' : value == null ? '' : value.toLocaleString('en-US');
  // เก็บข้อความดิบระหว่างพิมพ์ — ส่งค่าเฉพาะตอนออกจากช่องหรือกด Enter (ไม่ยิงคำขอทุกตัวอักษร)
  const [raw, setRaw] = useState(shown);
  useEffect(() => setRaw(shown), [shown]);

  function commit() {
    const next = parseDownInput(raw);
    setRaw(next == null ? '' : next.toLocaleString('en-US'));
    if (next !== value) onCommit(next);
  }

  const pill = variant === 'pill';
  return (
    <div
      className={cn(
        'flex min-h-11 items-center gap-2 focus-within:ring-2 focus-within:ring-ring/50',
        pill
          ? 'min-w-40 flex-1 rounded-full bg-muted pl-4 pr-3.5 ring-1 ring-inset ring-border/70'
          : // panel: ชื่อช่องอยู่ในกล่องแถวเดียวกับตัวเลข — ตัวกรองข้างจอสั้นลงหนึ่งบรรทัด (ให้พอดีจอ 2026-11-27)
            'rounded-xl bg-card px-3',
      )}
    >
      <label
        htmlFor={id}
        className={cn(
          'shrink-0 text-sm leading-snug whitespace-nowrap',
          pill ? 'font-head text-accent-foreground' : 'text-foreground',
        )}
      >
        {copy.catalog.downLabel}
      </label>
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <input
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={raw}
          disabled={disabled}
          aria-describedby={hintId}
          onChange={(e) => setRaw(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          className="num h-11 min-w-0 flex-1 bg-transparent text-right text-base font-bold leading-snug text-primary disabled:opacity-50 focus:outline-none"
        />
        <span
          className={cn(
            'shrink-0 text-sm leading-snug',
            pill ? 'font-head text-accent-foreground' : 'font-bold text-foreground',
          )}
        >
          {copy.catalog.downUnit}
        </span>
      </div>
    </div>
  );
}
