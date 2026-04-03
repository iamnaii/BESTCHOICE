import { Check, Package, Users, Calculator, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface StepIndicatorProps {
  steps: string[];
  currentStep: number;
  onStepClick?: (step: number) => void;
}

/* Step icons matching the contract creation flow */
const stepIcons = [Package, Users, Calculator, FileText];

export function StepIndicator({ steps, currentStep, onStepClick }: StepIndicatorProps) {
  return (
    <div className="mb-8">
      {/* Desktop stepper */}
      <div className="hidden md:flex items-center">
        {steps.map((label, i) => {
          const isCompleted = i < currentStep;
          const isCurrent = i === currentStep;
          const isClickable = onStepClick && i < currentStep;
          const Icon = stepIcons[i] || Package;

          return (
            <div key={label} className="flex items-center flex-1 last:flex-none">
              {/* Step circle + label */}
              <button
                type="button"
                disabled={!isClickable}
                onClick={() => isClickable && onStepClick(i)}
                className={cn(
                  'flex items-center gap-3 group',
                  isClickable && 'cursor-pointer',
                  !isClickable && 'cursor-default',
                )}
              >
                <div
                  className={cn(
                    'size-10 rounded-xl flex items-center justify-center shrink-0 transition-all duration-300',
                    isCompleted && 'bg-primary text-white shadow-sm shadow-primary/30',
                    isCurrent && 'bg-primary text-white shadow-md shadow-primary/40 ring-4 ring-primary/20',
                    !isCompleted && !isCurrent && 'bg-muted text-muted-foreground',
                    isClickable && 'group-hover:shadow-md',
                  )}
                >
                  {isCompleted ? (
                    <Check className="size-5" strokeWidth={2.5} />
                  ) : (
                    <Icon className="size-5" />
                  )}
                </div>
                <div className="text-left">
                  <div className={cn(
                    'text-2xs font-medium uppercase tracking-wider',
                    isCurrent ? 'text-primary' : 'text-muted-foreground',
                  )}>
                    ขั้นตอน {i + 1}
                  </div>
                  <div className={cn(
                    'text-sm font-medium leading-tight',
                    isCurrent ? 'text-foreground' : isCompleted ? 'text-foreground/80' : 'text-muted-foreground',
                  )}>
                    {label}
                  </div>
                </div>
              </button>

              {/* Connector line */}
              {i < steps.length - 1 && (
                <div className="flex-1 mx-4 h-0.5 rounded-full overflow-hidden bg-muted">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all duration-500 ease-out',
                      i < currentStep ? 'bg-primary w-full' : 'bg-transparent w-0',
                    )}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Mobile stepper — compact with progress bar */}
      <div className="md:hidden">
        {/* Progress bar */}
        <div className="flex items-center gap-1.5 mb-3">
          {steps.map((_, i) => (
            <div
              key={i}
              className={cn(
                'h-1.5 rounded-full flex-1 transition-all duration-300',
                i <= currentStep ? 'bg-primary' : 'bg-muted',
              )}
            />
          ))}
        </div>

        {/* Current step info */}
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-lg bg-primary text-white flex items-center justify-center">
            {(() => { const Icon = stepIcons[currentStep] || Package; return <Icon className="size-4" />; })()}
          </div>
          <div>
            <div className="text-2xs text-muted-foreground font-medium">
              ขั้นตอน {currentStep + 1} จาก {steps.length}
            </div>
            <div className="text-sm font-semibold text-foreground">
              {steps[currentStep]}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
