import { useState } from 'react';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { CalendarIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatThaiDate } from '@/lib/date';
import { startOfDay, endOfDay, subDays, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import type { DateRange } from 'react-day-picker';

export type DateRangeValue = { from: Date | null; to: Date | null };

export interface DateRangePickerProps {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  className?: string;
  disabled?: boolean;
}

type PresetKey = 'today' | '7d' | '30d' | 'thisMonth' | 'lastMonth' | '3m' | 'custom';

const PRESETS: { key: PresetKey; label: string; compute: () => DateRangeValue }[] = [
  {
    key: 'today',
    label: 'วันนี้',
    compute: () => {
      const now = new Date();
      return { from: startOfDay(now), to: endOfDay(now) };
    },
  },
  {
    key: '7d',
    label: '7 วัน',
    compute: () => {
      const now = new Date();
      return { from: startOfDay(subDays(now, 6)), to: endOfDay(now) };
    },
  },
  {
    key: '30d',
    label: '30 วัน',
    compute: () => {
      const now = new Date();
      return { from: startOfDay(subDays(now, 29)), to: endOfDay(now) };
    },
  },
  {
    key: 'thisMonth',
    label: 'เดือนนี้',
    compute: () => {
      const now = new Date();
      return { from: startOfMonth(now), to: endOfMonth(now) };
    },
  },
  {
    key: 'lastMonth',
    label: 'เดือนที่แล้ว',
    compute: () => {
      const last = subMonths(new Date(), 1);
      return { from: startOfMonth(last), to: endOfMonth(last) };
    },
  },
  {
    key: '3m',
    label: '3 เดือน',
    compute: () => {
      const now = new Date();
      return { from: startOfDay(subMonths(now, 3)), to: endOfDay(now) };
    },
  },
];

export function DateRangePicker({ value, onChange, className, disabled }: DateRangePickerProps) {
  const [selected, setSelected] = useState<PresetKey>('custom');

  function handlePreset(key: PresetKey) {
    const preset = PRESETS.find((p) => p.key === key);
    if (preset) {
      setSelected(key);
      onChange(preset.compute());
    }
  }

  function handleCalendar(range: DateRange | undefined) {
    setSelected('custom');
    onChange({ from: range?.from ?? null, to: range?.to ?? null });
  }

  const displayLabel =
    value.from && value.to
      ? `${formatThaiDate(value.from)} – ${formatThaiDate(value.to)}`
      : 'เลือกช่วงวันที่';

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {/* Preset shortcuts — always visible for quick access */}
      <div className="flex flex-wrap items-center gap-1">
        {PRESETS.map((p) => (
          <Button
            key={p.key}
            variant={selected === p.key ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => handlePreset(p.key)}
            disabled={disabled}
            type="button"
          >
            {p.label}
          </Button>
        ))}
      </div>

      {/* Custom range via popover calendar */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" disabled={disabled} type="button">
            <CalendarIcon className="mr-2 h-4 w-4" />
            {displayLabel}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            mode="range"
            selected={value.from && value.to ? { from: value.from, to: value.to } : undefined}
            onSelect={handleCalendar}
            numberOfMonths={2}
            autoFocus
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
