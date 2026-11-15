import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formControlClass } from './form-styles';

type NativeSelectProps = Omit<React.ComponentProps<'select'>, 'multiple' | 'size'> & {
  /** Width, margin, flex and grid placement belong to the wrapper. */
  wrapperClassName?: string;
  /**
   * Decorative icon at the start of the field (e.g. a user icon on an assignee filter).
   * The primitive owns the left padding (`pl-10`), so callers must not pass `pl-*` for it.
   */
  leadingIcon?: React.ReactNode;
  /** `warning` = attention border (e.g. an unsaved row); it wins over any caller border colour. */
  tone?: 'default' | 'warning';
};

/** Keep native selection, form validation, refs and change events with a consistent arrow. */
export function NativeSelect({
  className,
  wrapperClassName,
  disabled,
  leadingIcon,
  tone = 'default',
  ...props
}: NativeSelectProps) {
  const hasLeadingIcon = Boolean(leadingIcon);
  return (
    <span data-slot="native-select-wrapper" className={cn('relative block min-w-0 w-full max-w-full', wrapperClassName)}>
      <select
        data-slot="native-select"
        {...props}
        disabled={disabled}
        className={cn(
          formControlClass,
          className,
          'peer h-11 min-h-11 w-full min-w-0 max-w-full appearance-none overflow-hidden pr-10 text-base leading-normal md:text-base lg:text-sm',
          hasLeadingIcon && 'pl-10',
          tone === 'warning' && 'border-warning',
        )}
      />
      {hasLeadingIcon && (
        <span
          data-slot="native-select-leading-icon"
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 flex size-4 -translate-y-1/2 items-center justify-center text-muted-foreground peer-disabled:opacity-50 [&_svg]:size-4"
        >
          {leadingIcon}
        </span>
      )}
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-[calc(0.75rem+1px)] top-1/2 size-4 -translate-y-1/2 text-muted-foreground peer-disabled:opacity-50"
      />
    </span>
  );
}
