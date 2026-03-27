export interface StepIndicatorProps {
  steps: string[];
  currentStep: number;
}

export function StepIndicator({ steps, currentStep }: StepIndicatorProps) {
  return (
    <div className="flex items-center gap-1 mb-6 flex-wrap">
      {steps.map((s, i) => (
        <div key={s} className="flex items-center gap-1">
          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium ${i <= currentStep ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
            {i + 1}
          </div>
          <span className={`text-xs ${i <= currentStep ? 'text-primary font-medium' : 'text-muted-foreground'} hidden md:inline`}>{s}</span>
          {i < steps.length - 1 && <div className={`w-4 h-0.5 ${i < currentStep ? 'bg-primary' : 'bg-muted'}`} />}
        </div>
      ))}
    </div>
  );
}
