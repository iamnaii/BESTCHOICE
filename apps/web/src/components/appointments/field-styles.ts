import { inputVariants } from '@/components/ui/input';
import { cn } from '@/lib/utils';

// Keep native selects, dates and search triggers on the same form scale.
export const appointmentControlClass = cn(
  inputVariants(),
  'h-11 min-w-0 text-base font-normal leading-normal lg:text-sm',
);
export const appointmentFieldClass = 'grid min-w-0 gap-2 text-sm font-medium';
