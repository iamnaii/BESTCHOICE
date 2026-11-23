import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CornerDownRight } from '@/lib/icons';

/**
 * `<Select>` ของ Radix **ห้าม** `value=""` ⇒ ทุกตัวกรองใช้ sentinel `ALL` แทน "ทั้งหมด"
 * แล้วแปลงกลับเป็น `''` ตอนเขียน URL (ค่าเริ่มต้น = ไม่มีคีย์นั้นใน query string)
 */
export const ALL = 'ALL';

export interface FilterOption {
  value: string;
  label: string;
  /** ตัวเลือกย่อยใต้หัวข้อ */
  indent?: boolean;
}

export interface FilterGroup {
  label?: string;
  options: FilterOption[];
}

export default function FilterSelect({
  ariaLabel,
  placeholder,
  value,
  onChange,
  width,
  groups,
}: {
  ariaLabel: string;
  /** ข้อความตัวเลือก "ทั้งหมด" — เป็นทั้ง placeholder และรายการแรก */
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  /** ความกว้างจาก mockup (px) */
  width: number;
  groups: FilterGroup[];
}) {
  const selectedLabel = value
    ? groups.flatMap(({ options }) => options).find((option) => option.value === value)?.label
    : placeholder;

  return (
    <Select value={value || ALL} onValueChange={(v) => onChange(v === ALL ? '' : v)}>
      <SelectTrigger
        aria-label={ariaLabel}
        className="h-10 w-full min-w-0"
        style={{ maxWidth: `${width}px` }}
      >
        <SelectValue placeholder={placeholder}>{selectedLabel}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{placeholder}</SelectItem>
        {groups.map((group, index) => (
          <SelectGroup key={group.label ?? `g-${index}`}>
            {group.label && <SelectLabel>{group.label}</SelectLabel>}
            {group.options.map((option) => (
              <SelectItem key={option.value} value={option.value} textValue={option.label}>
                {option.indent ? (
                  <span className="inline-flex items-center gap-1">
                    <CornerDownRight size={16} className="shrink-0" aria-hidden="true" />
                    {option.label}
                  </span>
                ) : option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
