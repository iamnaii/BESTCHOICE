import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { inputVariants } from './input';

type NativeSelectProps = Omit<React.ComponentProps<'select'>, 'multiple' | 'size'> & {
  /** Width, margin, flex and grid placement belong to the wrapper. */
  wrapperClassName?: string;
};

/** Keep native selection, form validation, refs and change events with a consistent arrow. */
export function NativeSelect({
  className,
  wrapperClassName,
  disabled,
  ...props
}: NativeSelectProps) {
  return (
    <span data-slot="native-select-wrapper" className={cn('relative block min-w-0 w-full max-w-full', wrapperClassName)}>
      <select
        data-slot="native-select"
        {...props}
        disabled={disabled}
        className={cn(
          inputVariants(),
          'rounded-lg py-2 font-normal',
          className,
          'peer h-11 min-h-11 w-full min-w-0 max-w-full appearance-none overflow-hidden pr-10 text-base leading-normal md:text-base lg:text-sm',
        )}
      />
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-[calc(0.75rem+1px)] top-1/2 size-4 -translate-y-1/2 text-muted-foreground peer-disabled:opacity-50"
      />
    </span>
  );
}
