import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface Props {
  id: string;
  value: string;
  onValueChange: (value: string) => void;
  placeholder: string;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
  clearLabel?: string;
}

const emptyOption = '__unset__';

/** Shared presentation for the four selectors in the counter-purchase form. */
export default function PurchaseSelect({
  id,
  value,
  onValueChange,
  placeholder,
  options,
  disabled,
  clearLabel,
}: Props) {
  return (
    <Select
      value={value}
      onValueChange={(next) => onValueChange(next === emptyOption ? '' : next)}
      disabled={disabled}
      indicatorPosition="right"
    >
      <SelectTrigger
        id={id}
        className="mt-2 h-12 min-w-0 cursor-pointer gap-3 rounded-xl border-border bg-card px-4 text-base leading-snug shadow-sm transition-colors hover:border-primary/50 data-[state=open]:border-primary data-[state=open]:ring-2 data-[state=open]:ring-primary/15 disabled:cursor-not-allowed disabled:bg-muted/40 sm:text-sm [&>span]:min-w-0 [&>span]:text-left [&>svg]:shrink-0 [&>svg]:transition-transform data-[state=open]:[&>svg]:rotate-180"
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent
        align="start"
        collisionPadding={12}
        className="z-[60] max-h-[min(20rem,var(--radix-select-content-available-height))] w-(--radix-select-trigger-width) min-w-0 rounded-xl border-border bg-popover p-1 shadow-xl motion-reduce:animate-none [&_[data-radix-select-viewport]]:min-w-0 [&_[data-slot=select-scroll-up-button]]:min-h-6 [&_[data-slot=select-scroll-down-button]]:min-h-6"
      >
        {clearLabel && (
          <SelectItem
            value={emptyOption}
            className="min-h-11 cursor-pointer rounded-lg pl-3 pr-9 text-sm leading-snug text-muted-foreground"
          >
            {clearLabel}
          </SelectItem>
        )}
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            className="min-h-11 cursor-pointer rounded-lg pl-3 pr-9 text-sm leading-snug transition-colors data-[state=checked]:bg-primary/10 data-[state=checked]:font-semibold focus:bg-primary/10 hover:bg-primary/10 [&>span:last-child]:whitespace-normal [&>span:last-child]:break-words"
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
