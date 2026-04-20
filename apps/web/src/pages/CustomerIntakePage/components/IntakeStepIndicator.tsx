import { Check } from 'lucide-react';
import { STEPS } from '../constants';
import type { IntakeStep } from '../types';

interface Props {
  current: IntakeStep;
}

export default function IntakeStepIndicator({ current }: Props) {
  const currentIdx = STEPS.findIndex((s) => s.key === current);
  return (
    <div className="flex items-center gap-2 mb-6 px-2">
      {STEPS.map((step, i) => {
        const done = i < currentIdx;
        const active = i === currentIdx;
        return (
          <div key={step.key} className="flex items-center gap-2 flex-1">
            <div
              className={`flex items-center justify-center size-8 rounded-full text-xs font-semibold ${
                done
                  ? 'bg-success text-success-foreground'
                  : active
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground'
              }`}
            >
              {done ? <Check className="size-4" /> : i + 1}
            </div>
            <span
              className={`text-xs ${active ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}
            >
              {step.label}
            </span>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-0.5 ${i < currentIdx ? 'bg-success' : 'bg-border'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
