import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { TimelineEvent } from '../hooks/useCustomer360';

export type TimelineEventType = TimelineEvent['type'];
export type TimelineFilterValue = TimelineEventType | 'ALL';

const CHIPS: { value: TimelineFilterValue; label: string }[] = [
  { value: 'ALL', label: 'ทั้งหมด' },
  { value: 'PAYMENT', label: 'ชำระ' },
  { value: 'DUNNING_ACTION', label: 'แจ้งเตือน' },
  { value: 'CALL', label: 'โทร' },
  { value: 'LETTER', label: 'หนังสือ' },
  { value: 'MDM', label: 'เครื่อง' },
  { value: 'STATUS_CHANGE', label: 'สถานะ' },
];

interface Props {
  value: TimelineFilterValue;
  onChange: (value: TimelineFilterValue) => void;
  counts?: Partial<Record<TimelineFilterValue, number>>;
  className?: string;
}

export default function TimelineFilterChips({ value, onChange, counts, className }: Props) {
  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      {CHIPS.map((chip) => {
        const count = counts?.[chip.value];
        const isActive = value === chip.value;
        return (
          <Button
            key={chip.value}
            type="button"
            variant={isActive ? 'primary' : 'ghost'}
            size="sm"
            className="h-7 px-2.5 text-xs"
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
