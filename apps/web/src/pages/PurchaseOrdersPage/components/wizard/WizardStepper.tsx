import { Check, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface WizardStep {
  label: string;
  icon: LucideIcon;
}

/** Step indicator shared by สร้างใบสั่งซื้อ (3 steps) and รับเข้าตรง (2 steps). Completed steps are clickable. */
export function WizardStepper({
  steps,
  current,
  onStepClick,
}: {
  steps: WizardStep[];
  current: number;
  onStepClick?: (index: number) => void;
}) {
  return (
    <ol aria-label="ขั้นตอน" className="flex items-center">
      {steps.map(({ label, icon: Icon }, i) => {
        const completed = i < current;
        const isCurrent = i === current;
        const clickable = completed && !!onStepClick;
        return (
          <li key={label} aria-current={isCurrent ? 'step' : undefined} className="flex items-center flex-1 last:flex-none">
            <button
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onStepClick(i)}
              className={cn('flex items-center gap-2 group', clickable ? 'cursor-pointer' : 'cursor-default')}
            >
              <div
                className={cn(
                  'size-8 rounded-lg flex items-center justify-center shrink-0 transition-all',
                  completed && 'bg-primary text-primary-foreground',
                  isCurrent && 'bg-primary text-primary-foreground ring-4 ring-primary/20',
                  !completed && !isCurrent && 'bg-muted text-muted-foreground',
                )}
              >
                {completed ? <Check className="size-4" strokeWidth={2.5} /> : <Icon className="size-4" />}
              </div>
              <div className={cn('text-sm font-medium leading-snug hidden sm:block', isCurrent ? 'text-foreground' : 'text-muted-foreground')}>
                {label}
              </div>
            </button>
            {i < steps.length - 1 && (
              <div className="flex-1 mx-3 h-0.5 rounded-full bg-muted overflow-hidden">
                <div className={cn('h-full rounded-full transition-all', i < current ? 'bg-primary w-full' : 'w-0')} />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
