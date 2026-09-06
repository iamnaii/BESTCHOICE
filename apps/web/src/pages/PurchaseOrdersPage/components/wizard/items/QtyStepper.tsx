import { Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface QtyStepperProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

const btn =
  'grid w-8 place-items-center text-muted-foreground transition-colors cursor-pointer hover:bg-accent hover:text-foreground ' +
  'disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/40';

/** − [ n ] + — quantity never drops below 1 (the API rejects quantity < 1). */
export function QtyStepper({ value, onChange, className }: QtyStepperProps) {
  const n = Math.max(1, Math.floor(Number(value)) || 1);
  return (
    <div className={cn('inline-flex h-9 items-stretch overflow-hidden rounded-md border border-input bg-background', className)}>
      <button type="button" aria-label="ลดจำนวน" disabled={n <= 1} onClick={() => onChange(String(n - 1))} className={btn}>
        <Minus className="size-3.5" />
      </button>
      <input
        aria-label="จำนวน"
        type="number"
        min={1}
        step={1}
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-10 border-x border-input bg-transparent text-center text-sm font-medium tabular-nums outline-hidden focus-visible:bg-accent/40 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <button type="button" aria-label="เพิ่มจำนวน" onClick={() => onChange(String(n + 1))} className={btn}>
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}
