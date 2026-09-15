import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { TimelineEvent } from '../hooks/useCustomer360';

export type TimelineEventType = TimelineEvent['type'];
export type TimelineFilterValue = TimelineEventType | 'ALL';

export interface TimelineChip {
  value: string;
  label: string;
}

/** ชุดชิปของแผงติดตามหนี้ (Customer360) — ใช้เมื่อผู้เรียกไม่ส่ง chips */
const DEFAULT_CHIPS: { value: TimelineFilterValue; label: string }[] = [
  { value: 'ALL', label: 'ทั้งหมด' },
  { value: 'PAYMENT', label: 'ชำระ' },
  { value: 'DUNNING_ACTION', label: 'แจ้งเตือน' },
  { value: 'CALL', label: 'โทร' },
  { value: 'LETTER', label: 'หนังสือ' },
  { value: 'MDM', label: 'เครื่อง' },
  { value: 'STATUS_CHANGE', label: 'สถานะ' },
];

interface Props {
  value: string;
  onChange: (value: string) => void;
  counts?: Partial<Record<string, number>>;
  /** ชุดชิปของหน้าอื่น เช่น กลุ่มของแท็บการเดินทางลูกค้า — ไม่ส่ง = ชุดติดตามหนี้เดิม */
  chips?: TimelineChip[];
  className?: string;
}

export default function TimelineFilterChips({ value, onChange, counts, chips = DEFAULT_CHIPS, className }: Props) {
  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      {chips.map((chip) => {
        const count = counts?.[chip.value];
        const isActive = value === chip.value;
        return (
          <Button
            key={chip.value}
            type="button"
            variant={isActive ? 'primary' : 'ghost'}
            size="sm"
            className="h-7 px-2.5 text-xs"
            aria-pressed={isActive}
            onClick={() => onChange(chip.value)}
          >
            <span className="leading-snug">{chip.label}</span>
            {typeof count === 'number' && (
              <span
                className={cn(
                  'ml-1.5 tabular-nums text-[10px]',
                  isActive ? 'text-primary-foreground/80' : 'text-muted-foreground',
                )}
              >
                {count}
              </span>
            )}
          </Button>
        );
      })}
    </div>
  );
}
