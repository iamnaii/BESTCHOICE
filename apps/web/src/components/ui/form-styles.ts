import { cn } from '@/lib/utils';
import { inputVariants } from './input';

/** Full-size data-entry controls. Compact table filters keep their own variants. */
export const formControlClass = cn(
  inputVariants(),
  'h-11 min-h-11 min-w-0 rounded-lg py-2 text-base font-normal leading-normal lg:text-sm',
);

export const formTextareaClass = cn(formControlClass, 'h-auto min-h-24');

/** Leave room for the screen focus outline around the following control. */
export const formLabelClass = 'mb-3 block text-sm font-medium leading-snug text-foreground';
