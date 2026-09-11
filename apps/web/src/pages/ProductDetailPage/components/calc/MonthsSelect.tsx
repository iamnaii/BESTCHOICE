import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { MonthOption } from '../../utils/monthsOptions';

interface Props {
  id: string;
  label: string;
  value: number | null;
  options: MonthOption[];
  onChange: (months: number) => void;
  /** วิธีโชว์ค่างวดของแต่ละตัวเลือก (BESTCHOICE 2 ทศนิยม · GFIN ปัดขึ้นเป็นบาท) */
  format: (monthly: number) => string;
}

/**
 * dropdown งวดที่บอกค่างวดในตัวเลือก ("12 งวด · ผ่อนเดือนละ 2,413.20") — แบบช่อง "ผ่อนชำระ"
 * ของหน้าขอสินเชื่อ GFIN; เจ้าของสั่ง (2026-09-11) ใช้ dropdown แทนปุ่มงวด
 */
export function MonthsSelect({ id, label, value, options, onChange, format }: Props) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-[13px] text-muted-foreground leading-snug">
        {label}
      </Label>
      <Select
        value={value != null ? String(value) : undefined}
        onValueChange={(v) => onChange(Number(v))}
      >
        <SelectTrigger id={id} aria-label={label}>
          <SelectValue placeholder="เลือกงวด" />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.months} value={String(o.months)}>
              {o.months} งวด · ผ่อนเดือนละ {format(o.monthly)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
