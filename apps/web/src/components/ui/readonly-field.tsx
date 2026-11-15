import * as React from 'react';
import { cn } from '@/lib/utils';
import { Input } from './input';
import { formControlClass } from './form-styles';

type ReadOnlyFieldTone = 'default' | 'success' | 'warning';

type ReadOnlyFieldProps = Omit<
  React.ComponentProps<'input'>,
  'readOnly' | 'onChange' | 'type' | 'value' | 'defaultValue'
> & {
  value: string | number;
  /** `end` = numbers: right-aligned with tabular figures. */
  align?: 'start' | 'end';
  /** Status colour some cards show on a computed value — no className override needed. */
  tone?: ReadOnlyFieldTone;
};

// `inputVariants` styles read-only inputs with `[[readonly]]:bg-muted/80` and
// `[[readonly]]:cursor-not-allowed`. Tailwind compiles those to `:is([readonly])`, which
// beats a plain utility, so tone backgrounds and the cursor must use the same variant;
// tailwind-merge then drops the base ones.
const TONE_CLASS: Record<ReadOnlyFieldTone, string> = {
  default: '',
  success: '[[readonly]]:bg-success/10 text-success',
  warning: '[[readonly]]:bg-warning/10 text-warning-strong',
};

/**
 * A computed/display value that sits in a form row: same 44px frame as the editable
 * controls next to it (formControlClass), the read-only surface of `inputVariants`,
 * labelable with `<label htmlFor>` and skipped by Tab.
 */
function ReadOnlyField({
  value,
  align = 'start',
  tone = 'default',
  className,
  ...props
}: ReadOnlyFieldProps) {
  return (
    <Input
      {...props}
      readOnly
      tabIndex={-1}
      data-slot="readonly-field"
      value={String(value)}
      className={cn(
        formControlClass,
        'bg-muted/80 [[readonly]]:cursor-default',
        align === 'end' && 'text-right tabular-nums',
        TONE_CLASS[tone],
        className,
      )}
    />
  );
}

export { ReadOnlyField, type ReadOnlyFieldProps };
