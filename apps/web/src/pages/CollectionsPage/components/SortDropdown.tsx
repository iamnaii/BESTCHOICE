import { ArrowUpDown } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export type QueueSortValue =
  | 'priority'
  | 'outstanding_desc'
  | 'outstanding_asc'
  | 'days_overdue_desc'
  | 'last_contacted_asc'
  | 'name_asc'
  | 'random';

const SORT_OPTIONS: { value: QueueSortValue; label: string }[] = [
  { value: 'priority', label: 'Priority' },
  { value: 'outstanding_desc', label: 'ยอดค้าง สูง→ต่ำ' },
  { value: 'outstanding_asc', label: 'ยอดค้าง ต่ำ→สูง' },
  { value: 'days_overdue_desc', label: 'เลยกำหนดนานสุด' },
  { value: 'last_contacted_asc', label: 'ไม่แตะนานสุด' },
  { value: 'name_asc', label: 'ชื่อ ก-ฮ' },
  { value: 'random', label: 'สุ่ม (rotation)' },
];

interface Props {
  value?: QueueSortValue;
  onChange: (v: QueueSortValue) => void;
}

export function SortDropdown({ value, onChange }: Props) {
  return (
    <Select value={value ?? 'priority'} onValueChange={(v) => onChange(v as QueueSortValue)}>
      <SelectTrigger className="h-8 w-[180px]" aria-label="เรียงลำดับคิว">
        <ArrowUpDown className="mr-1.5 size-3.5 opacity-70" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {SORT_OPTIONS.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default SortDropdown;
