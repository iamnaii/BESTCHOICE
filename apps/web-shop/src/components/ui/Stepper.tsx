import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface StepperStep {
  label: string;
  description?: string;
}

interface Props {
  steps: StepperStep[];
  current: number; // 1-indexed
  className?: string;
}

export function Stepper({ steps, current, className }: Props) {
  return (
    <ol className={cn('flex items-start', className)}>
      {steps.map((step, i) => {
        const idx = i + 1;
        const state = idx < current ? 'done' : idx === current ? 'active' : 'future';
        return (
          <li key={i} className="flex-1 flex flex-col items-center text-center relative">
            {i > 0 && (
              <div
                className={cn(
                  'absolute top-4 -left-1/2 right-1/2 h-0.5',
                  idx <= current ? 'bg-emerald-500' : 'bg-zinc-200',
                )}
                aria-hidden="true"
              />
            )}
            <div
              className={cn(
                'relative size-8 rounded-full flex items-center justify-center font-semibold text-sm z-10',
                state === 'done' && 'bg-emerald-500 text-white',
                state === 'active' && 'bg-emerald-500 text-white ring-4 ring-emerald-100',
                state === 'future' && 'bg-zinc-100 text-zinc-400',
              )}
            >
              {state === 'done' ? <Check className="size-4" /> : idx}
            </div>
            <div className="mt-2 space-y-0.5 leading-snug">
              <div
                className={cn(
                  'text-xs font-medium',
                  state === 'future' ? 'text-muted-foreground' : 'text-foreground',
                )}
              >
                {step.label}
              </div>
              {step.description && (
                <div className="text-xs text-muted-foreground hidden md:block">
                  {step.description}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
