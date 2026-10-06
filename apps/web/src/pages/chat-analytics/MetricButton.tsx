import { ChevronRight } from 'lucide-react';
import { formatMetric } from './analytics-format';
export default function MetricButton({
  label,
  value,
  unit = '',
  hint,
  onClick,
}: {
  label: string;
  value: number | null | string;
  unit?: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={value === null}
      className="group flex min-h-28 min-w-0 flex-col rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary/50 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-70"
    >
      <span className="flex w-full items-start justify-between gap-2 text-sm text-muted-foreground">
        <span>{label}</span>
        <ChevronRight aria-hidden className="mt-0.5 size-4 shrink-0" />
      </span>
      <span className="mt-2 break-words text-2xl font-semibold tabular-nums leading-snug">
        {typeof value === 'string' ? value : formatMetric(value, unit)}
      </span>
      {hint && <span className="mt-2 text-xs text-muted-foreground leading-relaxed">{hint}</span>}
    </button>
  );
}
