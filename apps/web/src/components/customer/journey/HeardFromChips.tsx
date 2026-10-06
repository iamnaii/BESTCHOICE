import { JOURNEY_HEARD_FROM_CODES, JOURNEY_HEARD_FROM_LABELS, type JourneyHeardFrom } from '@installment/shared';
import { Button } from '@/components/ui/button';
import { ChoiceChip, ChoiceChipRow } from './ChoiceChip';

/**
 * ชิป "ลูกค้ารู้จักร้านจากไหน" 9 ตัว — ถามเฉพาะลูกค้าหน้าร้าน (คำตัดสินข้อ 3) ผู้ห่อตัดสินว่าจะแสดงเมื่อไรและบันทึกตอนไหน:
 * - ป้ายบนแท็บการเดินทาง / การ์ดสร้างสัญญา: แตะ = บันทึกทันที ส่ง `pendingCode` ระหว่างรอ
 * - dialog สร้างลูกค้า / POS: แตะ = เลือกไว้ (แตะซ้ำ = ยกเลิก — ผู้ห่อสลับเอง) แล้วบันทึกหลังสร้างลูกค้าสำเร็จ
 * `onSelect` ส่งรหัสที่แตะเสมอ · ระหว่าง `pendingCode` ทุกชิปและปุ่ม "ข้าม" ถูกล็อกกันแตะซ้ำ
 * `skipStyle`: 'ghost-button' = Button ghost sm (ป้ายบนแท็บ · บอร์ด Main e) · 'text' = ปุ่มข้อความเล็ก (บอร์ด HeardFrom a/b/c1)
 */
export interface HeardFromChipsProps {
  value: JourneyHeardFrom | null;
  onSelect: (code: JourneyHeardFrom) => void;
  pendingCode?: JourneyHeardFrom | null;
  disabled?: boolean;
  onSkip?: () => void;
  skipStyle: 'ghost-button' | 'text';
}

export function HeardFromChips({
  value,
  onSelect,
  pendingCode = null,
  disabled = false,
  onSkip,
  skipStyle,
}: HeardFromChipsProps) {
  const saving = pendingCode !== null;
  const locked = disabled || saving;

  return (
    <div role="group" aria-label="ลูกค้ารู้จักร้านจากไหน" className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium leading-snug text-muted-foreground">ลูกค้ารู้จักร้านจากไหน (ไม่บังคับ)</div>
        {onSkip &&
          (skipStyle === 'ghost-button' ? (
            <Button type="button" variant="ghost" size="sm" onClick={onSkip} disabled={locked}>
              ข้าม
            </Button>
          ) : (
            <button
              type="button"
              onClick={onSkip}
              disabled={locked}
              className="text-xs leading-snug text-muted-foreground hover:text-foreground"
            >
              ข้าม
            </button>
          ))}
      </div>
      <ChoiceChipRow>
        {JOURNEY_HEARD_FROM_CODES.map((code) => (
          <ChoiceChip
            key={code}
            active={value === code}
            busy={pendingCode === code}
            disabled={locked}
            onClick={() => onSelect(code)}
          >
            {JOURNEY_HEARD_FROM_LABELS[code]}
          </ChoiceChip>
        ))}
      </ChoiceChipRow>
    </div>
  );
}
