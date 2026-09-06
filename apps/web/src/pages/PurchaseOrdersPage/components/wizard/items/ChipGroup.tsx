import { cn } from '@/lib/utils';

export type ChipOption = string | { value: string; label: string };

interface ChipGroupProps {
  /** Accessible name of the radiogroup; also rendered as the inline label unless `hideLabel`. */
  label: string;
  options: ChipOption[];
  value: string;
  onChange: (value: string) => void;
  /** Clicking the selected chip clears it — for optional fields (สี / ความจุ). */
  allowClear?: boolean;
  hideLabel?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

const norm = (o: ChipOption) => (typeof o === 'string' ? { value: o, label: o } : o);

/**
 * One-click choice chips (role=radiogroup). Replaces the old `<select>` cascade:
 * every option is visible at once, one click picks it, no disabled-until-parent state.
 */
export function ChipGroup({
  label,
  options,
  value,
  onChange,
  allowClear = false,
  hideLabel = false,
  size = 'sm',
  className,
}: ChipGroupProps) {
  return (
    <div className={cn('flex items-start gap-2', className)}>
      {!hideLabel && (
        <span className="w-12 shrink-0 pt-1.5 text-xs text-muted-foreground leading-none">{label}</span>
      )}
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
        {options.map((raw) => {
          const o = norm(raw);
          const selected = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(selected && allowClear ? '' : o.value)}
              className={cn(
                'inline-flex items-center rounded-full border text-xs font-medium leading-none whitespace-nowrap',
                'cursor-pointer transition-colors duration-150',
                'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background',
                size === 'sm' ? 'h-7 px-2.5' : 'h-8 px-3',
                selected
                  ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                  : 'bg-background text-foreground border-input hover:border-primary/50 hover:text-primary',
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
